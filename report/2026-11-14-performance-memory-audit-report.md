# Wardmote Performance, Memory, and GC Audit (Re-analysis)

**Date:** 2026-11-14 (re-analyzed)  
**Scope:** `server/src`, `packages/wardmote-runner/src`, `packages/mcp-server/src`, `packages/plugins/sdk/src`, `ui/src`, `packages/db/src`, `apps/local-browser/chromium/background`  
**Method:** static audit of current source + `rg` hotspot scan. No heap snapshot / soak-load benchmark executed in this pass (see Gaps).  
**Supersedes:** prior `2026-11-14-performance-memory-audit-report.md` claims that referenced non-existent paths/lines; this version keeps only grounded findings and flags unverifiable items.

## Executive Summary

- **No confirmed unbounded RSS "leak" proven here**, but there are **real lifecycle/cleanup gaps** that can retain memory or create GC pressure in long-lived processes: module-level singletons/timers, unbounded or weakly-bounded caches/maps, in-flight RPC state without explicit host dispose, and UI module/style caches that never evict.
- **High-impact runtime risks:** server `index.ts` installs periodic work without retained handles/central shutdown cleanup; heartbeat uses process-wide singleton timer state with replacement/stop gaps; MCP catalog is a process-lifetime `Map` with no eviction/clear; plugin RPC host tracks pending calls per worker but has no explicit dispose path; DB client initialization is a module singleton with no exposed close lifecycle.
- **Performance/GC pressure risks:** large per-turn/session buffers and clone-heavy paths in runner live session/transcript/workspace diff; unbounded growth potential in browser background network/ref maps and some UI runtime caches depending on session length.
- **Accuracy correction:** the previous audit/remediation cited many files that do not exist in this checkout (e.g. `packages/wardmote-runner/src/live/live-session-service.ts`, `server/src/realtime/chat-thread-stream.ts`, `packages/plugins/plugin-workspace-diff/...`, `apps/local-browser/.../cdp.js`, `ui/src/stores/issue-chat-store.ts`) and used out-of-range line anchors for several others. Those items are treated as **unverified hypotheses**, not findings.

## Findings (grounded)

### F1. Server bootstrap timers lack lifecycle ownership (P1, reliability/leak-risk)
- **Evidence:** `server/src/index.ts`
  - Scheduled intervals around bootstrap/runtime maintenance: cancel-expired approvals poll, queue-cleanup poll, issue-thread orchestrator poll (`setInterval` calls in runtime init region; see ~L1145-L1185 in current checkout).
  - Graceful shutdown path exists for HTTP/DB/embedded postgres/runnerd and heartbeat-run drain coordination (`beginHeartbeatServerShutdown`, SIGINT/SIGTERM handling later in file), but interval handles are not stored in a central registry for deterministic `clearInterval` on shutdown/hot paths.
- **Impact:** orphaned periodic callbacks across restarts/test harness reuse/hot reload contexts; avoidable wakeups and retained closure graphs.
- **Fix direction:** register every `setInterval/setTimeout` handle in a shutdown registry; clear on stop; prefer `.unref()` for non-critical maintenance timers.

### F2. Heartbeat singleton timer/state lifecycle gaps (P1)
- **Evidence:** `server/src/services/heartbeat.ts` exports singleton `instanceHeartbeatService`; `server/src/services/heartbeat/index.ts` stores `heartbeatService` module state and `setHeartbeatService()` replaces it without guaranteed `stop()` of previous instance; `server/src/services/heartbeat/heartbeat-wake-service.ts` and `heartbeat-run-state.ts` manage timer/run maps.
- **Impact:** replacing/reinitializing service can leave prior timers/promises reachable; harder to guarantee quiescence on shutdown or test isolation.
- **Fix direction:** idempotent `stop()/dispose()` on service, call before replacement, clear all timer handles/maps, and expose explicit lifecycle hooks to server shutdown.

### F3. MCP server catalog is process-lifetime mutable state (P2)
- **Evidence:** `packages/mcp-server/src/catalog.ts` uses module-level `const listings = new Map<string, ToolListing>()`; `packages/mcp-server/src/server.ts` / `http-server.ts` operate over process-scoped registration/runtime.
- **Impact:** in embedded/long-lived or multi-tenant-like runs, registrations can accumulate without bound/eviction; stale listings retain descriptors/closures.
- **Fix direction:** add explicit `clearCatalog()/reset` for shutdown/test, optional max-size/namespace ownership, and avoid retaining heavy schema objects when not needed.

### F4. Plugin worker RPC host: pending-call cleanup exists per call, but no host-level dispose (P1)
- **Evidence:** `packages/plugins/sdk/src/worker-rpc-host.ts` tracks `pending` (id -> timeout/resolve/reject), deletes on response/error/timeout and rejects on timeout; no explicit `dispose()` to reject/clear all pending on worker termination or host teardown.
- **Impact:** if worker crashes/exits without settling protocol responses, pending entries/promises and closures can linger until timeout/GC-unreachable conditions; teardown is not deterministic.
- **Fix direction:** add `dispose(reason)` that clears timers, rejects all pending, detaches handlers; wire to worker `exit/error/terminate`.

### F5. UI runtime plugin/module caches are unbounded (P2)
- **Evidence:** `ui/src/adapters/dynamic-loader.ts` keeps module-level `adapterModuleCache`, `adapterStyleLoadCache`, and dedupe state in `ensureAdapterStylesheetLoaded()` with no eviction/reset API; `ui/src/plugins/bridge.ts` maintains listener/subscription registries (`Map`) with unsubscribe support but no global dispose/reset for app/session teardown scenarios.
- **Impact:** long SPA sessions, repeated plugin/adapter loads, or HMR/test reruns retain modules, style promises, and listener graphs.
- **Fix direction:** add bounded LRU or explicit `resetRuntimeCaches()` for logout/company switch/tests; ensure global teardown in dev/HMR paths.

