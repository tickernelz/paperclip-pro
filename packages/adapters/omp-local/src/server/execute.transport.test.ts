import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { execute } from "./execute.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

interface Invocation {
  args: string[];
  target: unknown;
}

describe("OMP local transport selection", () => {
  let root: string;
  let commandPath: string;
  let workspaceCwd: string;
  let captured: Invocation | null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-transport-"));
    workspaceCwd = path.join(root, "workspace");
    commandPath = path.join(root, "fake-omp");
    await fs.mkdir(workspaceCwd, { recursive: true });
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    captured = null;
    runProcessMock.mockReset();
    runProcessMock.mockImplementation((async (
      _runId: string,
      target: unknown,
      _command: string,
      args: string[],
    ) => {
      captured = { args, target };
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function run(
    config: Record<string, unknown>,
    executionTarget?: Record<string, unknown>,
  ): Promise<Invocation> {
    await execute({
      runId: "run-transport",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, ...config },
      context: {},
      ...(executionTarget ? { executionTarget } : {}),
      onLog: async () => {},
    } as never);
    expect(captured).not.toBeNull();
    return captured as Invocation;
  }

  it("runs OMP in RPC mode by default and keeps the prompt out of argv", async () => {
    const invocation = await run({});
    expect(invocation.args).toContain("--mode");
    expect(invocation.args[invocation.args.indexOf("--mode") + 1]).toBe("rpc");
    expect(invocation.args).not.toContain("-p");
    expect(invocation.args).not.toContain("json");
  });

  it("returns to one-shot print mode when rpcSteering is disabled", async () => {
    const invocation = await run({ rpcSteering: false });
    expect(invocation.args[invocation.args.indexOf("--mode") + 1]).toBe("json");
    expect(invocation.args).toContain("-p");
    expect(invocation.args.at(-1)).toContain("Paperclip");
  });

  it("keeps a verbose tool call from pushing resultJson past the safe-result budget", async () => {
    const huge = "y".repeat(200_000);
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      options: { onLog: (stream: string, chunk: string) => Promise<void> },
    ) => {
      await options.onLog(
        "stdout",
        `${JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "echo hi" } })}\n`,
      );
      await options.onLog(
        "stdout",
        `${JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", result: huge, isError: false })}\n`,
      );
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: huge,
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);

    const result = await execute({
      runId: "run-transport",
      agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, rpcSteering: false },
      context: {},
      onLog: async () => {},
    } as never);

    const calls = (result.resultJson?.toolCalls ?? []) as Record<string, unknown>[];
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("bash");
    expect(String(calls[0].result).length).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(JSON.stringify(result.resultJson ?? {}), "utf8")).toBeLessThan(64 * 1024);
  });

});
