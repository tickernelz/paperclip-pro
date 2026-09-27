import { beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import type { BoundLiveStdinChannel } from "@tickernelz/paperclip-pro-adapter-utils/live-stdin-channel";
import { createOmpRpcSteerSession, runOmpRpcSession } from "./rpc-session.js";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

type Harness = {
  stdinFrames: Record<string, unknown>[];
  logged: string[];
  errors: string[];
  feed: (frame: Record<string, unknown> | string) => Promise<void>;
  finish: () => void;
  close: () => void;
  ends: () => number;
};

function harness(): Harness {
  const stdinFrames: Record<string, unknown>[] = [];
  const logged: string[] = [];
  const errors: string[] = [];
  let stdinText = "";
  let endCount = 0;
  let logSink: ((stream: "stdout" | "stderr", chunk: string) => Promise<void>) | null = null;
  let channel: BoundLiveStdinChannel | null = null;
  let markBound = () => {};
  let releaseProcess = () => {};
  const bound = new Promise<void>((resolve) => {
    markBound = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseProcess = resolve;
  });

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      stdinText += String(chunk);
      let newline = stdinText.indexOf("\n");
      while (newline >= 0) {
        const line = stdinText.slice(0, newline).trim();
        stdinText = stdinText.slice(newline + 1);
        if (line) stdinFrames.push(JSON.parse(line) as Record<string, unknown>);
        newline = stdinText.indexOf("\n");
      }
      callback();
    },
    final(callback) {
      endCount += 1;
      callback();
    },
  });

  runProcessMock.mockReset();
  runProcessMock.mockImplementation((async (
    _runId: string,
    _target: unknown,
    _command: string,
    _args: string[],
    options: {
      liveStdin?: BoundLiveStdinChannel | null;
      onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
    },
  ) => {
    channel = options.liveStdin ?? null;
    channel?.bind(stream);
    logSink = options.onLog;
    markBound();
    await released;
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

  return {
    stdinFrames,
    logged,
    errors,
    async feed(frame) {
      await bound;
      const line = typeof frame === "string" ? frame : `${JSON.stringify(frame)}\n`;
      await logSink?.("stdout", line);
    },
    finish() {
      releaseProcess();
    },
    close() {
      channel?.close();
    },
    ends: () => endCount,
  };
}

function run(session = createOmpRpcSteerSession(), prompt = "Do the work") {
  return runOmpRpcSession({
    runId: "run-rpc",
    command: "omp",
    args: ["--mode", "rpc"],
    cwd: "/tmp",
    env: {},
    timeoutSec: 30,
    graceSec: 5,
    prompt,
    runtimeTarget: null,
    onLog: async (stream, chunk) => {
      if (stream === "stdout") state.logged.push(chunk);
      else state.errors.push(chunk);
    },
    session,
  });
}

let state: Harness;

beforeEach(() => {
  state = harness();
});

describe("OMP RPC session protocol", () => {
  it("negotiates protocol v2 before requesting state or sending the prompt", async () => {
    const running = run();
    await state.feed({
      type: "ready",
      protocolVersion: 1,
      supportedProtocolVersions: [1, 2],
      maxFrameBytes: 1048576,
      maxReassembledFrameBytes: 67108864,
    });

    expect(state.stdinFrames[0]).toEqual({
      id: "negotiate-1",
      type: "negotiate_protocol",
      protocolVersion: 2,
    });
    expect(state.stdinFrames).toHaveLength(1);

    await state.feed({ id: "negotiate-1", type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } });
    expect(state.stdinFrames[1]).toEqual({ id: "state-1", type: "get_state" });

    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-42" } });
    expect(state.stdinFrames[2]).toEqual({ id: "prompt-1", type: "prompt", message: "Do the work" });

    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    const result = await running;
    expect(result.sessionId).toBe("session-42");
    expect(result.promptAcknowledged).toBe(true);
    expect(result.promptError).toBeNull();
    expect(result.protocolVersion).toBe(2);
  });

  it("skips negotiation and prompts when the child advertises protocol v1 only", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });

    expect(state.stdinFrames[0]).toEqual({ id: "state-1", type: "get_state" });
    expect(state.stdinFrames.some((frame) => frame.type === "negotiate_protocol")).toBe(false);

    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-v1" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    const result = await running;
    expect(result.protocolVersion).toBe(1);
    expect(result.sessionId).toBe("session-v1");
    expect(state.stdinFrames[1]).toEqual({ id: "prompt-1", type: "prompt", message: "Do the work" });
  });

  it("fails the run when protocol negotiation is rejected", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
    await state.feed({
      id: "negotiate-1",
      type: "response",
      command: "negotiate_protocol",
      success: false,
      error: "Unsupported RPC protocol version: 2",
    });

    state.finish();
    const result = await running;
    expect(result.promptError).toBe("Unsupported RPC protocol version: 2");
    expect(result.protocolVersion).toBeNull();
    expect(state.stdinFrames.some((frame) => frame.type === "prompt")).toBe(false);
  });

  it("fails the run when the prompt is rejected instead of reporting success", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
    await state.feed({ id: "negotiate-1", type: "response", command: "negotiate_protocol", success: true });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-7" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: false, error: "Agent is already processing." });

    state.finish();
    const result = await running;
    expect(result.promptError).toBe("Agent is already processing.");
    expect(result.promptAcknowledged).toBe(false);
    expect(result.sessionId).toBe("session-7");
  });

  it("fails the run when the prompt was never dispatched", async () => {
    const session = createOmpRpcSteerSession();
    const running = run(session);
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
    state.close();

    state.finish();
    const result = await running;
    expect(result.promptAcknowledged).toBe(false);
    expect(result.promptError).toBe("OMP RPC mode ended before the run's prompt was dispatched.");
  });

  it("fails the run when prompt_result reports an error", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-failed" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({
      type: "prompt_result",
      id: "prompt-1",
      agentInvoked: true,
      status: "error",
      error: { message: "provider rejected the request", retryable: false },
      sessionSettled: true,
    });
    state.finish();

    const result = await running;
    expect(result.promptError).toBe("provider rejected the request");
    expect(state.ends()).toBe(1);
  });

  it("settles the run when prompt_result reports the agent was never invoked", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-local" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({
      type: "prompt_result",
      id: "prompt-1",
      agentInvoked: false,
      status: "completed",
      sessionSettled: true,
    });
    state.finish();

    const result = await running;
    expect(result.promptError).toBeNull();
    expect(state.ends()).toBe(1);
  });

  it("reassembles chunked frames and logs the logical frame rather than the base64 chunk", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
    await state.feed({ id: "negotiate-1", type: "response", command: "negotiate_protocol", success: true });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-chunk" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });

    const logical = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: `${"x".repeat(1024 * 1024)}chunked reply` }] },
    });
    const bytes = Buffer.from(logical, "utf8");
    const payloadBytes = 256 * 1024;
    const count = Math.ceil(bytes.byteLength / payloadBytes);
    for (let index = 0; index < count - 1; index += 1) {
      await state.feed({
        type: "rpc_chunk",
        chunkId: "rpc-1",
        index,
        count,
        byteLength: bytes.byteLength,
        data: bytes.subarray(index * payloadBytes, (index + 1) * payloadBytes).toString("base64"),
      });
    }
    expect(state.logged.some((chunk) => chunk.includes("rpc_chunk"))).toBe(false);

    const lastIndex = count - 1;
    await state.feed({
      type: "rpc_chunk",
      chunkId: "rpc-1",
      index: lastIndex,
      count,
      byteLength: bytes.byteLength,
      data: bytes.subarray(lastIndex * payloadBytes).toString("base64"),
    });
    expect(state.logged.some((chunk) => chunk.includes("chunked reply"))).toBe(true);
    expect(state.logged.some((chunk) => chunk.includes("rpc_chunk"))).toBe(false);

    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    await running;
  });

  it("keeps transport control frames out of the adapter transcript", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
    await state.feed({ type: "available_commands_update", commands: [{ name: "compact" }] });
    await state.feed({ id: "negotiate-1", type: "response", command: "negotiate_protocol", success: true });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-quiet" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_start" });
    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    await running;

    const transcript = state.logged.join("");
    expect(transcript).not.toContain("available_commands_update");
    expect(transcript).not.toContain("negotiate_protocol");
    expect(transcript).not.toContain("get_state");
    expect(transcript).toContain("agent_start");
  });

  it("passes notice frames through to the transcript sink", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-notice" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({
      type: "notice",
      level: "warning",
      message: 'Warning: MCP server "paperclip" failed to connect: spawn ENOENT; its tools are unavailable for this run.',
    });
    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    await running;

    expect(state.logged.join("")).toContain("failed to connect: spawn ENOENT");
  });

  it("surfaces a transport-dropped frame on stderr instead of silently losing it", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ type: "rpc_frame_error", originalType: "agent_end", error: "RPC frame exceeded the transport limit" });
    state.close();
    state.finish();
    await running;

    expect(state.errors.join("")).toContain("RPC frame exceeded the transport limit");
  });

  it("closes the run's stdin once the terminal agent_end arrives", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-end" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    await running;

    expect(state.ends()).toBe(1);
  });

  it("closes the run's stdin on session_settled too", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-settled" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_end", isTerminal: false, messages: [] });
    expect(state.ends()).toBe(0);

    await state.feed({ type: "session_settled" });
    state.finish();
    await running;

    expect(state.ends()).toBe(1);
  });

  it("observes a frame before handing it to the transcript sink", async () => {
    const session = createOmpRpcSteerSession();
    const observedAtEmit: (string | null)[] = [];
    const running = runOmpRpcSession({
      runId: "run-rpc-order",
      command: "omp",
      args: ["--mode", "rpc"],
      cwd: "/tmp",
      env: {},
      timeoutSec: 30,
      graceSec: 5,
      prompt: "Do the work",
      runtimeTarget: null,
      onLog: async (stream, chunk) => {
        if (stream !== "stdout" || !chunk.includes("agent_start")) return;
        observedAtEmit.push((await session.snapshot()).activeTurnId);
      },
      session,
    });
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-order" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_start" });
    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    await running;

    expect(observedAtEmit).toHaveLength(1);
    expect(observedAtEmit[0]).toMatch(/^omp-rpc-turn:/);
  });

  it("keeps the run open while a continuation agent_end is not terminal", async () => {
    const running = run();
    await state.feed({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
    await state.feed({ id: "state-1", type: "response", command: "get_state", success: true, data: { sessionId: "session-cont" } });
    await state.feed({ id: "prompt-1", type: "response", command: "prompt", success: true });
    await state.feed({ type: "agent_end", isTerminal: false, messages: [] });

    expect(state.ends()).toBe(0);

    await state.feed({ type: "agent_end", isTerminal: true, messages: [] });
    state.finish();
    await running;
    expect(state.ends()).toBe(1);
  });
});