### F6. DB client lifecycle is singleton without explicit close (P2)
- **Evidence:** `packages/db/src/client.ts` / `packages/db/src/index.ts` expose module-level initialization/singleton access patterns for the DB client (PGlite/driver wiring) without a documented/used symmetric close/dispose for all runtimes.
- **Impact:** retained connections/file handles/buffers in worker/test/electron-like lifecycles; complicates leak isolation.
- **Fix direction:** provide and use `closeDb()/dispose()` in server shutdown and tests; make init idempotent.

### F7. Runner live/session data structures carry GC pressure risk (P1, perf/memory)
- **Evidence:** `packages/wardmote-runner/src/live/live-session.ts` manages per-session run state, heartbeat/timer control, transcript publication and buffering paths; `packages/wardmote-runner/src/live/transcript-store.ts`, `session-cache.ts`, `background-read-cache.ts` implement caching/buffering with varying bounds; `packages/wardmote-runner/src/live/workspace-diff.ts` performs workspace scanning/diff work.
- **Impact:** large transcripts/tool payloads and repeated diff/capture operations increase allocation churn and old-gen pressure; weak bounds on any session-keyed cache become leak vectors under high session cardinality.
- **Fix direction:** enforce hard caps (entries/bytes/age) on session/transcript/read caches, stream/chunk large payloads, avoid duplicate serialization/clones, and ensure session terminal states release buffers/timers.

### F8. Browser extension background state can accumulate (P2, needs verification)
- **Evidence:** `apps/local-browser/chromium/background/index.js`, `network.js`, `lib/refmap.js` maintain runtime maps/state for tabs, refs, and network observations.
- **Impact:** potential growth over long-lived browser sessions/tabs if pruning is incomplete; requires targeted review per map.
- **Fix direction:** audit each map for max size/TTL/tab-close cleanup; cap captured request/response bodies; drop refs on navigation/tab removal.

### F9. Realtime hub/stream lifetimes need explicit close discipline (P2)
- **Evidence:** prior report claimed `server/src/realtime/live-update-hub.ts`/`chat-thread-stream.ts`; actual files present include `server/src/realtime/index.ts`, `event-bus.ts`, and stream-related modules in tree. Subscription/listener ownership must be traced per transport.
- **Impact:** listener retention/leaks only if unsubscribe/close not symmetric; currently **partially verified**.
- **Fix direction:** inventory all `on/subscribe` pairs, assert cleanup on socket/SSE disconnect and server stop, add leak tests.

## Unverified / removed claims (from prior report)

These were asserted previously but are not backed by current source paths: `packages/wardmote-runner/src/live/live-session-service.ts`, `server/src/realtime/chat-thread-stream.ts`, `server/src/realtime/issue-chat-stream.ts` (as named), `server/src/realtime/live-update-hub.ts` (as named), `packages/mcp-server/src/http-server.ts` session sweeper internals as cited, `packages/plugins/plugin-workspace-diff/src/workspace-diff.ts`, `ui/src/stores/issue-chat-store.ts`, `apps/local-browser/.../cdp.js`/ref-map paths as cited. **Action:** re-validate against actual modules before implementing; do not treat as confirmed bugs.

## Measurement gaps (required before claiming fix)

1. Heap snapshots/alloc timelines for server runner and UI (devtools/`node --inspect`/`clinic`) under representative load.
2. Soak test: long heartbeat cadence + concurrent live sessions/chat streams; track RSS, heap used, event loop delay.
3. Runner-specific profiling around workspace diff/capture and transcript growth.
4. Browser extension memory profiling across many tabs/navigations.

## Priority order

1. **P1 Lifecycle correctness:** F1, F2, F4, F7 bounds/cleanup (prevents retention & nondeterministic teardown).
2. **P2 Bounded state:** F3, F5, F6, F8, F9 (caps/reset/dispose, verify actual modules).
3. **P3 Evidence & perf:** profiling, benchmarks, regression gates.

## Follow-up verification (session 2026-11-14T13:14:00+07:00)
- Workspace diff (unstaged): `apps/local-browser/chromium/content.js` adds `else refs.prune()` after snapshot build in `handleRefCommand("snapshot")` to drop stale detached refs between snapshots; `packages/mcp-server/src/generated-tools.ts` adds `clearPreparedGeneratedTools()` and defensive cap `preparedVariants.size > 64 => clear()` for prepared tool variant cache lifecycle/bounds.
- Targeted checks: `pnpm --filter @wardmote/mcp-server test -- --run src/generated-tools.test.ts` => 9/9 passed. `pnpm --filter @wardmote/mcp-server exec tsc -p tsconfig.json --noEmit` => clean. UI `tsc -b` attempted in constrained shell (no additional UI source diff in this slice); rerun in full dev shell/CI recommended before merge.
- Post-fix point measurement (Node process, non-representative of full server soak): `process.memoryUsage()={"rss":212570112,"heapUsed":8610528,"heapTotal":10334208,"external":1795354}`.
- Status reconciliation: heartbeat/server shutdown timer cleanup & drain hooks, realtime/event-bus dispose, terminal-idle teardown, local-browser/live-events WS heartbeat cleanup, browser extension ref pruning on snapshot, runner live session/cache/transcript/background-read/workspace-diff bounds, and MCP generated-tool preparation cache bound are evidenced in code/docs; plugin worker RPC explicit dispose/termination wiring and DB client shutdown close registration remain open follow-ups (not newly implemented in this session).
