import type { AgentInvokability } from "../agent-invokability.js";

export const BENIGN_RUN_CANCELLATION_ERROR_CODES = new Set<string>([
  "agent_paused",
  "issue_paused",
  "issue_dependencies_blocked",
  "issue_assignee_changed",
]);

export type StrandedScopeExemption =
  | "assignee_not_schedulable"
  | "unresolved_blockers"
  | "benign_run_cancellation"
  | "user_retryable_setup_failure"
  | "queued_never_run";

export type StrandedScopeRun = {
  status: string;
  errorCode: string | null;
  resultJson?: unknown;
} | null;

export function isAssigneeLifecycleBlocked(
  invokability: AgentInvokability | null | undefined,
): boolean {
  if (!invokability || invokability.invokable) return false;
  return (
    invokability.reason === "paused" ||
    invokability.reason === "terminated" ||
    invokability.reason === "pending_approval"
  );
}

export function isBenignRunCancellation(run: StrandedScopeRun): boolean {
  if (!run || run.status === "succeeded" || run.status === "running") return false;
  return BENIGN_RUN_CANCELLATION_ERROR_CODES.has(run.errorCode ?? "");
}

export function isProviderlessSetupFailure(run: StrandedScopeRun): boolean {
  if (!run || run.status !== "failed" || run.errorCode !== "setup_failed") {
    return false;
  }
  const result =
    run.resultJson && typeof run.resultJson === "object"
      ? (run.resultJson as Record<string, unknown>)
      : {};
  const evidence =
    result.executionRecovery && typeof result.executionRecovery === "object"
      ? (result.executionRecovery as Record<string, unknown>)
      : {};
  return evidence.kind === "bootstrap" && evidence.providerWorkStarted === false;
}

export function classifyStrandedScopeExemption(input: {
  invokability: AgentInvokability | null | undefined;
  unresolvedBlockerCount: number;
  latestRun: StrandedScopeRun;
  hasQueuedWake?: boolean;
  operatorCancelled?: boolean;
}): StrandedScopeExemption | null {
  if (isAssigneeLifecycleBlocked(input.invokability)) {
    return "assignee_not_schedulable";
  }
  if (input.unresolvedBlockerCount > 0) return "unresolved_blockers";
  if (input.operatorCancelled || isBenignRunCancellation(input.latestRun)) {
    return "benign_run_cancellation";
  }
  if (isProviderlessSetupFailure(input.latestRun)) {
    return "user_retryable_setup_failure";
  }
  if (!input.latestRun && input.hasQueuedWake) return "queued_never_run";
  return null;
}
