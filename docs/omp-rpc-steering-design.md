# Design note: steering for `omp_local` via OMP RPC mode

Status: implemented. RPC is the adapter's default transport (`config.rpcSteering`,
default `true`); setting it to `false` returns one agent to `--mode json -p`.

## Correction after shipping against the real binary

The installed `@oh-my-pi/pi-coding-agent` in `~/.bun/install/global` was 17.4.2
while the running `omp` binary was 18.3.5, so the first pass of this design was
written against stale sources. Verified against the real artifact
(`~/.bun/install/cache/@oh-my-pi/pi-coding-agent@18.3.4@@@1/src`) and by driving
the live binary:

- **`session_settled` exists** in 18.3.5 and is the authoritative "this stretch
  of activity is over" frame — it waits out background work that could re-wake
  the session. It lands ~1 ms after the terminal `agent_end` for a simple run.
  The adapter closes the run on either, so a run cannot hang open on a missing
  settle.
- **`steer` takes `{id, type, message: string}`** and the response is
  `{type:"response", command:"steer", success:true}`. `session.steer` is
  `(text, images?, options?)`; passing a message object yields OMP's own
  `undefined is not an object (evaluating 'e.startsWith')`, so the adapter
  flattens `{role, text}` to `text` before writing the frame.
- **Frames must be observed before they are emitted.** A consumer that reacts to
  a transcript line reads session state at that moment, so `observeFrame` runs
  before the `onLog` hand-off. Emitting first made every steer attempt see a
  cleared turn.
- **There is still no turn id on the wire.** `turn_start` is a bare event, so the
  session mints its own turn token per turn and `steer` checks it; the real
  provider-side guard is OMP's own "is a turn running" state.
- **Protocol v2 negotiation is not required to steer**, but it is what makes an
  over-limit frame arrive as reassembled chunks instead of a degraded one. The
  adapter negotiates v2 when the `ready` frame advertises it and reassembles
  `rpc_chunk` frames; it falls back to v1 when the child advertises v1 only.

## Why steering was unreachable (three gates, all verified)

1. **All runs are legacy.** Every historical `heartbeat_runs` row is
   `runtime_mode: "legacy"`; all 36 agents are `adapter_type: "omp_local"`.
2. **Legacy never enters the native path.** `resolveNativeRuntimeMode` returns
   `{kind: "legacy", reason: "direct_adapter"}` unless
   `agent.adapterType === "paperclip_runner"`. Only the native path registers
   sessions in `activeNativeSessions`, and `steerNativeSession` required that
   entry.
3. **The queue protocol gate never promoted an `omp_local` run.** Even with a
   live adapter session, `decideQueuedCommentQueueSteering` resolved `legacy`
   from the persisted runtime mode, so both steer call sites bailed before the
   seam was ever consulted.

## The design that shipped

Keep `omp_local` as the adapter. Drive OMP in **RPC mode**, register the live
session in an adapter-owned registry, and teach the queue decision the one fact
that actually answers whether steering is possible: a live steer target exists.

1. **Transport.** `--mode rpc` with the prompt on stdin. A local `liveStdin`
   channel is bound to the child's stdin in `runChildProcess`; it reaches local
   and ssh targets. Sandbox targets receive only a one-shot `stdin` string, so
   `adapterExecutionTargetSupportsLiveStdin` gates RPC off there and the run
   stays on `--mode json -p`.
2. **Framing.** One JSON object per line in each direction, with protocol v2
   chunk reassembly for over-limit frames.
3. **Ack.** `steerNativeSession` resolves only after the `success:true` frame,
   so the transport surfaces the acknowledgement rather than firing and
   forgetting.
4. **Registration.** `adapter-steer-registry.ts` in `packages/adapter-utils`
   holds the live target per run; `getNativeSessionSteeringState` and
   `steerNativeSession` consult it after `activeNativeSessions`, so a native
   session always wins.
5. **Reachability.** `hasLiveAdapterSteering(runId)` feeds
   `decideQueuedCommentQueueSteering`, which promotes the queue to
   `paperclip_runner_v1` when an adapter holds a live steer target.
6. **Capability.** The adapter reports `omp-rpc-transport` and
   `same-turn-steering` only when the RPC path is active.
7. **Failure vocabulary.** Reuses `steering_unsupported`,
   `steering_temporarily_unavailable`, `steering_stale_turn`,
   `steering_timeout`, `steering_rejected`.
