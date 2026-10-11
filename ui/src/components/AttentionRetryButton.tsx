import { useId, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import {
  isNativeWorkspaceExportRepairCause,
  requiresExecutionReconciliation,
  type Agent,
  type AttentionItem,
} from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "../api/agents";
import type { LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

/** What a desk Retry acts on, and why it cannot run right now when it cannot. */
export type AttentionRetryTarget =
  | {
      kind: "failed_run";
      agentId: string;
      agentName: string | null;
      runId: string;
      issueId: string | null;
      disabledReason: string | null;
    }
  | {
      kind: "recovery";
      actionId: string;
      issueId: string;
      agentId: string | null;
      agentName: string | null;
      disabledReason: string | null;
    };

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function closedIssueReason(status: string | null | undefined): string | null {
  if (status === "done") return "The task is already done.";
  if (status === "cancelled") return "The task is cancelled.";
  return null;
}

function unavailableAgentReason(agent: Agent | undefined): string | null {
  if (!agent) return null;
  if (agent.status === "terminated") return `${agent.name} is terminated.`;
  if (agent.status === "pending_approval") return `${agent.name} is awaiting approval.`;
  if (agent.status !== "paused") return null;
  return agent.pauseReason === "budget"
    ? `${agent.name} is stopped by its budget.`
    : `${agent.name} is paused. Resume it before retrying.`;
}

function liveRunReason(liveRuns: readonly LiveRunForIssue[] | undefined, issueId: string | null): string | null {
  if (!issueId || !liveRuns?.some((run) => run.issueId === issueId)) return null;
  return "A run is already live or queued for this task.";
}

function recoveryCauseReason(cause: string | null): string | null {
  if (requiresExecutionReconciliation(cause)) {
    return "This recovery needs an execution reconciliation. Open the task to record it.";
  }
  if (isNativeWorkspaceExportRepairCause(cause) || cause === "native_workspace_sync_out_unsafe_archive") {
    return "This recovery finishes through its workspace export. Open the task to repair it.";
  }
  return null;
}

/** Resolves the retry a failed-run or recovery row offers; null for every other row. */
export function attentionRetryTarget(
  item: AttentionItem,
  agentMap: ReadonlyMap<string, Agent> | undefined,
  liveRuns: readonly LiveRunForIssue[] | undefined,
): AttentionRetryTarget | null {
  const metadata = item.subject.metadata ?? {};
  const issue = item.relatedIssue;
  const assigneeAgentId = issue ? nonEmptyString(issue.metadata?.assigneeAgentId) : null;
  if (item.sourceKind === "failed_run") {
    const agentId = nonEmptyString(metadata.agentId);
    if (!agentId) return null;
    const issueId = nonEmptyString(metadata.issueId) ?? issue?.id ?? null;
    const agent = agentMap?.get(agentId);
    const reassignedReason = issue && assigneeAgentId !== agentId
      ? "The task is no longer assigned to this agent. Open it to choose the next step."
      : null;
    return {
      kind: "failed_run",
      agentId,
      agentName: agent?.name ?? nonEmptyString(metadata.agentName),
      runId: item.subject.id,
      issueId,
      disabledReason:
        closedIssueReason(issue?.status)
        ?? unavailableAgentReason(agent)
        ?? reassignedReason
        ?? liveRunReason(liveRuns, issueId),
    };
  }
  if (item.sourceKind === "recovery_action") {
    const issueId = nonEmptyString(metadata.sourceIssueId);
    if (!issueId) return null;
    const agent = assigneeAgentId ? agentMap?.get(assigneeAgentId) : undefined;
    return {
      kind: "recovery",
      actionId: item.subject.id,
      issueId,
      agentId: assigneeAgentId,
      agentName: agent?.name ?? null,
      disabledReason:
        recoveryCauseReason(nonEmptyString(metadata.cause))
        ?? closedIssueReason(issue?.status)
        ?? (assigneeAgentId ? null : "No agent owns this task. Open it to reassign.")
        ?? unavailableAgentReason(agent)
        ?? liveRunReason(liveRuns, issueId),
    };
  }
  return null;
}

async function performRetry(
  target: AttentionRetryTarget,
  companyId: string,
  agentMap: ReadonlyMap<string, Agent> | undefined,
): Promise<string | null> {
  if (target.kind === "failed_run") {
    await agentsApi.retryFailedRun(target.agentId, target.runId, companyId);
    return target.agentName;
  }
  const result = await issuesApi.resolveRecoveryAction(target.issueId, {
    actionId: target.actionId,
    outcome: "restored",
    sourceIssueStatus: "todo",
  });
  const ownerId = result.issue.assigneeAgentId;
  return (ownerId ? agentMap?.get(ownerId)?.name : null) ?? target.agentName;
}

/** One-click Retry for failed-run and recovery rows on the decisions desk. */
export function AttentionRetryButton({
  item,
  companyId,
  agentMap,
  liveRuns,
  onRetried,
  className,
}: {
  item: AttentionItem;
  companyId: string;
  agentMap?: ReadonlyMap<string, Agent>;
  liveRuns?: readonly LiveRunForIssue[];
  onRetried?: (item: AttentionItem) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const reasonId = useId();
  const inFlight = useRef(false);
  const target = useMemo(() => attentionRetryTarget(item, agentMap, liveRuns), [item, agentMap, liveRuns]);
  const retry = useMutation({
    mutationFn: (next: AttentionRetryTarget) => performRetry(next, companyId, agentMap),
    onSuccess: (agentName, next) => {
      onRetried?.(item);
      pushToast({
        title: agentName ? `Retrying with ${agentName}` : "Retry started",
        body: item.relatedIssue?.identifier ?? undefined,
        tone: "success",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(companyId) });
      if (next.issueId) void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(next.issueId) });
    },
    onError: (error) => {
      pushToast({
        title: "Could not retry",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  if (!target) return null;
  const reason = target.disabledReason;
  const pending = retry.isPending;
  const button = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className={cn("aria-disabled:cursor-not-allowed aria-disabled:opacity-50", className)}
      disabled={pending}
      aria-disabled={reason ? true : undefined}
      aria-describedby={reason ? reasonId : undefined}
      aria-label={target.agentName ? `Retry with ${target.agentName}` : "Retry"}
      data-attention-retry={target.kind}
      onClick={(event) => {
        event.stopPropagation();
        if (reason || inFlight.current) return;
        inFlight.current = true;
        retry.mutate(target);
      }}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
      {pending ? "Retrying…" : "Retry"}
    </Button>
  );
  if (!reason) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only" data-attention-retry-reason="true">
        {reason}
      </span>
    </TooltipProvider>
  );
}
