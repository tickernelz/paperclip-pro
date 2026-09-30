import { randomUUID } from "node:crypto";
import type { AdapterExecutionTarget } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import type { RunProcessResult } from "@tickernelz/paperclip-pro-adapter-utils/server-utils";
import {
  createLiveStdinChannel,
  type BoundLiveStdinChannel,
} from "@tickernelz/paperclip-pro-adapter-utils/live-stdin-channel";

const STEER_ACK_TIMEOUT_MS = 12_000;
const DEFAULT_CONTINUATION_IDLE_MS = 60_000;
const DEFAULT_IDLE_RECHECK_MS = 250;
const MAX_IDLE_CHECKS = 20;
const RPC_PROTOCOL_VERSION = 2;
const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;
const RPC_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const MESSAGE_SNAPSHOT_TYPES = new Set(["message_start", "message_end", "turn_end"]);
const TURN_WORK_FRAME_TYPES = new Set([
  "agent_start",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "auto_compaction_start",
  "auto_compaction_end",
  "auto_retry_start",
  "auto_retry_end",
]);

function stripProviderPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!("providerPayload" in record)) return value;
  const { providerPayload: _dropped, ...rest } = record;
  return rest;
}

/** Mirrors print mode's event shaping: drop `message_update` snapshots and `providerPayload`. */
export function shapeOmpRpcFrame(frame: Record<string, unknown>): Record<string, unknown> {
  const type = typeof frame.type === "string" ? frame.type : "";
  const { message: frameMessage, ...frameRest } = frame;
  if (type === "message_update") {
    const streamEvent = frame.assistantMessageEvent;
    if (!streamEvent || typeof streamEvent !== "object" || Array.isArray(streamEvent)) {
      return frameRest;
    }
    const stream = streamEvent as Record<string, unknown>;
    if (stream.type === "done" || stream.type === "error") {
      return { type, assistantMessageEvent: { type: stream.type, reason: stream.reason } };
    }
    const { partial: _partial, ...streamRest } = stream;
    return { ...frameRest, assistantMessageEvent: streamRest };
  }
  if (type === "agent_end") {
    return {
      ...frame,
      messages: Array.isArray(frame.messages) ? frame.messages.map(stripProviderPayload) : frame.messages,
    };
  }
  if (MESSAGE_SNAPSHOT_TYPES.has(type)) {
    const shaped: Record<string, unknown> = { ...frameRest, message: stripProviderPayload(frameMessage) };
    if (type === "turn_end" && Array.isArray(frame.toolResults)) {
      shaped.toolResults = frame.toolResults.map(stripProviderPayload);
    }
    return shaped;
  }
  return frame;
}

const PROTOCOL_FRAME_TYPES = new Set([
  "ready",
  "response",
  "rpc_chunk",
  "available_commands_update",
  "session_info_update",
  "config_update",
  "command_output",
  "prompt_result",
  "extension_ui_request",
  "subagent_lifecycle",
  "subagent_progress",
  "subagent_event",
]);

interface PendingRpcChunks {
  chunkId: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  receivedBytes: number;
  chunks: Buffer[];
}

export class OmpRpcChunkAssembler {
  private pending: PendingRpcChunks | null = null;

