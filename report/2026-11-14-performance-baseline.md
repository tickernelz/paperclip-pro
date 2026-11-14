# 2026-11-14 Performance / Memory / GC Baseline & Verification Snapshot

**Status:** in-progress (not “solved” end-to-end). This captures Phase 0 environment/spot measurements and targeted verification for partial fixes already present in the working tree.

## Environment
- Date (UTC): 2026-11-14T07:22:21Z
- Commit: `fdffd6f9b` (branch `main`)
- Node: `v26.13.1`
- pnpm: not available in this shell (`pnpm` command missing)
- OS: Linux thinkpad 7.3.3-1-cachyos-bore-lto (x86_64)

## Scope / source
- Plan: `doc/plans/2026-11-14-performance-memory-gc-development-plan.md` (untracked)
- Audit: `report/2026-11-14-performance-memory-audit-report.md` (untracked)
- Remediation: `report/2026-11-14-performance-memory-remediation-plan.md` (untracked)

## Working tree (partial remediation present, uncommitted)
`git diff --stat`: 4 files changed, 56 insertions(+), 5 deletions(-)
- `server/src/index.ts` (+17/-4): stores interval handles (`attachmentRetentionInterval`, `diskGuardInterval`, `runLogRetentionInterval`, `serverDatabaseBackupInterval`) and `unref()`s backup interval (lifecycle hygiene toward Task 1.1; full central shutdown-clear registry not verified here).
- `packages/plugins/sdk/src/worker-rpc-host.ts` (+35/-1): adds `dispose()`, `MAX_UNSETTLED_HOST_CALLS` (256), pending-call cap, and teardown clearing pending/timeouts/handlers (addresses Task 1.4 direction).
- `packages/mcp-server/src/generated-tools.ts` (+8): adds `resetGeneratedToolCaches()` and defensive `preparedVariants` cap (>64 clears) (addresses Task 2.1 direction).
- `apps/local-browser/chromium/content.js` (+1): calls `refs.prune()` in snapshot path (small bounds/lifecycle improvement).

## Spot runtime metric (process sample)
Command: `node -e "console.log(JSON.stringify(process.memoryUsage()))"` / derived MB (single short-lived sample, not soak/churn):
- rss: 42.79 MB
- heapUsed: 3.99 MB
- heapTotal: 4.63 MB
- external: 1.62 MB

## Benchmarks attempted
- `node --expose-gc --import tsx server/scripts/benchmark-tool-gateway-listing.ts`: **not run** (exit 1) — `tsx` package/module not resolvable in current environment (`ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`).

## Targeted automated tests (evidence for touched areas)
Run with local `node ./node_modules/vitest/vitest.mjs` (pnpm unavailable):

| Area | Command | Result |
| --- | --- | --- |
| MCP generated tools | `cd packages/mcp-server && node ./node_modules/vitest/vitest.mjs run src/generated-tools.test.ts` | **PASS** — 1 file, 19 tests passed (2.20s). Existing behavior intact; new `resetGeneratedToolCaches`/cap not explicitly covered by this file. |
| Plugin worker RPC host | `cd packages/plugins/sdk && node /home/arkhimuttaqina/repo/wardmote/node_modules/vitest/vitest.mjs run tests/worker-rpc-host.test.ts` | **PASS** — 1 file, 19 tests passed (364ms). Existing behavior intact; new `dispose()`/pending-call cap not explicitly covered by this file. |

## Not yet measured / gaps (Phase 0 incomplete)
- **Server idle + churn**: no inspectable server run with `process.memoryUsage()`/heap snapshots over N heartbeat cycles or realtime connect/disconnect churn.
- **UI churn**: no devtools heap snapshots after repeated navigation/chat/session churn.
- **Browser extension**: no background service-worker memory over tab open/close/navigation churn.
- **Soak/regression**: no before/after comparison against a committed baseline for the plan’s acceptance criteria.
- **Repo-wide/type/build gates**: not run (broad scope; pnpm unavailable; targeted checks used).

## Conclusion (metric of “solved”)
- **Solved:** no. Plan goal (eliminate confirmed gaps, bound state, reduce GC pressure **with measurable before/after evidence**) is not met.
- **Partially addressed (in working tree, verified non-regressing by targeted tests):** timer-handle retention in server bootstrap, MCP generated-tool cache reset/variant cap, worker RPC host pending-call bound + dispose API, minor extension ref pruning.
- **Next to claim solved:** capture committed baseline numbers (idle/churn), add/extend tests for new reset/dispose/cap behavior, wire full shutdown cleanup per plan, then re-measure and compare.
