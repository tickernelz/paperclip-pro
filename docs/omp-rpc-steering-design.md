# Design note: steering for `omp_local` via OMP RPC mode

Status: decided by the owner, not yet implemented.

## Why steering is unreachable today (three gates, all verified)

1. **All runs are legacy.** 160 of 160 historical `heartbeat_runs` are `runtime_mode: "legacy"`, zero native ever. All 36 agents are `adapter_type: "omp_local"`.
2. **Legacy never enters the native path.** `resolveNativeRuntimeMode` returns `{kind: "legacy", reason: "direct_adapter"}` unless `agent.adapterType === "paperclip_runner"` (`server/src/services/native-runtime/runtime-mode.ts:106-117`). Only the native path registers sessions in `activeNativeSessions` (`native-session-executor.ts:8359`), and `steerNativeSession` requires that entry (`:6335-6345`).
3. **Even native would not help for omp today.** The ACPX driver — which serves `pi`/omp, `claude`, and codex-via-acpx — declares `steering: false` and lists it in `unsupported` (`packages/paperclip-runner/src/drivers/acpx/driver-profile.ts:44,55`). Only the direct codex app-server driver implements `steer` (`drivers/codex/codex-harness-session.ts:302` via `turn/steer`). ACP has no steer method.

## The design the owner chose

Keep `omp_local` as the adapter. Drive OMP in **RPC mode** instead of one-shot print mode, and expose `steer` through the driver contract that already exists.

### The contract is already there
`steer?(input: {turnId, message, correlationId})` is an OPTIONAL method on `NativeSessionBackend` (`packages/paperclip-runner/src/contracts/native-session-backend.ts:156`), gated by `capabilities.steering` (`contracts/types.ts:30`). This implements an existing method; it does not invent architecture.

### OMP already speaks the protocol
`omp --mode rpc` reads JSON commands on stdin and writes JSON frames on stdout, one object per line.

Commands (`@oh-my-pi/pi-coding-agent/src/modes/rpc/rpc-types.ts:28-40`):
```
{ id?, type: "prompt",  message, images?, streamingBehavior? }
{ id?, type: "steer",   message, images? }
{ id?, type: "follow_up", message, images? }
{ id?, type: "abort" }
```

Response (`rpc-types.ts:196-215`):
```
{ id?, type: "response", command: "steer", success: true }
```
Handler: `modes/rpc/rpc-mode.ts:1071` `case "steer": { await session.steer(command.message, command.images); return success(id, "steer"); }`.

### Delivery semantics inherited from OMP
`pi-agent-core/src/agent.ts:990-997`: *"Queue a steering message to interrupt the agent mid-run. Delivered after current tool execution, skips remaining tools."* With `interruptMode: "immediate"` (default, `agent.ts:468`) the check runs after each tool call — so a steered message lands **between tool calls, never mid-stream**.

## The transport, stated correctly

**Correction to an earlier draft of this note.** The sequenced-stdin path (`stdinDir` + `stdinSeq`, `packages/adapter-utils/src/execution-target.ts:1995-2123`) is **sandbox-only**. Its single production caller is `packages/adapter-utils/src/acpx-engine/execute.ts:2378-2381`, and it passes `target: remoteTarget`; every test caller also uses `kind: "remote"`. `omp_local` on this instance runs **local**, where `runAdapterExecutionTargetProcess` accepts only `stdin?: string` — a single write, no live channel. Do not plan against the sandbox path.

**What actually exists and can be reused.** The process-session wrapper at `execution-target.ts:3130-3175` does `spawn(config.command, args, { stdio: ["pipe","pipe","pipe"] })` and carries a `PROCESS_SESSION_STDIN_POLL_TAIL` that polls a stdin directory and forwards frames to the live child's stdin, with a per-session serialized write chain. That is exactly the channel an RPC steer frame needs. Today it is wired only for remote/sandbox targets; using it locally is the actual work.

## Implementation shape

1. **Transport.** Enable the existing process-session stdin channel for the **local** execution path, or write the equivalent live-stdin handle for local spawn. Either way the requirement is a two-way channel to a running child, not a one-shot `stdin` string.
2. **Framing.** Spawn `omp --mode rpc` instead of `omp --mode json -p`, write one JSON object per line, read response frames back.
3. **Ack.** `steerNativeSession` resolves only after acknowledgement, so the transport must surface the `{type:"response", command:"steer", success:true}` frame rather than fire-and-forget.
4. **Session registration.** Register the live RPC session so `steerNativeSession` can reach it — either extend `activeNativeSessions` from the omp_local path or add an adapter-local registry consulted by the same seam. Decide against the code, not by preference.
5. **Capability.** Declare `steering: true` for omp_local **only when the RPC path is active**. A capability that is true but unreachable is worse than one that is false.
6. **Failure vocabulary.** Reuse what the server already maps: `steering_unsupported`, `steering_temporarily_unavailable`, `steering_stale_turn`, `steering_timeout`, `steering_rejected` (`native-session-executor.ts:6186-6190`).
7. **Staging.** Keep `--mode json -p` as the DEFAULT and add RPC as opt-in, with a test proving the default path is byte-identical. Flipping 36 production agents from one-shot print to a long-lived RPC session changes event parsing, progress reporting, session lifecycle, cancellation, and failure handling — that is a cutover, not a patch.

## What must not be done
- Do not remove the conversation-issue steering ban as a shortcut. On this configuration it produces a 409-free path that still always queues — a silent no-op.
- Do not migrate agents to `paperclip_runner` as the fix; the owner chose to keep `omp_local`.

## Rollback
The opt-in flag returns every agent to `--mode json -p` with no other change. Nothing about the legacy path is modified.