  push(frame: Record<string, unknown>): Record<string, unknown> | null {
    if (frame.type !== "rpc_chunk") {
      if (this.pending) throw new Error("omp_rpc_chunk_sequence_interrupted");
      return frame;
    }
    const chunkId = typeof frame.chunkId === "string" ? frame.chunkId : "";
    const index = frame.index;
    const count = frame.count;
    const byteLength = frame.byteLength;
    const data = frame.data;
    if (
      !chunkId ||
      chunkId.length > 128 ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(byteLength) ||
      (index as number) < 0 ||
      (count as number) < 2 ||
      (count as number) > Math.ceil(RPC_MAX_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES) ||
      (index as number) >= (count as number) ||
      (byteLength as number) < 1024 * 1024 ||
      (byteLength as number) > RPC_MAX_REASSEMBLED_BYTES ||
      typeof data !== "string"
    ) {
      throw new Error("omp_rpc_chunk_metadata_invalid");
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) throw new Error("omp_rpc_chunk_data_invalid");
    if (bytes.byteLength > RPC_CHUNK_PAYLOAD_BYTES) throw new Error("omp_rpc_chunk_payload_too_large");
    if (!this.pending) {
      if (index !== 0) throw new Error("omp_rpc_chunk_sequence_start_invalid");
      this.pending = {
        chunkId,
        count: count as number,
        byteLength: byteLength as number,
        nextIndex: 0,
        receivedBytes: 0,
        chunks: [],
      };
    }
    const pending = this.pending;
    if (
      pending.chunkId !== chunkId ||
      pending.count !== count ||
      pending.byteLength !== byteLength ||
      pending.nextIndex !== index
    ) {
      throw new Error("omp_rpc_chunk_sequence_mismatch");
    }
    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex += 1;
    if (pending.receivedBytes > pending.byteLength) throw new Error("omp_rpc_chunk_sequence_overflow");
    if (pending.nextIndex < pending.count) return null;
    if (pending.receivedBytes !== pending.byteLength) throw new Error("omp_rpc_chunk_sequence_incomplete");
    this.pending = null;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks));
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("omp_rpc_chunk_frame_invalid");
    }
    return parsed as Record<string, unknown>;
  }
}

export interface OmpRpcSteerSession {
  readonly closed: boolean;
  setWriter(write: ((data: string) => Promise<void>) | null): void;
  observeFrame(frame: Record<string, unknown>): void;
  close(): void;
  capabilities(): Promise<{ steering: boolean }>;
  snapshot(): Promise<{ activeTurnId: string | null }>;
  steer(input: {
    turnId: string;
    message: { role: "user"; text: string };
    correlationId?: string;
    ackTimeoutMs?: number;
  }): Promise<void>;
  whenSteersSettled(): Promise<void>;
}

type PendingAck = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  settled: Promise<void>;
};

export function createOmpRpcSteerSession(): OmpRpcSteerSession {
  let writer: ((data: string) => Promise<void>) | null = null;
  let closed = false;
  let activeTurnId: string | null = null;
  const pending = new Map<string, PendingAck>();

  const failAll = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  return {
    get closed() {
      return closed;
    },
    setWriter(next) {
      writer = next;
    },
    observeFrame(frame) {
      const type = typeof frame.type === "string" ? frame.type : "";
      if (type === "agent_start" || type === "turn_start") {
        activeTurnId ??= `omp-rpc-turn:${randomUUID()}`;
        return;
      }
      if (type === "agent_end" && frame.isTerminal !== false) {
        activeTurnId = null;
        return;
      }
      if (type === "session_settled") {
        activeTurnId = null;
        return;
      }
      if (type !== "response") return;
      const id = typeof frame.id === "string" ? frame.id : "";
      const entry = id ? pending.get(id) : undefined;
      if (!entry) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      if (frame.command !== "steer" || frame.success !== true) {
        entry.reject(
          new Error(
            typeof frame.error === "string" && frame.error
              ? frame.error
              : "omp_rpc_steer_rejected",
          ),
        );
        return;
      }
      entry.resolve();
    },
    close() {
      if (closed) return;
      closed = true;
      writer = null;
      activeTurnId = null;
      failAll(new Error("omp_rpc_session_closed"));
    },
    async capabilities() {
      return { steering: !closed };
    },
    async snapshot() {
      return { activeTurnId };
    },
    async steer(input) {
      if (closed || !writer) {
        throw new Error("omp_rpc_session_unavailable");
      }
      if (activeTurnId === null || input.turnId !== activeTurnId) {
        throw new Error("stale active turn");
      }
      const id = input.correlationId?.trim() || `steer-${randomUUID()}`;
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const ack = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      const settled = ack.then(
        () => undefined,
        () => undefined,
      );
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("omp_rpc_steer_timeout"));
      }, input.ackTimeoutMs ?? STEER_ACK_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer, settled });
      try {
        await writer(
          `${JSON.stringify({ id, type: "steer", message: input.message.text })}\n`,
        );
      } catch (error) {
        const entry = pending.get(id);
        if (entry) {
          pending.delete(id);
          clearTimeout(entry.timer);
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
      await ack;
    },
    async whenSteersSettled() {
      while (pending.size > 0) {
        await Promise.all([...pending.values()].map((entry) => entry.settled));
      }
    },
  };
}

