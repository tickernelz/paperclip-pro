# Performance, Memory Leak, and GC Remediation Development Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate confirmed lifecycle/cleanup gaps, bound long-lived in-memory state, and reduce GC/allocation pressure in Wardmote server, runner, MCP, plugins, UI, DB, and local-browser runtimes—with measurable before/after evidence.

**Architecture:** Fix in layers: (1) deterministic process/resource lifecycle (timers, dispose, shutdown wiring), (2) bounded caches/maps/buffers with eviction and reset APIs, (3) subscription/RPC/worker teardown symmetry, (4) hot-path allocation controls, (5) profiling + regression guards. Each slice must cite real `file` evidence and include a verification step; no speculative rewrites for paths not present in this checkout.

**Tech Stack:** TypeScript/Node (server, packages), React/Vite UI, Chrome extension (MV3 background scripts), PGlite/DB client, Vitest, `rg`, Node inspect/heap profiling (`--inspect`, `process.memoryUsage`, clinic optional).

**Source of truth:**
- Audit (corrected): `report/2026-11-14-performance-memory-audit-report.md`
- Remediation (corrected): `report/2026-11-14-performance-memory-remediation-plan.md`

---

## Phase 0 — Baseline & instrumentation (gate, do first)

### Task 0.1: Capture baseline metrics
**Files:**
- Create: `report/2026-11-14-performance-baseline.md` (append-only measurements log)

**Step 1: Record environment**
- Run: `node -v && pnpm -v && git rev-parse --short HEAD`
- Save output into baseline doc (date, branch, commit).

**Step 2: Server idle + churn snapshot**
- Run server with inspectable mode as appropriate for repo scripts; record `process.memoryUsage()`, RSS, heapUsed/heapTotal, event-loop delay (if available) at: idle, after N heartbeat cycles, after connect/disconnect churn of realtime clients/sessions (define N in doc).
- Save: heap snapshot filenames/paths or summary stats.

**Step 3: UI/extension spot checks**
- UI: devtools memory snapshot after repeated navigation/chat/session churn.
- Browser extension: background service worker memory over tab open/close/navigation churn.

**Step 4: Commit baseline doc**
- `git add report/2026-11-14-performance-baseline.md && git commit -m "chore(perf): add memory/gc baseline measurements"`

**Acceptance:** baseline numbers and reproduction steps documented; future phases compare against this.

---

## Phase 1 — Deterministic lifecycle & teardown (P1)

### Task 1.1: Central runtime timer registry in server bootstrap
**Files:**
- Modify: `server/src/index.ts`
- Test: `server/src/**` (add/extend lifecycle/shutdown test near existing server bootstrap tests if present; otherwise `server/src/__tests__/server-lifecycle*.test.ts`)

**Step 1: Write failing test**
- Assert that starting runtime scheduling then invoking shutdown/cleanup clears registered intervals/timeouts (use fake timers or injectable registry/count).

**Step 2: Implement**
- Introduce a small registry (e.g. `runtimeTimers: Set<{clear: fn}>` or handle arrays) for all `setInterval/setTimeout` created during bootstrap/maintenance (approval poll, queue cleanup, orchestrator poll, retention/warmup timers found by audit).
- Add `clearAllRuntimeTimers()` and call from graceful shutdown/hot-restart preparation paths.
- Mark non-critical maintenance timers with `.unref()`.

**Step 3: Verify**
- Run targeted tests for modified area; confirm no regressions in server start/stop.

**Step 4: Commit**
- `git commit -m "fix(server): own and clear bootstrap runtime timers"`

