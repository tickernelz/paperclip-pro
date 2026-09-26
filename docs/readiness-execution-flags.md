# Execution/runtime flags — production-readiness assessment

Assessed against `.pcpro-readiness-bar.md` on `feat/readiness-execution`
(base `24cea1fed`). Verdicts use the fixed vocabulary: ready / not ready / excluded.

## Verdicts

| flag | prod | verdict | reason | deciding evidence |
| --- | --- | --- | --- | --- |
| `enableNativeRunner` | ON | ready | Persisted native runs keep their transport after the flag flips off, so recovery is unaffected; ingress authorization derives from the resolved runtime, not a second flag. | `server/src/services/native-runtime/runtime-mode.ts:64` `isRunnerIngressAuthorized`; `runtime-mode.test.ts:193` "keeps a persisted active run native while the global flag rejects a fresh runner start" and `:211` "authorizes ingress from the native runtime decision without a second flag". |
| `enableWorkspaceDirtyQuarantineRepair` | ON | ready | Repair-only: it quarantines a dirty worktree onto a rescue branch and restores the recorded branch. It never selects where work runs. | `server/src/services/workspace-runtime.ts:2114` (guard, gated on `=== true`); audit comment + rescue branch persisted in the same transaction as the repair; `workspace-runtime.test.ts` covers both the on and off path (`workspace-runtime.test.ts:2895` off, `:6083` on). |
| `enableWorkspaceBranchReconcileForward` | ON | ready | Forward-only adoption of a clean checked-out branch; refuses every dirty or non-ancestor case. Read per run at realize/finalize. | `workspace-runtime.ts:2175` (requires `=== true` plus `cleanliness === "clean"`); call sites `heartbeat.ts:22093` (realize) and `:24232` (finalize); `heartbeat-workspace-branch-containment.test.ts:1121` forward, `:3266` off. |
| `enableRunnerPreviewIngress` | OFF | excluded | Documented deprecated compatibility key with no runtime effect: the catalog labels it "Runner Preview Ingress (Deprecated)" and the resolver ignores it. | `packages/shared/src/types/instance.ts:130` (@deprecated, "has no runtime effect"); `packages/shared/src/feature-catalog.ts:306-309`; `runner-connectivity.ts:140` prefers `runnerIngressAuthorized`. Kept flagged deliberately — do not promote. |
| `enableIsolatedWorkspaces` | OFF | not ready | Clause 5. The flag gates *writes* to the issue workspace binding but not *reads* of an existing binding, so flipping it off mid-flight orphans a live worktree. | See "Mid-flight behaviour" below. |
| `enableIsolatedWorkspacesByDefault` | OFF | not ready | Coupling is genuinely enforced in code (not a comment), but it inherits the clause 5 failure of the flag it depends on. | See "Coupling check" below. |
| `enableWorktreeRunExecution` | OFF | not ready | Clause 6 failed at the activation read; fixed here. Clauses 1/2/4/5 hold. | Hardened in this branch; `server/src/services/instance-settings.ts`. |
| `enableSandboxDuplexBridge` | OFF | not ready | Clause 6 failed at the kill-switch read; fixed here. Clauses 1/2/4/5 hold. | Hardened in this branch; `server/src/services/environment-execution-target.ts`. |
| `enableManagedSandboxOnly` | OFF | not ready | Fails closed correctly, but the fail-closed path has never run in production and clause 1 has no permission-denied coverage on the redirect itself. | `execution-workspace-policy.ts:333` throws `ManagedSandboxUnavailableError`; `execution-workspace-policy.test.ts:509` asserts the throw. |
| `enableEnvironments` | OFF | not ready | UI surface only. It hides the environment pages in the client and has no server-side execution branch, so it carries no clause 5 exposure — but clause 1 cannot be satisfied for a flag with no server behaviour to test. | Client-only reads (`ui/src/pages/Agents.tsx:259`, `CompanyEnvironments.tsx:1343`); the single server reference is the settings normalizer at `server/src/services/instance-settings.ts:226`. |

## Coupling check: `enableIsolatedWorkspacesByDefault`

The claim is enforced in code, not only in a comment. The heartbeat computes
the conjunction explicitly and passes it as a separate input, so the operator
default cannot reach the resolver on its own:

```ts
// server/src/services/heartbeat.ts:20777
const isolatedWorkspacesEnabled =
  experimentalInstanceSettings.enableIsolatedWorkspaces;
const defaultIsolatedWorkspacesEnabled =
  isolatedWorkspacesEnabled &&
  experimentalInstanceSettings.enableIsolatedWorkspacesByDefault;
```