export interface OmpRpcRunInput {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
  prompt: string;
  runtimeTarget: AdapterExecutionTarget | null | undefined;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  onSpawn?: (meta: {
    pid: number;
    processGroupId: number | null;
    startedAt: string;
  }) => Promise<void>;
  onRuntimeProgress?: Parameters<
    typeof runAdapterExecutionTargetProcess
  >[4]["onRuntimeProgress"];
  session: OmpRpcSteerSession;
  continuationIdleMs?: number;
  idleRecheckMs?: number;
}

export interface OmpRpcRunResult {
  proc: RunProcessResult;
  promptAcknowledged: boolean;
  promptError: string | null;
  protocolVersion: number | null;
  sessionId: string | null;
}

export async function runOmpRpcSession(
  input: OmpRpcRunInput,
): Promise<OmpRpcRunResult> {
  const channel: BoundLiveStdinChannel = createLiveStdinChannel();
  const session = input.session;
  session.setWriter((data) => channel.write(data));
  const assembler = new OmpRpcChunkAssembler();
  let buffer = "";
  let promptAcknowledged = false;
  let promptError: string | null = null;
  let promptSent = false;
  let negotiated: number | null = null;
  let settled = false;
  let sessionId: string | null = null;
  let continuationIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let pausedForContinuation = false;
  let compacting = false;
  let turnOpen = false;
  let lastTurnWorkAt = 0;
  let idleCheckSeq = 0;
  let idleCheckRequestedAgain = false;
  let idleCheckId: string | null = null;
  let idleCheckAttempts = 0;
  let idleRecheckTimer: ReturnType<typeof setTimeout> | null = null;
  const continuationIdleMs = input.continuationIdleMs ?? DEFAULT_CONTINUATION_IDLE_MS;
  const idleRecheckMs = input.idleRecheckMs ?? DEFAULT_IDLE_RECHECK_MS;

  const disarmContinuationIdle = () => {
    if (!continuationIdleTimer) return;
    clearTimeout(continuationIdleTimer);
    continuationIdleTimer = null;
  };

  const closeStdinOnce = () => {
    disarmContinuationIdle();
    clearTimeout(idleRecheckTimer ?? undefined);
    idleRecheckTimer = null;
    pausedForContinuation = false;
    if (settled) return;
    settled = true;
    channel.close();
  };

  const scheduleContinuationIdle = () => {
    disarmContinuationIdle();
    if (!pausedForContinuation || compacting || turnOpen || settled) return;
    const remaining = Math.max(0, lastTurnWorkAt + continuationIdleMs - Date.now());
    continuationIdleTimer = setTimeout(() => {
      continuationIdleTimer = null;
      if (!pausedForContinuation || compacting || turnOpen || settled) return;
      if (Date.now() - lastTurnWorkAt < continuationIdleMs) {
        scheduleContinuationIdle();
        return;
      }
      closeStdinOnce();
      void input
        .onLog(
          "stderr",
          `[paperclip] OMP paused for pending background work and did no turn work for ${Math.round(continuationIdleMs / 1000)}s; ending the run so leftover jobs are reaped, as print mode does.\n`,
        )
        .catch(() => undefined);
    }, remaining);
  };

  const noteTurnWork = (type: string) => {
    lastTurnWorkAt = Date.now();
    if (type === "auto_compaction_start") compacting = true;
    if (type === "auto_compaction_end") compacting = false;
    if (type === "turn_start") turnOpen = true;
    if (type === "turn_end") turnOpen = false;
    if (type === "agent_start") {
      pausedForContinuation = false;
      disarmContinuationIdle();
      return;
    }
    scheduleContinuationIdle();
  };

  const send = async (frame: Record<string, unknown>): Promise<void> => {
    if (channel.closed) return;
    await channel.write(`${JSON.stringify(frame)}\n`);
  };

  const requestIdleCheck = async (): Promise<void> => {
    if (settled) return;
    if (idleCheckId !== null) {
      idleCheckRequestedAgain = true;
      return;
    }
    await session.whenSteersSettled();
    if (settled) return;
    if (idleCheckId !== null) {
      idleCheckRequestedAgain = true;
      return;
    }
    idleCheckRequestedAgain = false;
    idleCheckSeq += 1;
    idleCheckId = `idle-${idleCheckSeq}`;
    await send({ id: idleCheckId, type: "get_state" });
  };

  const scheduleIdleRecheck = () => {
    clearTimeout(idleRecheckTimer ?? undefined);
    idleRecheckTimer = setTimeout(() => {
      idleRecheckTimer = null;
      void requestIdleCheck();
    }, idleRecheckMs);
  };

  const handleFrame = async (frame: Record<string, unknown>): Promise<void> => {
    session.observeFrame(frame);
    const type = typeof frame.type === "string" ? frame.type : "";
    if (TURN_WORK_FRAME_TYPES.has(type)) noteTurnWork(type);
    if (type === "ready" && !promptSent) {
      const versions = Array.isArray(frame.supportedProtocolVersions)
        ? frame.supportedProtocolVersions
        : [];
      if (versions.includes(RPC_PROTOCOL_VERSION)) {
        await send({ id: "negotiate-1", type: "negotiate_protocol", protocolVersion: RPC_PROTOCOL_VERSION });
      } else {
        negotiated = typeof frame.protocolVersion === "number" ? frame.protocolVersion : 1;
        await send({ id: "state-1", type: "get_state" });
      }
      return;
    }
    if (type === "prompt_result") {
      const status = typeof frame.status === "string" ? frame.status : "";
      const detail = frame.error;
      const message =
        detail && typeof detail === "object" && !Array.isArray(detail) &&
        typeof (detail as Record<string, unknown>).message === "string"
          ? String((detail as Record<string, unknown>).message).trim()
          : "";
      if (status === "error") {
        promptError = message || "OMP reported the prompt failed.";
        closeStdinOnce();
        return;
      }
      if (frame.agentInvoked === false) {
        closeStdinOnce();
      } else if (frame.sessionSettled === true) {
        void requestIdleCheck();
      }
      return;
    }
    if (type === "session_settled") {
      void requestIdleCheck();
      return;
    }
    if (type === "agent_start") {
      idleCheckId = null;
      idleCheckRequestedAgain = false;
      idleCheckAttempts = 0;
      clearTimeout(idleRecheckTimer ?? undefined);
      idleRecheckTimer = null;
    }
    if (type === "agent_end") {
      if (frame.isTerminal === false) {
        pausedForContinuation = true;
        lastTurnWorkAt = Date.now();
        scheduleContinuationIdle();
      } else {
        idleCheckAttempts = 0;
        void requestIdleCheck();
      }
      return;
    }
    if (type !== "response") return;
    const command = typeof frame.command === "string" ? frame.command : "";
    const success = frame.success === true;
    const error = typeof frame.error === "string" ? frame.error.trim() : "";
    if (command === "negotiate_protocol") {
      negotiated = success ? RPC_PROTOCOL_VERSION : null;
      if (!success) {
        promptError = error || "OMP rejected RPC protocol negotiation.";
        closeStdinOnce();
        return;
      }
      await send({ id: "state-1", type: "get_state" });
      return;
    }
    if (command === "get_state") {
      const data =
        frame.data && typeof frame.data === "object" && !Array.isArray(frame.data)
          ? (frame.data as Record<string, unknown>)
          : {};
      if (frame.id !== undefined && frame.id === idleCheckId) {
        idleCheckId = null;
        if (idleCheckRequestedAgain) {
          void requestIdleCheck();
          return;
        }
        const queued = typeof data.queuedMessageCount === "number" ? data.queuedMessageCount : 0;
        if (!success || (queued === 0 && data.isStreaming !== true)) {
          closeStdinOnce();
          return;
        }
        if (data.isStreaming === true) return;
        idleCheckAttempts += 1;
        if (idleCheckAttempts >= MAX_IDLE_CHECKS) {
          closeStdinOnce();
          await input.onLog(
            "stderr",
            `[paperclip] OMP still reported ${queued} queued message(s) after the turn ended; ending the run so the queue is delivered on the next turn.\n`,
          );
          return;
        }
        scheduleIdleRecheck();
        return;
      }
      if (typeof frame.id === "string" && frame.id.startsWith("idle-")) return;
      if (!promptSent) {
        const id = data.sessionId;
        if (typeof id === "string" && id.trim()) sessionId = id.trim();
        promptSent = true;
        await send({ id: "prompt-1", type: "prompt", message: input.prompt });
      }
      return;
    }
    if (command === "prompt") {
      if (!success) {
        promptError = error || "OMP rejected the prompt.";
        closeStdinOnce();
        return;
      }
      promptAcknowledged = true;
      const data = frame.data;
      const agentInvoked =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>).agentInvoked
          : undefined;
      if (agentInvoked === false) closeStdinOnce();
    }
  };

  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      await input.onLog("stdout", line);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      await input.onLog("stdout", line);
      return;
    }
    let frame: Record<string, unknown> | null;
    try {
      frame = assembler.push(parsed as Record<string, unknown>);
    } catch (error) {
      await input.onLog(
        "stderr",
        `[paperclip] ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return;
    }
    if (!frame) return;
    const type = typeof frame.type === "string" ? frame.type : "";
    await handleFrame(frame);
    if (type === "rpc_frame_error") {
      await input.onLog(
        "stderr",
        `[paperclip] OMP RPC frame dropped by the transport: ${String(frame.error ?? "unknown")}\n`,
      );
      return;
    }
    if (type === "extension_error") {
      await input.onLog(
        "stderr",
        `[paperclip] OMP extension error: ${String(frame.error ?? "unknown")}\n`,
      );
    }
    if (!PROTOCOL_FRAME_TYPES.has(type)) {
      await input.onLog("stdout", `${JSON.stringify(shapeOmpRpcFrame(frame))}\n`);
    }
  };

  const flushLines = async (chunk: string): Promise<void> => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline + 1);
      buffer = buffer.slice(newline + 1);
      await handleLine(line);
      newline = buffer.indexOf("\n");
    }
  };

  let proc: RunProcessResult;
  try {
    proc = await runAdapterExecutionTargetProcess(
      input.runId,
      input.runtimeTarget,
      input.command,
      input.args,
      {
        cwd: input.cwd,
        env: input.env,
        liveStdin: channel,
        timeoutSec: input.timeoutSec,
        graceSec: input.graceSec,
        onSpawn: input.onSpawn,
        onRuntimeProgress: input.onRuntimeProgress,
        onLog: async (stream, chunk) => {
          if (stream === "stderr") {
            await input.onLog("stderr", chunk);
            return;
          }
          await flushLines(chunk);
        },
      },
    );
    if (buffer) {
      await handleLine(buffer);
      buffer = "";
    }
  } finally {
    disarmContinuationIdle();
    clearTimeout(idleRecheckTimer ?? undefined);
    session.setWriter(null);
    session.close();
  }
  if (!promptSent && !promptError) {
    promptError = "OMP RPC mode ended before the run's prompt was dispatched.";
  }
  return { proc, promptAcknowledged, promptError, protocolVersion: negotiated, sessionId };
}
