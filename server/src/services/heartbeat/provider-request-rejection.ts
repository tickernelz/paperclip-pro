import { and, eq, inArray } from "drizzle-orm";
import type { IssueUnblockDescriptor } from "@tickernelz/wardmote-shared";
import { issues, type Db, type heartbeatRuns } from "@tickernelz/wardmote-db";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { executeIssuePostCommitActions, type IssuePostCommitAction, type issueService } from "../issues.js";
import { deliverAgentUnblockNotification } from "../routable-blocked.js";
import { readHeartbeatRunErrorFamily } from "./retries.js";

export const PROVIDER_REQUEST_REJECTED_FAMILY = "provider_request_rejected";

const MAX_ERROR_CHARS = 500;
const BLOCKABLE_STATUSES = ["todo", "in_progress"] as const;

type RejectedRun = Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "errorCode" | "error" | "resultJson">;

type WakeupOptions = Parameters<Parameters<typeof deliverAgentUnblockNotification>[0]["wakeup"]>[1];

export interface ProviderRequestRejectionDependencies {
  db: Db;
  issuesSvc: Pick<ReturnType<typeof issueService>, "update" | "addComment">;
  getAgent: (agentId: string) => Promise<{ id: string; companyId: string; reportsTo: string | null } | null>;
  wakeup: (agentId: string, options: WakeupOptions) => Promise<unknown>;
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
  if (!issueId || readHeartbeatRunErrorFamily(run) !== PROVIDER_REQUEST_REJECTED_FAMILY) return null;
  const unblockDescriptor: IssueUnblockDescriptor = {
    owner: await resolveUnblockOwner(deps, run),
    action: unblockAction(run),
  };
  const publications: ActivityPublication[] = [];
  const postCommitActions: IssuePostCommitAction[] = [];
  const blocked = await deps.db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(issues)
      .where(and(
        eq(issues.companyId, run.companyId),
        eq(issues.id, issueId),
        inArray(issues.status, [...BLOCKABLE_STATUSES]),
        eq(issues.assigneeAgentId, run.agentId),
      ))
      .for("update")
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!current || (current.executionRunId !== null && current.executionRunId !== run.id)) return null;
    const updated = await deps.issuesSvc.update(
      current.id,
      { status: "blocked", unblockDescriptor },
      tx,
      publications,
      postCommitActions,
    );
    if (!updated) return null;
    await deps.issuesSvc.addComment(
      current.id,
      `Wardmote moved this issue to \`blocked\`. ${unblockDescriptor.action}`,
      {},
      {
        authorType: "system",
        presentation: {
          kind: "system_notice",
          tone: "danger",
          title: "Provider rejected the request",
          detailsDefaultOpen: false,
          density: "compact",
        },
      },
      tx,
    );
    await logActivity(
      tx as unknown as Db,
      {
        companyId: current.companyId,
        actorType: "system",
        actorId: "heartbeat",
        action: "issue.updated",
        entityType: "issue",
        entityId: current.id,
        issueId: current.id,
        runId: run.id,
        details: {
          source: "heartbeat.provider_request_rejected",
          status: "blocked",
          previousStatus: current.status,
          runId: run.id,
          unblockOwner: unblockDescriptor.owner,
        },
      },
      publications,
    );
    return updated;
  });
  if (!blocked) return null;
  for (const publication of publications) publishActivity(publication);
  await executeIssuePostCommitActions(deps.db, postCommitActions);
  await deliverAgentUnblockNotification({
    issue: blocked,
    wakeup: deps.wakeup,
    markNotified: (notifiedAt) =>
      deps.db.update(issues).set({ blockedOwnerNotifiedAt: notifiedAt }).where(eq(issues.id, blocked.id)),
  });
  return blocked;
}
