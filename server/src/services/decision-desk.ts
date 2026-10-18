import { and, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import { heartbeatRuns, issueComments, type Db } from "@tickernelz/paperclip-pro-db";
import type { AttentionFeedQuery, AttentionItem, DeskDecision, DeskDecisionList } from "@tickernelz/paperclip-pro-shared";
import { isCompanyOwnerAgent } from "@tickernelz/paperclip-pro-shared";
import { forbidden, HttpError } from "../errors.js";
import { attentionService } from "./attention.js";
import { boardAuthService } from "./board-auth.js";
import { openwaRunProfile, readOpenwaRunContext } from "./openwa/authority.js";
import { isOpenAttentionItem, relayStateByItem } from "./owner-decision-relay.js";

export const DECISIONS_DESK_FORBIDDEN_CODE = "decisions_desk_forbidden";

type DeskDenial =
  | "board_user_required"
  | "owner_context_required"
  | "run_required"
  | "run_not_active"
  | "not_owner_run"
  | "owner_not_member";

function denied(reason: DeskDenial, message: string) {
  return forbidden(message, { code: DECISIONS_DESK_FORBIDDEN_CODE, reason });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function wakeCommentIds(context: Record<string, unknown>): string[] {
  const ids = Array.isArray(context.wakeCommentIds) ? context.wakeCommentIds : [];
  return [...ids, context.wakeCommentId].filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

async function wokenByOwnComment(db: Db, input: { companyId: string; userId: string; commentIds: string[] }) {
  if (input.commentIds.length === 0) return false;
  const comments = await db
    .select({
      authorType: issueComments.authorType,
      authorUserId: issueComments.authorUserId,
      authorAgentId: issueComments.authorAgentId,
      createdByRunId: issueComments.createdByRunId,
      deletedAt: issueComments.deletedAt,
      sourceTrust: issueComments.sourceTrust,
    })
    .from(issueComments)
    .where(and(eq(issueComments.companyId, input.companyId), inArray(issueComments.id, input.commentIds)));
  return comments.some(
    (comment) =>
      !comment.deletedAt &&
      comment.authorType === "user" &&
      comment.authorUserId === input.userId &&
      !comment.authorAgentId &&
      !comment.createdByRunId &&
      comment.sourceTrust?.disposition !== "quarantined",
  );
}

export async function resolveDeskReader(db: Db, input: { companyId: string; actor: Request["actor"] }): Promise<string> {
  const { actor, companyId } = input;
  if (actor.type === "board") {
    if (!actor.userId) throw denied("board_user_required", "Board user context required");
    return actor.userId;
  }
  if (actor.type !== "agent") throw denied("owner_context_required", "The Decisions desk is read on behalf of an owner");
  const userId = actor.onBehalfOfUserId?.trim();
  if (!userId) throw denied("owner_context_required", "The Decisions desk is read on behalf of an owner; this agent has no responsible user");
  if (!actor.runId) throw denied("run_required", "The Decisions desk is read from an owner's run, not from a bare agent key");
  const [run] = await db
    .select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId, status: heartbeatRuns.status, contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.companyId, companyId)))
    .limit(1);
  if (!run || run.agentId !== actor.agentId || run.status !== "running") {
    throw denied("run_not_active", "Only the agent's own active run can read the Decisions desk");
  }
  const context = record(run.contextSnapshot);
  const openwa = readOpenwaRunContext(context);
  const profile = await openwaRunProfile(db, { id: run.id, companyId: run.companyId, contextSnapshot: context });
  const notOwnerRun = () => denied("not_owner_run", "Only a full-profile run started by the owner's own message can read the Decisions desk");
  if (profile !== "full" || (openwa && openwa.triggerClass !== "owner")) throw notOwnerRun();
  if (!openwa && !isCompanyOwnerAgent(actor) && !(await wokenByOwnComment(db, { companyId, userId, commentIds: wakeCommentIds(context) }))) {
    throw notOwnerRun();
  }
  const access = await boardAuthService(db).resolveBoardAccess(userId);
  if (!access.user || (!access.isInstanceAdmin && !access.companyIds.includes(companyId))) {
    throw denied("owner_not_member", "The responsible user is not an active board member of this company");
  }
  return userId;
}

export async function canReadDesk(db: Db, input: { companyId: string; actor: Request["actor"] }): Promise<boolean> {
  try {
    await resolveDeskReader(db, input);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return false;
    throw error;
  }
}

export async function listDeskDecisions(
  db: Db,
  input: { companyId: string; actor: Request["actor"]; userId: string; query: AttentionFeedQuery },
): Promise<DeskDecisionList> {
  const feed = await attentionService(db).list(input.companyId, {
    ...input.query,
    userId: input.userId,
    actor: input.actor,
    allowUnscopedAll: input.query.all,
  });
  const relay = await relayStateByItem(db, input.companyId, feed.items);
  const generatedAt = Date.parse(feed.generatedAt);
  const items = feed.items.map((item): DeskDecision => {
    const issue = item.relatedIssue ?? (item.subject.kind === "issue" ? item.subject : null);
    const state = relay.get(item.id);
    return {
      sourceKind: item.sourceKind,
      id: item.subject.id,
      severity: item.severity,
      rank: item.rank,
      issueId: issue?.id ?? null,
      issueIdentifier: issue?.identifier ?? null,
      issueTitle: issue?.title ?? null,
      title: item.subject.title,
      whyNow: item.whyNow,
      createdAt: item.createdAt,
      activityAt: item.activityAt,
      ageSeconds: Math.max(0, Math.floor((generatedAt - Date.parse(item.createdAt)) / 1000)),
      decideBy: item.decideBy,
      entryRule: item.entryRule,
      exitRule: item.exitRule,
      href: item.subject.href,
      open: isOpenAttentionItem(item, generatedAt),
      snoozedUntil: item.snoozedUntil,
      archivedAt: item.archivedAt,
      relayable: state?.relayable ?? false,
      relayBlockedReason: state?.relayBlockedReason ?? null,
    };
  });
  return {
    companyId: feed.companyId,
    scope: "desk",
    generatedAt: feed.generatedAt,
    totalCount: feed.totalCount,
    countsBySourceKind: feed.countsBySourceKind,
    nextCursor: feed.nextCursor,
    items,
  };
}
