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

type UsageReceipt = Record<string, unknown>;

function usageLine(usage: Record<string, number> | null): string {
  return JSON.stringify({ type: "turn_end", message: { role: "assistant", provider: "tiprouter", model: "m", content: [], ...(usage ? { usage } : {}) } }) + "\n";
}

function terminalLines(usage: Record<string, number> | null): string {
  return usageLine(usage) + JSON.stringify({ type: "agent_end", messages: [] }) + "\n";
}

function processResult(overrides: Record<string, unknown> = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 4321,
    startedAt: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe("OMP local usage checkpoint", () => {
  let root: string;
  let commandPath: string;
  let receipts: UsageReceipt[];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-usage-"));
    commandPath = path.join(root, "fake-omp");
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    receipts = [];
    runProcessMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function run(overrides: Record<string, unknown>, rpcSteering = false) {
    await execute({
      runId: "run-usage",
      agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, cwd: root, noSession: true, rpcSteering, ...overrides },
      context: {},
      onLog: async () => {},
      onUsage: async (receipt) => { receipts.push(receipt as unknown as UsageReceipt); },
    });
    return receipts;
  }

  function stdoutWith(withUsage: boolean) {
    return async (...args: unknown[]) => {
      const options = args[4] as { onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void> };
      await options.onLog("stdout", terminalLines(withUsage ? { inputTokens: 10, outputTokens: 3, cachedInputTokens: 2, costUsd: 0.25 } : null));
      return processResult({ stdout: "" });
    };
  }

  it("checkpoints usage from the print-mode transport", async () => {
    runProcessMock.mockImplementation(stdoutWith(true));
    const received = await run({});
    expect(received.length).toBeGreaterThan(0);
    const last = received[received.length - 1]!;
    expect(last.usage).toEqual({ inputTokens: 10, outputTokens: 3, cachedInputTokens: 2 });
    expect(last.costUsd).toBe(0.25);
    expect(last.usageBasis).toBe("per_run");
    expect(last.biller).toBe("tiprouter");
    expect(last.attemptId).toBeTruthy();
    expect(last.costStatus).toBeUndefined();
    expect(last.complete).toBe(true);
  });

  it("checkpoints usage from the RPC transport", async () => {
    runProcessMock.mockImplementation(stdoutWith(true));
    const received = await run({}, true);
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1]!.usage).toEqual({ inputTokens: 10, outputTokens: 3, cachedInputTokens: 2 });
  });

  it("marks a run with no reported usage unpriced instead of a zero-cost success", async () => {
    runProcessMock.mockImplementation(stdoutWith(false));
    const received = await run({});
    const last = received[received.length - 1]!;
    expect(last.usage).toBeUndefined();
    expect(last.costStatus).toBe("unpriced");
    expect(last.complete).toBe(false);
  });
});