8. **Rollback.** Setting `rpcSteering` false returns that agent to
   `--mode json -p` with no other change; the json path is untouched.

## What must not be done
- Do not remove the conversation-issue steering ban as a shortcut. On this
  configuration it produces a 409-free path that still always queues.
- Do not migrate agents to `paperclip_runner` as the fix; the owner chose to
  keep `omp_local`.

## Verified end to end

Against the live `omp` 18.3.5 binary: negotiation returns
`{protocolVersion: 2}`; `get_state` yields the session id; the prompt is
acknowledged; a steer written mid-tool-call is acknowledged in ~1 ms and the
agent abandons its running loop to perform the steered instruction.

MCP arming was checked the same way, because a cutover that silently strips the
Paperclip tools from every agent would be worse than the bug it fixes. With the
adapter's own `writePaperclipMcpExtension` mount and a working stdio server, the
agent lists `paperclipApiRequest` and `papercliplistissues` under RPC exactly as
it does under `--mode json -p`. The mount shape the adapter writes is what OMP
18.x discovers: a plain directory holding `.mcp.json` classifies as
`kind: "none"` in `legacyProviderAllowed` and is therefore allowed, while a
directory carrying a `plugin.json` manifest is restricted to the `other`
surface and its MCP subtree is dropped.

Two consequences worth keeping:

- `get_state.dumpTools` lists the 15 built-in tools and **not** the MCP-bridged
  ones, so it cannot be used to detect a failed MCP connection.
- `runRpcMode` has no MCP readiness reporting at all — the
  `Warning: MCP server "…" failed to connect` line is produced inside
  `runPrintMode` only. Under RPC the guard against a tool-less run is the
  adapter's own pre-flight probe, which runs before OMP is spawned and fails the
  run with `paperclip_mcp_unavailable`. The connect-failure pattern still
  tolerates the escaped form so a notice would trip it too if OMP ever emits
  one.

## The contract this implements

`steer?(input: {turnId, message, correlationId})` is an OPTIONAL method on
`NativeSessionBackend`, gated by `capabilities.steering`. This implements an
existing method; it does not invent architecture.

### Delivery semantics inherited from OMP

A steered message is queued onto OMP's steering queue and lands at the next stop
boundary inside the run — after the current tool execution, skipping remaining
tools when the interrupt mode is immediate. It is not injected mid-token-stream.

## The transport, stated correctly

The sequenced-stdin path (`stdinDir` + `stdinSeq`) is **sandbox-only**: its only
production caller passes a `remote` target. Sandbox targets also receive only a
one-shot `stdin` string from `runAdapterExecutionTargetProcess`. The RPC path
therefore uses a new local `liveStdin` channel bound to the child's stdin in
`runChildProcess`, which reaches local and ssh targets, and is gated off for
sandbox by `adapterExecutionTargetSupportsLiveStdin`.

## Transcript volume, and where the savings came from

RPC hands over the raw session event where `--mode json -p` runs every event
through `printableEvent` first. Two separate changes close that gap, and they
should not be credited to each other.

| Change | What it drops | Measured on the same run |
|---|---|---|
| Transport-frame filter | `available_commands_update` and friends never reach the transcript | 1,085,386 B |
| Print-mode event shaping | `message_update` snapshots, `partial`, `providerPayload` | 12,660 B → 6,684 B |

So the transport swap is a 99.4% reduction end to end, while the event shaping on
its own accounts for 47.2% of event-frame bytes. An earlier note credited 99.3%
to the shaping alone; that figure belonged to the combination. On production the
combined effect is visible directly: runs carried 101-244 snapshot frames each
and logged 500-815 KB, against zero `partial` occurrences and a 166 KB log for a
10-minute run afterwards.

### The result budget is a separate surface

`resultJson.stdout` does not come from the transcript callback; it is
`attempt.proc.stdout`, the process runner's own raw capture, collected
independently. Bounding only the transcript left it at 500-800 KB, past the
server's 64 KiB `HEARTBEAT_RUN_SAFE_RESULT_JSON_MAX_BYTES`, where the
oversized-result projection replaces the object with a small whitelist — which
is why `ompTransport` and `capabilityManifest` read back as missing on exactly
the runs that were using RPC. The adapter now persists the transcript it emits,
and bounds each stored tool-call result; a verbose run measures 45 KB with every
diagnostic field intact.

## Rollback

Setting `rpcSteering` false returns that agent to `--mode json -p` with no other
change. Nothing about the json path is modified.
