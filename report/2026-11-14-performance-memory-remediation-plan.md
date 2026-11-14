# Wardmote Performance, Memory, and GC Remediation Plan (Revised)

**Date:** 2026-11-14 (revised)  
**Companion audit:** `report/2026-11-14-performance-memory-audit-report.md` (re-analyzed)  
**Goal:** eliminate confirmed lifecycle/cleanup gaps, bound long-lived in-memory state, reduce avoidable allocation/GC pressure, and add measurement gates so "no leak / no GC issue" claims are evidence-backed.

## Guiding principles

1. **Lifecycle ownership:** every timer, listener, subscription, worker, socket, and cache with process/session scope must have explicit `start/stop/dispose` and be wired to shutdown.
2. **Bounded state:** every long-lived `Map/Set/array/buffer` needs a size/age/byte cap or a provable cardinality bound.
3. **Measure before/after:** fixes are accepted only with before/after evidence (RSS, heap, event-loop delay, soak stability) for the affected runtime.
4. **No speculative rewrites:** prior audit items tied to non-existent files/lines are excluded until re-verified in actual modules.

## Workstreams

### WS1 — Server process lifecycle & timers (P1)
**Covers audit F1, F2.**

- [ ] **S1.1 Timer registry in `server/src/index.ts`**
  - Store handles for all bootstrap/runtime `setInterval/setTimeout` (approval poll, queue cleanup, issue-thread orchestrator poll, module warmups, etc.).
  - Add `clearAllRuntimeTimers()` invoked during graceful shutdown and any hot-restart/bootstrap-reset path.
  - Use `.unref()` for non-critical maintenance timers so they do not keep process alive.
  - *Acceptance:* no orphan intervals after shutdown path; signal/shutdown test or manual harness shows zero active app timers.

- [ ] **S1.2 Heartbeat service dispose semantics**
  - In `server/src/services/heartbeat/index.ts` + `heartbeat.ts` + `heartbeat-wake-service.ts` + `heartbeat-run-state.ts`: make `stop()/dispose()` idempotent and comprehensive (clear interval/timeout handles, pending wake/run maps as appropriate, detach listeners).
  - Ensure `setHeartbeatService()`/reinit stops previous instance before replacement.
  - Wire heartbeat teardown into server shutdown sequence.
  - *Acceptance:* repeated init/stop cycles do not accumulate timers/handles (test with fake timers or handle counting).

### WS2 — Bounded process/module caches (P1/P2)
**Covers F3, F5, F6, F7 (caches).**

- [ ] **S2.1 MCP catalog lifecycle (`packages/mcp-server/src/catalog.ts`, `server.ts`, `http-server.ts`)**
  - Add `reset/clear` API for catalog listings; invoke on server shutdown/test teardown.
  - Define ownership/namespacing and, if registrations can be dynamic/untrusted, max entries or replace-not-append semantics.
  - *Acceptance:* catalog size stable across restart/reset scenarios.

- [ ] **S2.2 UI runtime caches (`ui/src/adapters/dynamic-loader.ts`, `ui/src/plugins/bridge.ts`)**
  - Add explicit reset/dispose for module-level adapter/style caches and bridge registries; invoke on logout/company-context reset/HMR cleanup where applicable.
  - Consider bounded LRU for adapter module cache if plugin cardinality can grow.
  - *Acceptance:* repeated mount/unmount or context switches do not monotonically grow cache/listener counts.

- [ ] **S2.3 DB client dispose (`packages/db/src/client.ts`, `packages/db/src/index.ts`)**
  - Expose and use symmetric `close/dispose` for all runtime modes; integrate with server shutdown and tests.
  - *Acceptance:* clean process exit in tests; no open handles from DB layer.

- [ ] **S2.4 Runner caches & transcript/session bounds (`packages/wardmote-runner/src/live/session-cache.ts`, `background-read-cache.ts`, `transcript-store.ts`, `live-session.ts`)**
  - Verify and enforce hard limits (count/bytes/TTL) and eviction; ensure terminal session cleanup releases buffers, timers, and cached artifacts.
  - Avoid duplicate large payload copies where safe (prefer streaming/references).
  - *Acceptance:* bounded memory under long or many sessions; unit tests for eviction and session teardown.

### WS3 — Teardown correctness for async/RPC/realtime/browser (P1/P2)
**Covers F4, F8, F9.**

