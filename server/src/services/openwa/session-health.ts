import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { chatActions, chatConversations, chatEndpoints, issues, type Db } from "@tickernelz/paperclip-pro-db";
import { openwaEndpointPolicySchema } from "@tickernelz/paperclip-pro-shared";
import { forbidden } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { createDurableChatWakeupRequest } from "../durable-chat-wakeup.js";
import { issueService } from "../issues.js";
import { openwaWakeRuntime } from "./approvals.js";
import { openwaCurrentOwners } from "./owners.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type EndpointRow = typeof chatEndpoints.$inferSelect;

export const OPENWA_SESSION_HEALTH_WAKE_ACTION_KIND = "openwa_session_health_wakeup";
export const OPENWA_SESSION_HEALTH_WAKE_ACTOR_ID = "openwa:session-health";
const WAKE_MAX_ATTEMPTS = 5;
const WAKE_STALE_PROCESSING_MS = 2 * 60_000;
const INELIGIBLE_ISSUE_STATUSES = ["backlog", "done", "cancelled"];

export interface OpenwaSessionHealthFacts {
  kind: "status" | "restriction";
  healthy: boolean;
  status: string | null;
  restriction: { active: boolean; kind: string | null; code: string | null; expiresAt: string | null } | null;
}

export type OpenwaSessionHealthWakeStage =
  | { staged: true; actionId: string; conversationId: string; issueId: string }
  | { staged: false; reason: "no_assigned_agent" | "no_owner_conversation" };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function healthComment(facts: OpenwaSessionHealthFacts): string {
  if (facts.kind === "status")
    return facts.healthy
      ? "OpenWA session health changed: the WhatsApp session is ready again."
      : "OpenWA session health changed: the WhatsApp session is " + (facts.status ?? "not ready") + ".";
  if (facts.healthy) return "OpenWA session health changed: the WhatsApp restriction on this number was lifted.";
  const restriction = facts.restriction;
  return (
    "OpenWA session health changed: WhatsApp restricted this number" +
    (restriction?.kind ? " (" + restriction.kind + ")" : "") +
    (restriction?.expiresAt ? " until " + restriction.expiresAt : "") +
    "."
  );
}

/** Owner approval chat of the endpoint: self-chat in owner_number mode, else the most recent active owner DM. */
export async function openwaOwnerApprovalConversation(
  tx: DbTransaction,
  endpoint: EndpointRow,
  input: { sessionId: string; selfChatKey: string },
): Promise<{ conversationId: string; issueId: string; agentId: string } | null> {
  if (!endpoint.assignedAgentId) return null;
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  const chatKeys =
    policy.numberMode === "owner_number"
      ? [input.selfChatKey]
      : [
          ...new Set(
            (await openwaCurrentOwners(tx, endpoint)).flatMap((owner) => (owner.digits ? [owner.digits + "@c.us"] : [])),
          ),
        ];
  if (!chatKeys.length) return null;
  const [row] = await tx
    .select({ conversationId: chatConversations.id, issueId: issues.id })
    .from(chatConversations)
    .innerJoin(issues, and(eq(issues.companyId, chatConversations.companyId), eq(issues.id, chatConversations.issueId)))
    .where(
      and(
        eq(chatConversations.companyId, endpoint.companyId),
        eq(chatConversations.endpointId, endpoint.id),
        inArray(
          chatConversations.externalConversationId,
          chatKeys.map((chatKey) => "openwa:" + input.sessionId + ":" + chatKey),
        ),
        inArray(chatConversations.state, ["active", "waiting"]),
        eq(issues.assigneeAgentId, endpoint.assignedAgentId),
        notInArray(issues.status, INELIGIBLE_ISSUE_STATUSES),
      ),
    )
    .orderBy(sql`${chatConversations.lastActivityAt} desc nulls last`, desc(chatConversations.createdAt))
    .limit(1);
  return row ? { ...row, agentId: endpoint.assignedAgentId } : null;
}

/** Writes the system comment and queued wake action for one session health transition inside its transaction. */
export async function stageOpenwaSessionHealthWake(
  tx: DbTransaction,
  endpoint: EndpointRow,
  input: { sessionId: string; selfChatKey: string; facts: OpenwaSessionHealthFacts },
): Promise<OpenwaSessionHealthWakeStage> {
  if (!endpoint.assignedAgentId) return { staged: false, reason: "no_assigned_agent" };
  const target = await openwaOwnerApprovalConversation(tx, endpoint, input);
  if (!target) return { staged: false, reason: "no_owner_conversation" };
  const comment = await issueService(tx as unknown as Db).addComment(
    target.issueId,
    healthComment(input.facts),
    {},
    { authorType: "system" },
    tx,
  );
  const [action] = await tx
    .insert(chatActions)
    .values({
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      conversationId: target.conversationId,
      kind: OPENWA_SESSION_HEALTH_WAKE_ACTION_KIND,
      providerActionId: "openwa-session-health:" + randomUUID(),
      status: "queued",
      payload: {
        version: 1,
        issueId: target.issueId,
        agentId: target.agentId,
        commentId: comment.id,
        openwa: { event: "session_health", triggerClass: "other", deliveryIds: [], sessionHealth: input.facts },
      },
    })
    .returning({ id: chatActions.id });
  return { staged: true, actionId: action!.id, conversationId: target.conversationId, issueId: target.issueId };
}

