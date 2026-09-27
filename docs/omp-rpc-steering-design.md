# Design note: steering for `omp_local` via OMP RPC mode

Status: decided by the owner, not yet implemented. Written after the delegated agent was killed.

## Why steering is unreachable today (all three gates verified)

1. **All runs are legacy.** 160 of 160 historical `heartbeat_runs` are `runtime_mode: "legacy"`, zero native ever. All 36 agents are `adapter_type: "omp_local"`.
2. **Legacy never enters the native path.** `resolveNativeRuntimeMode` returns `{kind: "legacy", reason: "direct_adapter"}` unless `agent.adapterType === "paperclip_runner"` (`server/src/services/native-runtime/runtime-mode.ts:106-117`). Only the native path registers sessions in `activeNativeSessions` (`native-session-executor.ts:8359`), and `steerNativeSession` requires that entry (`:6335-6345`).
3. **Even native would not help for omp today.** The ACPX driver — which serves `pi`/omp, `claude`, and codex-via-acpx — declares `steering: false` and lists it in `unsupported` (`packages/paperclip-runner/src/drivers/acpx/driver-profile.ts:44,55`). Only the direct codex app-server driver implements `steer` (`drivers/codex/codex-harness-session.ts:302` via `turn/steer`). ACP has no steer method.

## The design the owner chose

Keep `omp_local` as the adapter. Drive OMP in **RPC mode** instead of one-shot print mode, and expose `steer` through the driver contract that already exists.

### The contract is already there
- `steer?(input: {turnId, message, correlationId})` is an OPTIONAL method on `NativeSessionBackend` (`packages/paperclip-runner/src/contracts/native-session-backend.ts:156`), gated by `capabilities.steering` (`contracts/types.ts:30`). So this implements an existing method; it does not invent architecture.

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
`pi-agent-core/src/agent.ts:990-997`: *"Queue a steering message to interrupt the agent mid-run. Delivered after current tool execution, skips remaining tools."* With `interruptMode: "immediate"` (default, `agent.ts:468`) the check runs after each tool call — so a steered message lands **between tool calls, never mid-stream**. This is exactly the behaviour the owner described from OMP.

## Implementation shape

1. **Transport.** Spawn `omp --mode rpc` instead of `omp --mode json -p`. The execution-target layer already supports writing sequenced stdin to a live process (`packages/adapter-utils/src/execution-target.ts:1995-2123`, `stdinDir` + `stdinSeq` + per-session promise chain), so no new control channel is needed.
2. **Session registration.** Register the live RPC session so `steerNativeSession` can reach it. Either extend `activeNativeSessions` from the omp_local path or add an adapter-local registry consulted by the same seam. Decide against the code, not by preference.
3. **Capability.** Declare `steering: true` for omp_local **only when the RPC path is active**. A capability that is true but unreachable is worse than one that is false.
4. **Failure vocabulary.** Reuse what the server already maps: `steering_unsupported`, `steering_temporarily_unavailable`, `steering_stale_turn`, `steering_timeout`, `steering_rejected` (`native-session-executor.ts:6186-6190`).
5. **Staging.** Keep `--mode json -p` as the DEFAULT and add RPC as opt-in, with a test proving the default path is byte-identical. Flipping 36 production agents from one-shot print to a long-lived RPC session changes event parsing, progress reporting, session lifecycle, cancellation, and failure handling — that is a cutover, not a patch.

## What must not be done
- Do not remove the conversation-issue steering ban as a shortcut. On this configuration it produces a 409-free path that still always queues — a silent no-op.
- Do not migrate agents to `paperclip_runner` as the fix; the owner chose to keep `omp_local`.

## Rollback
The opt-in flag returns every agent to `--mode json -p` with no other change. Nothing about the legacy path is modified.
