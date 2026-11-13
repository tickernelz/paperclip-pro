import type { IssueUnblockDescriptor } from "@tickernelz/wardmote-shared";
import type { heartbeatRuns } from "@tickernelz/wardmote-db";
import { deliverAgentUnblockNotification } from "../routable-blocked.js";
import { readHeartbeatRunErrorFamily } from "./retries.js";

export const PROVIDER_REQUEST_REJECTED_FAMILY = "provider_request_rejected";

const MAX_ERROR_CHARS = 500;
const BLOCKABLE_STATUSES = new Set(["todo", "in_progress"]);

type RejectedRun = Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "errorCode" | "error" | "resultJson">;

type BlockableIssue = {
  id: string;
  companyId: string;
  status: string;
  assigneeAgentId: string | null;
  executionRunId: string | null;
  unblockDescriptor?: IssueUnblockDescriptor | null;
  blockedTransitionAt?: Date | null;
  blockedOwnerNotifiedAt?: Date | null;
};

type WakeupOptions = Parameters<Parameters<typeof deliverAgentUnblockNotification>[0]["wakeup"]>[1];

export interface ProviderRequestRejectionDependencies {
  getIssue: (issueId: string) => Promise<BlockableIssue | null>;
  getAgent: (agentId: string) => Promise<{ id: string; companyId: string; reportsTo: string | null } | null>;
  blockIssue: (issueId: string, unblockDescriptor: IssueUnblockDescriptor) => Promise<BlockableIssue | null>;
  wakeup: (agentId: string, options: WakeupOptions) => Promise<unknown>;
  markOwnerNotified: (issueId: string, notifiedAt: Date) => Promise<unknown>;
}

async function resolveUnblockOwner(
  deps: ProviderRequestRejectionDependencies,
  run: RejectedRun,
): Promise<IssueUnblockDescriptor["owner"]> {
  const agent = await deps.getAgent(run.agentId);
  const managerId = agent?.companyId === run.companyId ? agent.reportsTo : null;
  if (!managerId) return "board";
  const manager = await deps.getAgent(managerId);
  return manager?.companyId === run.companyId ? { agentId: manager.id } : "board";
}

function unblockAction(run: RejectedRun): string {
  const error = (run.error ?? run.errorCode ?? "invalid request").trim().slice(0, MAX_ERROR_CHARS);
  return (
    `The model provider rejected run ${run.id} as an invalid request, also after one retry on a fresh session: ${error}. ` +
    "Fix the model or provider configuration of the assignee, then move this issue back to in_progress."
  );
}

export async function blockIssueAfterProviderRequestRejection(
  deps: ProviderRequestRejectionDependencies,
  run: RejectedRun,
  issueId: string | null,
) {
  if (!issueId) return null;
  if (readHeartbeatRunErrorFamily(run) !== PROVIDER_REQUEST_REJECTED_FAMILY) {
    return null;
  }
  const issue = await deps.getIssue(issueId);
  if (
    !issue ||
    issue.companyId !== run.companyId ||
    !BLOCKABLE_STATUSES.has(issue.status) ||
    issue.assigneeAgentId !== run.agentId ||
    (issue.executionRunId !== null && issue.executionRunId !== run.id)
  ) {
    return null;
  }
  const blocked = await deps.blockIssue(issue.id, {
    owner: await resolveUnblockOwner(deps, run),
    action: unblockAction(run),
  });
  if (!blocked) return null;
  await deliverAgentUnblockNotification({
    issue: blocked,
    wakeup: deps.wakeup,
    markNotified: (notifiedAt) => deps.markOwnerNotified(blocked.id, notifiedAt),
  });
  return blocked;
}