### Task 1.2: Heartbeat service idempotent dispose and safe replacement
**Files:**
- Modify: `server/src/services/heartbeat/index.ts`
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/services/heartbeat/heartbeat-wake-service.ts`
- Modify: `server/src/services/heartbeat/heartbeat-run-state.ts`
- Test: `server/src/services/heartbeat/**/*.test.ts` (or closest existing)

**Step 1: Failing test**
- Reinit/replace service twice and stop: assert no leaked timers/handles and prior instance quiesced.

**Step 2: Implement**
- Add/idempotent `stop()`/`dispose()` clearing all interval/timeout handles and transient maps as safe.
- `setHeartbeatService()` must `await/stop` previous before swap (respect async contract).
- Wire dispose into server shutdown sequence in `server/src/index.ts`.

**Step 3: Verify & commit**
- Run heartbeat-related tests.
- `git commit -m "fix(heartbeat): make service lifecycle idempotent and disposable"`

### Task 1.3: Plugin worker RPC host dispose
**Files:**
- Modify: `packages/plugins/sdk/src/worker-rpc-host.ts`
- Test: `packages/plugins/sdk/src/**/*.test.ts` (or add focused test)

**Step 1: Failing test**
- Simulate worker termination/error with pending call: expect pending cleared, timers cleared, promise rejected with deterministic dispose reason.

**Step 2: Implement**
- Add `dispose(reason)` to reject/clear all `pending`, clear timeouts, detach listeners.
- Hook into worker `exit`/`error`/`terminate` paths where host is owned.

**Step 3: Verify & commit**
- `git commit -m "fix(plugins-sdk): dispose worker rpc host pending calls on teardown"`

---

## Phase 2 — Bound and reset long-lived state (P1/P2)

### Task 2.1: MCP catalog reset/ownership bounds
**Files:**
- Modify: `packages/mcp-server/src/catalog.ts`
- Modify (if needed): `packages/mcp-server/src/server.ts`, `packages/mcp-server/src/http-server.ts`
- Test: `packages/mcp-server/**/*.test.ts`

**Step 1: Failing test** — reset clears listings; repeated register/reset stable.
**Step 2: Implement** — export `clearCatalog()/reset`; call on shutdown/test teardown; document/implement replace semantics or max cap if dynamic.
**Step 3: Commit** — `git commit -m "fix(mcp): add catalog reset and bounded registration lifecycle"`

### Task 2.2: UI adapter/plugin runtime cache lifecycle
**Files:**
- Modify: `ui/src/adapters/dynamic-loader.ts`
- Modify: `ui/src/plugins/bridge.ts`
- Test: `ui/src/**/*.test.ts(x)` (targeted)

**Step 1: Failing test** — reset/dispose API clears module/style caches and bridge listener registries.
**Step 2: Implement** — `resetRuntimeCaches()/disposeBridge()` (names per existing conventions), wire to HMR/company-switch/logout paths only where safe and intended.
**Step 3: Commit** — `git commit -m "fix(ui): make adapter/plugin runtime caches disposable"`

### Task 2.3: DB client dispose
**Files:**
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`
- Test: db package tests / server shutdown tests as applicable

**Step 1: Failing/coverage test** — init then close leaves no open handle in test runtime (where observable).
**Step 2: Implement** — expose `closeDb()/disposeDb()` and integrate into server shutdown and relevant test teardown.
**Step 3: Commit** — `git commit -m "fix(db): expose and wire client dispose lifecycle"`

### Task 2.4: Runner live session/transcript/cache bounds
**Files:**
- Modify: `packages/wardmote-runner/src/live/live-session.ts`
- Modify: `packages/wardmote-runner/src/live/transcript-store.ts`
- Modify: `packages/wardmote-runner/src/live/session-cache.ts`
- Modify: `packages/wardmote-runner/src/live/background-read-cache.ts`
- Modify: `packages/wardmote-runner/src/live/workspace-diff.ts` (bounds/budget if needed)
- Test: `packages/wardmote-runner/src/live/**/*.test.ts`

**Step 1: Failing tests** — eviction at cap, TTL expiry (if added), terminal session releases buffers/timers/caches.
**Step 2: Implement** — enforce hard caps (count/bytes/age) with documented defaults; ensure cleanup on stop/error/complete; avoid redundant copies on hot paths.
**Step 3: Commit** — `git commit -m "fix(runner-live): bound session caches and harden teardown"`

---

## Phase 3 — Realtime, browser, and hot-path verification (P2)

### Task 3.1: Realtime subscription symmetry
**Files:**
- Audit/modify: `server/src/realtime/*.ts` (actual modules: `index.ts`, `event-bus.ts`, etc.)
- Test: realtime tests

**Steps:** inventory subscribe/on pairs; add missing unsubscribe/close on disconnect/shutdown; test churn stability. Commit: `git commit -m "fix(realtime): ensure subscription and listener teardown symmetry"`

