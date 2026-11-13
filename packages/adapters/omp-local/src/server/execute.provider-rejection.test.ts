import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@tickernelz/wardmote-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { execute } from "./execute.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/wardmote-adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

const VISION_REJECTION =
  "400 The request contains image input, but this combo has no confirmed vision-capable target (type=invalid_request_error)";

function failedTurn(errorMessage: string) {
  return `${JSON.stringify({
    type: "message_end",
    messageId: "msg-2",
    message: {
      role: "assistant",
      content: [],
      provider: "sub2api-deepseek",
      model: "deepseek-flash",
      stopReason: "error",
      errorStatus: Number(errorMessage.slice(0, 3)),
      errorMessage,
    },
  })}\n`;
}

type Outcome = { exitCode: number; stdout: string };

describe("OMP provider request rejection", () => {
  let root: string;
  let workspaceCwd: string;
  let commandPath: string;
  let calls: string[][];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-rejection-"));
    workspaceCwd = path.join(root, "workspace");
    commandPath = path.join(root, "fake-omp");
    await fs.mkdir(workspaceCwd, { recursive: true });
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    calls = [];
    runProcessMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function run(outcomes: Outcome[]) {
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      args: string[],
      options: { onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void> },
    ) => {
      calls.push(args);
      const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)]!;
      if (outcome.stdout) await options.onLog("stdout", outcome.stdout);
      return {
        exitCode: outcome.exitCode,
        signal: null,
        timedOut: false,
        stdout: outcome.stdout,
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);
    return execute({
      runId: "run-rejection",
      agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
      runtime: {
        sessionId: "saved-session",
        sessionParams: { sessionId: "saved-session", cwd: workspaceCwd },
        sessionDisplayId: "saved-session",
        taskKey: "task-1",
      },
      config: { command: commandPath, cwd: workspaceCwd, rpcSteering: false, wardmoteMcp: false },
      context: {},
      onLog: async () => {},
    });
  }

  it("retries a rejected resumed session once on a fresh session", async () => {
    const result = await run([
      { exitCode: 1, stdout: failedTurn(VISION_REJECTION) },
      { exitCode: 0, stdout: "" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--resume");
    expect(calls[1]).not.toContain("--resume");
    expect(result.exitCode).toBe(0);
    expect(result.errorCode).toBeUndefined();
  });

  it("reports the rejection family when the fresh session is rejected too", async () => {
    const result = await run([{ exitCode: 1, stdout: failedTurn(VISION_REJECTION) }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("--resume");
    expect(result.errorCode).toBe("omp_provider_request_rejected");
    expect(result.errorFamily).toBe("provider_request_rejected");
    expect(result.errorMessage).toContain("invalid_request_error");
  });

  it("keeps a 5xx failure on the existing path without a fresh-session retry", async () => {
    const result = await run([{ exitCode: 1, stdout: failedTurn("502 Bad gateway (type=api_error)") }]);
    expect(calls).toHaveLength(1);
    expect(result.errorFamily).toBe("transient_upstream");
  });
});