The resolver keeps a stored project policy, including an explicitly disabled
one (`execution-workspace-policy.ts:200-203`), so a project with its own
policy is never overridden. Both halves are covered:
`execution-workspace-policy.test.ts:558` ("never overrides a policy the project
already stores") and `:565` ("leaves everything alone while the operator default
is off"), plus the end-to-end matrix in
`heartbeat-project-repositories.test.ts:59-110`.

The coupling itself is sound. Its verdict is `not ready` only because it
inherits the clause 5 failure of `enableIsolatedWorkspaces`.

## Mid-flight behaviour (clause 5)

Execution location is resolved **per run**, not pinned at run creation, and a
flag flip is visible to the next dispatch. That is safe for a run already
executing, but it is unsafe for a run that has a live workspace binding:

- **Reads are not gated.** `heartbeat.ts:21299` resolves the existing
  workspace from `issueRef.executionWorkspaceId` without consulting
  `enableIsolatedWorkspaces`, and `resolveExecutionWorkspaceReuseRequestForIssue`
  (`heartbeat.ts:6138`) honours a stored `reuse_existing` binding regardless
  of the flag.
- **Writes are gated.** With the flag off, `issues.ts:10679` deletes
  `executionWorkspaceId`, `executionWorkspacePreference`, and
  `executionWorkspaceSettings` from every public issue update, and
  `issues.ts:9739` does the same on create.

So turning the flag off while a task holds an isolated worktree makes the
next dispatch unable to see the binding that its write path just removed.
The gate also nulls the project policy through
`gateProjectExecutionWorkspacePolicy` (`execution-workspace-policy.ts:200`),
while the worktree row in `execution_workspaces` and the on-disk checkout are
left in place — orphaned, not cleaned up. This is the write-gated /
read-ungated asymmetry the bar calls a rollback hazard.

Cross-mode readability is otherwise sound: a persisted workspace carries its
own `mode`, and `issueExecutionWorkspaceModeForPersistedWorkspace`
(`execution-workspace-policy.ts:355`) rehydrates the issue settings from the
stored row, so an isolated worktree is not reinterpreted as a shared one.

`enableWorktreeRunExecution` is the one flag in this area with a real
mid-flight guarantee. Activation records a server-managed cutoff and the
activating instance id (`instance-settings.ts:104-131`), the flag is only read
inside a worktree runtime (`heartbeat.ts:9662`, `PAPERCLIP_IN_WORKTREE`), and
a copied settings row fails closed on instance mismatch
(`resolveWorktreeRunExecutionActivation`). Re-arming mints a fresh cutoff
rather than reusing the old one
(`instance-settings-service.test.ts:264`), so no stale activation survives a
toggle cycle. Worktree instances have their own database, so the flag cannot
reach the parent.

## Hardening shipped in this branch

Two clause 6 violations fixed, each with a test that fails before the fix:

1. `server/src/services/environment-execution-target.ts` — the
   `enableSandboxDuplexBridge` kill-switch read caught and discarded the
   error, keeping the file bridge with no record. Now logs
   `sandbox_duplex_bridge_read_error`.
2. `server/src/services/instance-settings.ts` (and the
   `heartbeat.ts` cache wrapper around it) — the
   `enableWorktreeRunExecution` activation read swallowed the error, keeping
   run scheduling suppressed with nothing on the flag to explain it. Now logs
   `worktree_run_execution_read_error`.

Both keep the fail-closed behaviour; only the missing record changed.

Evidence: `server/src/__tests__/instance-settings-service.test.ts` and
`server/src/__tests__/environment-execution-target-duplex-kill-switch.test.ts`,
34 tests pass. With the three service files stashed, the two new log
assertions fail (2 failed / 32 passed) and pass again once restored.
Server typecheck reports the same 260 pre-existing errors before and after the
change (unbuilt workspace dists in a fresh worktree); none reference the
changed files.

## Why the isolated-workspace flags stay experimental

Not because they are unfinished. `enableIsolatedWorkspaces` changes where
worktrees live, and the write-gated / read-ungated asymmetry above means
flipping it during live work can strand a worktree and its uncommitted
branch. `enableIsolatedWorkspacesByDefault` moves the default for every
policyless project at once, so the same flip relocates many tasks
simultaneously. Promoting either requires the read path to be gated in step
with the write path, or an explicit decision that an existing isolated
workspace keeps running after rollback.