### Task 3.2: Local browser background state bounds
**Files:**
- Modify as needed: `apps/local-browser/chromium/background/index.js`, `network.js`, `lib/refmap.js`
- Test/manual: extension profiling notes in baseline doc

**Steps:** ensure tab removal/navigation clears refs/network entries; cap payload/entry counts; document verification. Commit: `git commit -m "fix(local-browser): bound and clean background runtime state"`

### Task 3.3: Workspace diff/capture perf guard
**Files:**
- Modify/profile: `packages/wardmote-runner/src/live/workspace-diff.ts` and related callers if in-scope
- Test: runner live tests

**Steps:** confirm scan/serialization limits and release behavior; add budget/cap if missing. Commit: `git commit -m "perf(runner): bound workspace diff work and allocations"`

---

## Phase 4 — Evidence, regression gates, closure

### Task 4.1: Post-fix measurements
**Files:**
- Modify: `report/2026-11-14-performance-baseline.md` (or create `report/2026-11-14-performance-results.md`)

**Steps:** repeat Phase 0 measurements; record deltas per workstream; flag any unresolved growth with owner/follow-up.

### Task 4.2: Regression tests & doc hygiene
**Files:**
- Tests added in prior phases
- Modify (if needed): `report/2026-11-14-performance-memory-audit-report.md`, `report/2026-11-14-performance-memory-remediation-plan.md`

**Steps:** ensure CI-relevant tests pass for touched packages; update docs to reflect implemented vs remaining items with evidence/commit refs.

**Step: Commit**
- `git commit -m "chore(perf): record remediation results and regression coverage"`

---

## Execution notes

- **Order:** Phase 0 -> 1 -> 2 -> 3 -> 4. Within phases, tasks can be parallelized only when file ownership is disjoint.
- **Risk control:** small PRs per task/phase; prefer behavior-preserving lifecycle hardening before aggressive caching changes.
- **Verification minimum per task:** targeted unit/integration tests + `pnpm` typecheck/test for touched workspace(s) as repo conventions require.
- **Out of scope (unless evidence found):** modules/paths not present in this checkout cited by prior audit; treat as backlog items pending re-validation.
- **Definition of done:** lifecycle/bounds implemented, tests/measurement evidence recorded, and audit/remediation docs kept truthful.

## Progress / evidence update (2026-11-14T13:14:00+07:00)
- [x] **Heartbeat/server lifecycle (evidenced):** timer cleanup/unref, `stopHeartbeatScheduler`, `beginServerShutdown`/drain hooks, and shutdown integration present in `server/src/services/heartbeat*.ts` and `server/src/index.ts`.
- [x] **MCP catalog/generated-tools lifecycle (improved):** `clearPreparedGeneratedTools()` and defensive prepared-variants bound added in `packages/mcp-server/src/generated-tools.ts`; targeted test/typecheck pass.
- [~] **Plugin RPC dispose:** pending RPC timeout rejection/cleanup exists in worker host; explicit host-exposed dispose/worker termination lifecycle still open.
- [x] **Realtime/WS teardown (evidenced):** terminal idle teardown, local-browser/live-events heartbeat+cleanup, event-bus dispose patterns implemented.
- [~] **DB close lifecycle:** singleton/registered client patterns exist; explicit shutdown close/dispose wiring still to confirm/complete.
- [~] **UI cache/bridge cleanup:** bridge list-change cleanup and bounded loader parse/failure caches present; dynamic adapter cache eviction policy remains a follow-up.
- [x] **Runner/browser bounds (evidenced/targeted):** runner live session/transcript/session-cache/background-read/workspace-diff caps and sweeps; browser content ref pruning on snapshot (`refs.prune()`) added this session; extension network/refmap limits present.
- [x] **Targeted verification:** `pnpm --filter @wardmote/mcp-server test -- --run src/generated-tools.test.ts` (9 pass), `pnpm --filter @wardmote/mcp-server exec tsc -p tsconfig.json --noEmit` clean.
- [x] **Post-fix measurement (point):** `{"rss":212570112,"heapUsed":8610528,"heapTotal":10334208,"external":1795354}` at 2026-11-14T13:14:00+07:00 (ad-hoc Node).
- [ ] **Full soak/heap timeline & broad CI verification:** pending (idle/churn heap snapshots, UI runtime timeline, full typecheck/build suite).
