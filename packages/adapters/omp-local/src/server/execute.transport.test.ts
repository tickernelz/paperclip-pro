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

  it("keeps a verbose RPC run inside the result budget and retains ompTransport", async () => {
    const blob = "z".repeat(40_000);
    const sink = {
      on: () => {},
      write: (_data: string, cb: (error?: Error | null) => void) => cb(),
      end: () => {},
    };

    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      options: {
        liveStdin?: { bind: (stream: unknown) => void } | null;
        onLog: (stream: string, chunk: string) => Promise<void>;
      },
    ) => {
      options.liveStdin?.bind(sink);
      const emit = (frame: unknown) => options.onLog("stdout", `${JSON.stringify(frame)}\n`);
      await emit({
        type: "ready",
        protocolVersion: 1,
        supportedProtocolVersions: [1, 2],
        maxFrameBytes: 1048576,
        maxReassembledFrameBytes: 67108864,
      });
      await emit({ id: "negotiate-1", type: "response", command: "negotiate_protocol", success: true });
      await emit({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "s-1" } });
      await emit({ id: "prompt-1", type: "response", command: "prompt", success: true });
      for (let index = 0; index < 40; index += 1) {
        await emit({
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: blob }] },
          assistantMessageEvent: { type: "text_delta", delta: blob, partial: { content: [{ type: "text", text: blob }] } },
        });
      }
      await emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
      await emit({ type: "agent_end", isTerminal: true, messages: [] });
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: blob.repeat(10),
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);

    const result = await execute({
      runId: "run-transport",
      agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd },
      context: {},
      onLog: async () => {},
    } as never);

    const resultJson = (result.resultJson ?? {}) as Record<string, unknown>;
    expect(resultJson.ompTransport).toEqual({ mode: "rpc", protocolVersion: 2 });
    expect(String(resultJson.stdout ?? "").length).toBeLessThanOrEqual(16 * 1024);
    expect(String(resultJson.stdout ?? "")).not.toContain("partial");
    expect(resultJson.truncationReason).toBeUndefined();
    expect(resultJson.originalSizeBytes).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(resultJson), "utf8")).toBeLessThan(64 * 1024);
  });

});