export async function dispatchOpenwaSessionHealthWake(db: Db, actionId: string): Promise<boolean> {
  const runtime = openwaWakeRuntime(db);
  if (!runtime) return false;
  const now = new Date();
  const [claimed] = await db
    .update(chatActions)
    .set({ status: "processing", updatedAt: now })
    .where(
      and(
        eq(chatActions.id, actionId),
        eq(chatActions.kind, OPENWA_SESSION_HEALTH_WAKE_ACTION_KIND),
        or(
          eq(chatActions.status, "queued"),
          and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, new Date(now.getTime() - WAKE_STALE_PROCESSING_MS))),
        ),
      ),
    )
    .returning();
  if (!claimed) return false;
  const payload = claimed.payload;
  const attemptCount = Number(record(claimed.result).attemptCount ?? 0) + 1;
  const settle = (status: string, result: Record<string, unknown>) =>
    db
      .update(chatActions)
      .set({ status, result: { ...result, attemptCount }, updatedAt: new Date() })
      .where(and(eq(chatActions.id, claimed.id), eq(chatActions.status, "processing")));
  try {
    const issueId = String(payload.issueId);
    const agentId = String(payload.agentId);
    const commentId = String(payload.commentId);
    const openwa = record(payload.openwa);
    const [issue] = await db
      .select({ identifier: issues.identifier, assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, claimed.companyId), eq(issues.id, issueId)))
      .limit(1);
    if (!issue || issue.assigneeAgentId !== agentId || issue.status === "backlog") {
      await settle("failed", { code: "openwa_session_health_wake_target_changed" });
      return false;
    }
    const request = createDurableChatWakeupRequest({
      id: claimed.id,
      companyId: claimed.companyId,
      agentId,
      issueId,
      commentId,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_SESSION_HEALTH_WAKE_ACTOR_ID,
      requestedAt: claimed.createdAt,
      authorize: async (tx) => {
        const [endpoint] = await tx
          .select({ status: chatEndpoints.status, assignedAgentId: chatEndpoints.assignedAgentId })
          .from(chatEndpoints)
          .where(and(eq(chatEndpoints.companyId, claimed.companyId), eq(chatEndpoints.id, claimed.endpointId), eq(chatEndpoints.provider, "openwa")))
          .limit(1);
        if (!endpoint || endpoint.status === "archived" || endpoint.assignedAgentId !== agentId)
          throw forbidden("The OpenWA endpoint changed", { code: "chat_action_authorization_changed" });
      },
    });
    const context = { issueId, taskKey: issue.identifier, wakeCommentId: commentId, openwa };
    await runtime.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "OpenWA session health changed",
      payload: { ...context, mutation: "openwa_session_health" },
      contextSnapshot: { ...context, source: "chat:openwa" },
      allowRunCoalescing: false,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_SESSION_HEALTH_WAKE_ACTOR_ID,
      durableChatRequest: request,
    });
    await settle("processed", { code: "openwa_session_health_wake_dispatched", wakeupRequestId: claimed.id });
    return true;
  } catch (error) {
    logger.warn({ err: error, actionId: claimed.id }, "failed to dispatch OpenWA session health wake");
    await settle(attemptCount >= WAKE_MAX_ATTEMPTS ? "failed" : "queued", {
      code: "openwa_session_health_wake_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function processPendingOpenwaSessionHealthWakes(db: Db, limit = 25): Promise<number> {
  if (!openwaWakeRuntime(db)) return 0;
  const staleBefore = new Date(Date.now() - WAKE_STALE_PROCESSING_MS);
  const rows = await db
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.kind, OPENWA_SESSION_HEALTH_WAKE_ACTION_KIND),
        or(eq(chatActions.status, "queued"), and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, staleBefore))),
      ),
    )
    .orderBy(chatActions.createdAt)
    .limit(limit);
  let dispatched = 0;
  for (const row of rows) if (await dispatchOpenwaSessionHealthWake(db, row.id)) dispatched++;
  return dispatched;
}