- [ ] **S3.1 Plugin worker RPC host dispose (`packages/plugins/sdk/src/worker-rpc-host.ts`)**
  - Implement `dispose(reason)`: clear pending timeouts, reject all pending promises with deterministic error, detach message handlers; call on worker exit/error/terminate.
  - *Acceptance:* forced worker termination leaves zero pending timers/entries.

- [ ] **S3.2 Realtime subscriptions/listeners (`server/src/realtime/*`)**
  - Inventory actual stream/hub modules (`index.ts`, `event-bus.ts`, etc.); ensure every subscribe/on has symmetric unsubscribe/off on disconnect/close.
  - Add cleanup tests (connect/disconnect N times => stable listener/subscription counts if observable).
  - *Acceptance:* no listener accumulation under churn.

- [ ] **S3.3 Browser extension background state (`apps/local-browser/chromium/background/*.js`, `lib/refmap.js`)**
  - Audit each `Map/Set` for tab lifecycle cleanup (`tabs.onRemoved`, navigation) and max/TTL for network/ref data; cap stored payload sizes.
  - *Acceptance:* long-lived background script memory stable across tab churn (manual/devtools profile).

### WS4 — Workspace diff/capture & allocation hot paths (P2/P3)
**Covers F7 perf aspects.**

- [ ] **S4.1 Profile and bound workspace operations (`packages/wardmote-runner/src/live/workspace-diff.ts`, related capture paths if present)**
  - Confirm current implementation behavior; add limits (file count/bytes/time), avoid redundant scans/serialization, and ensure results/buffers are released after publish.
  - *Acceptance:* no pathological growth on large workspaces; operation completes within defined budget.

### WS5 — Measurement, regression, and documentation (P1 gate)

- [ ] **S5.1 Baseline & verification runs**
  - Capture baseline: process RSS/heap/event-loop delay for server under idle + representative workload (heartbeats, live sessions, chat/realtime churn).
  - After each workstream, repeat and record deltas in `report/`.
  - Tools (as available): Node `--inspect` heap snapshots, `process.memoryUsage()`, `clinic doctor/heapprofiler`, browser devtools for extension/UI.

- [ ] **S5.2 Automated guards (targeted)**
  - Add tests for: timer/listener disposal, cache eviction/bounds, RPC dispose rejects pending, shutdown clears handles (fake timers or handle assertions where feasible).
  - Keep tests deterministic and scoped to touched modules.

- [ ] **S5.3 Keep audit/remediation truthful**
  - Any new finding must cite existing `file:line` and reproduction/measurement; unverified hypotheses tracked separately (backlog), not listed as confirmed leaks.

## Priority & sequencing

| Phase | Items | Rationale |
|---|---|---|
| 1 (immediate) | S1.1, S1.2, S3.1 | Deterministic lifecycle/teardown; highest leak-risk reduction |
| 2 | S2.1–S2.4, S3.2 | Bound/clear long-lived state in core runtimes |
| 3 | S3.3, S4.1 | Browser/IO hot paths; verify actual behavior first |
| 4 | S5.1–S5.3 | Evidence, regression gates, doc accuracy |

## Definition of done (per item)

- Code change merged with tests (or documented reason if test not feasible) and no type errors in touched packages.
- Lifecycle/bound behavior demonstrated (test or measurement artifact).
- Audit/remediation docs updated if scope/accuracy changes.

## Verification & follow-up (2026-11-14T13:14:00+07:00)
- **Targeted tests:** `packages/mcp-server/src/generated-tools.test.ts` passed (9 tests). `@wardmote/mcp-server` typecheck (`tsc -p tsconfig.json --noEmit`) clean.
- **Smoke/build (targeted):** UI `tsc -b` attempted in constrained shell; no UI source changes in this slice—confirm in CI/full shell. No full `pnpm typecheck`/`pnpm build` executed in this session.
- **Post-fix measurement:** Node point sample `process.memoryUsage()={"rss":212570112,"heapUsed":8610528,"heapTotal":10334208,"external":1795354}` (2026-11-14T13:14:00+07:00, ad-hoc process; not an idle/churn server soak baseline).
- **Code deltas this session:** `apps/local-browser/chromium/content.js` prunes stale refs when snapshot path does not already prune; `packages/mcp-server/src/generated-tools.ts` adds `clearPreparedGeneratedTools()` and defensive prepared-variants cache cap (64).
- **Remaining open (needs implementation/verification):** plugin worker host RPC dispose/termination path and host wiring; DB close/dispose hook on server shutdown; full idle/churn soak + UI runtime heap timeline evidence; broadened UI adapter dynamic cache eviction policy beyond current bounded parse/failure caches.