describe("OMP RPC steering session", () => {
  it("reports steering only while a writer is bound and the session is open", async () => {
    const session = createOmpRpcSteerSession();
    expect(await session.capabilities()).toEqual({ steering: true });
    expect(await session.snapshot()).toEqual({ activeTurnId: null });

    session.close();
    expect(await session.capabilities()).toEqual({ steering: false });
  });

  it("exposes the active turn while streaming and clears it at the terminal end", () => {
    const session = createOmpRpcSteerSession();
    session.observeFrame({ type: "agent_start" });
    const turn = session.snapshot();
    void turn.then((value) => expect(value.activeTurnId).toMatch(/^omp-rpc-turn:/));

    session.observeFrame({ type: "agent_end", isTerminal: true });
    void session.snapshot().then((value) => expect(value.activeTurnId).toBeNull());
  });

  it("rejects a steer for a turn other than the active one", async () => {
    const session = createOmpRpcSteerSession();
    session.setWriter(async () => {});
    session.observeFrame({ type: "agent_start" });
    const snapshot = await session.snapshot();

    await expect(
      session.steer({
        turnId: "some-other-turn",
        message: { role: "user", text: "stale" },
        correlationId: "c1",
      }),
    ).rejects.toThrow("stale active turn");
    expect(snapshot.activeTurnId).not.toBeNull();
  });

  it("resolves a steer only after the provider acknowledges it", async () => {
    const session = createOmpRpcSteerSession();
    const written: Record<string, unknown>[] = [];
    session.setWriter(async (data) => {
      written.push(JSON.parse(data.trim()) as Record<string, unknown>);
    });
    session.observeFrame({ type: "agent_start" });
    const { activeTurnId } = await session.snapshot();

    const steering = session.steer({
      turnId: activeTurnId as string,
      message: { role: "user", text: "Check mobile overflow first." },
      correlationId: "comment-1",
    });
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toEqual({
      id: "comment-1",
      type: "steer",
      message: "Check mobile overflow first.",
    });

    session.observeFrame({ id: "comment-1", type: "response", command: "steer", success: true });
    await expect(steering).resolves.toBeUndefined();
  });

  it("rejects the steer when the provider refuses it", async () => {
    const session = createOmpRpcSteerSession();
    session.setWriter(async () => {});
    session.observeFrame({ type: "agent_start" });
    const { activeTurnId } = await session.snapshot();

    const steering = session.steer({
      turnId: activeTurnId as string,
      message: { role: "user", text: "nope" },
      correlationId: "comment-refused",
    });
    session.observeFrame({
      id: "comment-refused",
      type: "response",
      command: "steer",
      success: false,
      error: "request rejected",
    });

    await expect(steering).rejects.toThrow("request rejected");
  });

  it("rejects a steer once the session closed", async () => {
    const session = createOmpRpcSteerSession();
    session.setWriter(async () => {});
    session.observeFrame({ type: "agent_start" });
    const { activeTurnId } = await session.snapshot();
    session.close();

    await expect(
      session.steer({
        turnId: activeTurnId as string,
        message: { role: "user", text: "after close" },
        correlationId: "comment-closed",
      }),
    ).rejects.toThrow("omp_rpc_session_unavailable");
  });

  it("rejects a steer with no writer bound", async () => {
    const session = createOmpRpcSteerSession();
    session.observeFrame({ type: "agent_start" });
    const { activeTurnId } = await session.snapshot();

    await expect(
      session.steer({
        turnId: activeTurnId as string,
        message: { role: "user", text: "no writer" },
        correlationId: "comment-no-writer",
      }),
    ).rejects.toThrow("omp_rpc_session_unavailable");
  });
});
