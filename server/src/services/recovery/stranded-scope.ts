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
  | "stale_continuation_context"
  | "queued_never_run";

export type StrandedScopeRun = {
  status: string;
  errorCode: string | null;
  error?: string | null;
  resultJson?: unknown;
} | null;

const STALE_CONTINUATION_CONTEXT_REASON = "continuation_source_context_missing";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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

export function isStaleContinuationContextSetupFailure(
  run: StrandedScopeRun,
): boolean {
  if (!run || run.status !== "failed" || run.errorCode !== "setup_failed") {
    return false;
  }
  const result = asRecord(run.resultJson);
  const evidence = asRecord(result.executionRecovery);
  if (evidence.kind !== "bootstrap" || evidence.providerWorkStarted !== false) {
    return false;
  }
  return [run.error, result.errorMessage, result.message].some(
    (value) =>
      typeof value === "string" &&
      value.includes(STALE_CONTINUATION_CONTEXT_REASON),
  );
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
  if (isStaleContinuationContextSetupFailure(input.latestRun)) {
    return "stale_continuation_context";
  }
  if (!input.latestRun && input.hasQueuedWake) return "queued_never_run";
  return null;
}
