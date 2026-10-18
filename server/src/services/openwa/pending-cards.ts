import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { agents, chatActions, chatEndpoints, issueThreadInteractions, issues, type Db } from "@tickernelz/paperclip-pro-db";
import { openwaEndpointPolicySchema } from "@tickernelz/paperclip-pro-shared";
import { canActorReadIssuePrivacy, issuePrivacyMode } from "../authorization.js";
import { forbidden } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { dueChatAction } from "../chat-action-work.js";
import { notifyChatActionWork } from "../chat-work-notifications.js";
import { createDurableChatWakeupRequest } from "../durable-chat-wakeup.js";
import { issueService } from "../issues.js";
import { publicChatTaskUrl } from "../chat-task-url.js";
import { ownerRelayBlockedReason, pendingDecisionCardShape } from "../owner-decision-relay.js";
import { openwaWakeRuntime } from "./approvals.js";
import { openwaChatKey } from "./outbound.js";
import { openwaCurrentOwners } from "./owners.js";
import { openwaOwnerApprovalConversation } from "./session-health.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTransaction = Db | DbTransaction;
type EndpointRow = typeof chatEndpoints.$inferSelect;
type CardRow = typeof issueThreadInteractions.$inferSelect;

export const OPENWA_PENDING_CARD_ACTION_KIND = "openwa_pending_card";
export const OPENWA_PENDING_CARD_WAKE_ACTOR_ID = "openwa:pending-card";
const WAKE_MAX_ATTEMPTS = 5;
const WAKE_RETRY_MS = 30_000;
export const OPENWA_PENDING_CARD_BATCH_MS = 60_000;
const MAX_CARDS_PER_ACTION = 10;
const CARD_MAX_PER_WAKE = 10;
const CARD_MAX_OPTIONS = 10;
const CARD_TITLE_LIMIT = 200;
const CARD_PROMPT_LIMIT = 600;
const CARD_LABEL_LIMIT = 120;
const RELAYED_KINDS = new Set([
  "ask_user_questions",
  "request_confirmation",
  "request_checkbox_confirmation",
  "suggest_tasks",
  "request_item_verdicts",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** True for a pending agent-created human_only card an owner may answer from WhatsApp. */
export function openwaOwnerCard(card: Pick<CardRow, "id" | "kind" | "status" | "payload" | "createdByAgentId" | "effectiveResolverPolicy">): boolean {
  return (
    card.status === "pending" &&
    card.effectiveResolverPolicy === "human_only" &&
    Boolean(card.createdByAgentId) &&
    RELAYED_KINDS.has(card.kind) &&
    record(card.payload).destructive !== true &&
    ownerRelayBlockedReason(card) === null
  );
}

/** Owners who read the chat a card is sent to: the chat's own owner in a DM, every current owner in owner_number mode. */
async function chatRecipients(db: DbOrTransaction, endpoint: EndpointRow, chatKey: string): Promise<string[]> {
  const owners = await openwaCurrentOwners(db, endpoint);
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  const readers = policy.numberMode === "owner_number" ? owners : owners.filter((owner) => owner.jids.map(openwaChatKey).includes(chatKey));
  return [...new Set(readers.map((owner) => owner.userId))];
}

/** True when the endpoint agent, acting for each recipient, may read the issue; fails closed without recipients. */
async function recipientsMayRead(
  db: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "assignedAgentId">,
  issueId: string,
  recipients: string[],
): Promise<boolean> {
  if (issuePrivacyMode() !== "enforce") return true;
  if (!endpoint.assignedAgentId || recipients.length === 0) return false;
  const [issue] = await db.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, endpoint.companyId))).limit(1);
  if (!issue) return false;
  for (const userId of recipients) {
    const actor = { type: "agent" as const, agentId: endpoint.assignedAgentId, companyId: endpoint.companyId, onBehalfOfUserId: userId };
    if (!(await canActorReadIssuePrivacy(db, actor, issue))) return false;
  }
  return true;
}

/** Queues one owner-chat wake per active OpenWA endpoint for a new owner card, inside the card's transaction. */
export async function stageOpenwaPendingCardWakes(tx: DbTransaction, card: CardRow): Promise<string[]> {
  if (!openwaOwnerCard(card)) return [];
  const endpoints = await tx
    .select()
    .from(chatEndpoints)
    .where(
      and(
        eq(chatEndpoints.companyId, card.companyId),
        eq(chatEndpoints.provider, "openwa"),
        eq(chatEndpoints.status, "active"),
        isNotNull(chatEndpoints.assignedAgentId),
      ),
    );
  if (!endpoints.length) return [];
  const [issue] = await tx
    .select({ identifier: issues.identifier })
    .from(issues)
    .where(and(eq(issues.companyId, card.companyId), eq(issues.id, card.issueId)))
    .limit(1);
  const staged: string[] = [];
  for (const endpoint of endpoints) {
    const account = endpoint.providerAccountId ?? "";
    if (!account.includes("#")) continue;
    const target = await openwaOwnerApprovalConversation(tx, endpoint, {
      sessionId: account.slice(account.lastIndexOf("#") + 1),
      selfChatKey: (endpoint.botExternalId ?? "").replace(/\D/g, "") + "@c.us",
      ...(card.addresseeUserId ? { onlyUserId: card.addresseeUserId } : {}),
    });
    if (!target) {
      logger.warn({ endpointId: endpoint.id, interactionId: card.id }, "OpenWA owner card has no owner conversation");
      continue;
    }
    if (!(await recipientsMayRead(tx, endpoint, card.issueId, await chatRecipients(tx, endpoint, target.chatKey)))) continue;
    const [open] = await tx
      .select()
      .from(chatActions)
      .where(
        and(
          eq(chatActions.companyId, card.companyId),
          eq(chatActions.endpointId, endpoint.id),
          eq(chatActions.conversationId, target.conversationId),
          eq(chatActions.kind, OPENWA_PENDING_CARD_ACTION_KIND),
          eq(chatActions.status, "received"),
        ),
      )
      .orderBy(desc(chatActions.createdAt))
      .limit(1)
      .for("update");
    const openIds = open ? ((record(record(open.payload).openwa).pendingCardIds as string[] | undefined) ?? []) : [];
    if (open && openIds.length < MAX_CARDS_PER_ACTION && !openIds.includes(card.id)) {
      const openwa = { ...record(open.payload.openwa), pendingCardIds: [...openIds, card.id] };
      await tx.update(chatActions).set({ payload: { ...open.payload, openwa }, updatedAt: new Date() }).where(eq(chatActions.id, open.id));
      staged.push(open.id);
      continue;
    }
    const payload = {
      version: 1,
      issueId: target.issueId,
      agentId: target.agentId,
      interactionId: card.id,
      chatKey: target.chatKey,
      openwa: { event: "pending_card", triggerClass: "other", deliveryIds: [], pendingCardIds: [card.id] },
    };
    const [action] = await tx
      .insert(chatActions)
      .values({
        companyId: card.companyId,
        endpointId: endpoint.id,
        conversationId: target.conversationId,
        kind: OPENWA_PENDING_CARD_ACTION_KIND,
        providerActionId: "openwa-pending-card:" + card.id,
        status: "received",
        payload,
        result: { retryAt: new Date(Date.now() + OPENWA_PENDING_CARD_BATCH_MS).toISOString() },
      })
      .onConflictDoNothing()
      .returning({ id: chatActions.id });
    if (!action) continue;
    const comment = await issueService(tx as unknown as Db).addComment(
      target.issueId,
      "Paperclip card " + card.id.slice(0, 8) + " on " + (issue?.identifier ?? card.issueId) + " waits for an owner decision.",
      {},
      { authorType: "system" },
      tx,
    );
    await tx.update(chatActions).set({ payload: { ...payload, commentId: comment.id } }).where(eq(chatActions.id, action.id));
    staged.push(action.id);
  }
  if (staged.length) await notifyChatActionWork(tx, OPENWA_PENDING_CARD_ACTION_KIND);
  return staged;
}

/** Wakes the endpoint agent in the owner chat for one staged card; settles a resolved card without waking. */
export async function dispatchOpenwaPendingCardWake(db: Db, actionId: string): Promise<boolean> {
  const runtime = openwaWakeRuntime(db);
  if (!runtime) return false;
  const now = new Date();
  const [claimed] = await db
    .update(chatActions)
    .set({ status: "processing", updatedAt: now })
    .where(and(eq(chatActions.id, actionId), dueChatAction(OPENWA_PENDING_CARD_ACTION_KIND, now.getTime())))
    .returning();
  if (!claimed) return false;
  const payload = claimed.payload;
  const attemptCount = Number(record(claimed.result).attemptCount ?? 0) + 1;
  const settle = (status: "processed" | "failed", result: Record<string, unknown>) =>
    db
      .update(chatActions)
      .set({ status, result: { ...result, attemptCount }, updatedAt: new Date() })
      .where(and(eq(chatActions.id, claimed.id), eq(chatActions.status, "processing")));
  try {
    const issueId = String(payload.issueId);
    const agentId = String(payload.agentId);
    const commentId = String(payload.commentId);
    const openwa = record(payload.openwa);
    const cardIds = Array.isArray(openwa.pendingCardIds) ? openwa.pendingCardIds.filter((id): id is string => typeof id === "string") : [];
    const pendingCards = cardIds.length
      ? await db
          .select({ id: issueThreadInteractions.id, issueId: issueThreadInteractions.issueId })
          .from(issueThreadInteractions)
          .where(
            and(
              eq(issueThreadInteractions.companyId, claimed.companyId),
              inArray(issueThreadInteractions.id, cardIds),
              eq(issueThreadInteractions.status, "pending"),
            ),
          )
      : [];
    if (pendingCards.length === 0) {
      await settle("processed", { code: "openwa_pending_card_resolved" });
      return false;
    }
    const [issue] = await db
      .select({ identifier: issues.identifier, assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, claimed.companyId), eq(issues.id, issueId)))
      .limit(1);
    if (!issue || issue.assigneeAgentId !== agentId || ["backlog", "done", "cancelled"].includes(issue.status)) {
      await settle("failed", { code: "openwa_pending_card_target_changed" });
      return false;
    }
    const [endpoint] = await db.select().from(chatEndpoints).where(and(eq(chatEndpoints.companyId, claimed.companyId), eq(chatEndpoints.id, claimed.endpointId))).limit(1);
    const recipients = endpoint ? await chatRecipients(db, endpoint, String(payload.chatKey ?? "")) : [];
    const readable = endpoint
      ? await Promise.all(pendingCards.map((pending) => recipientsMayRead(db, endpoint, pending.issueId, recipients)))
      : [];
    if (!readable.some(Boolean)) {
      await settle("processed", { code: "openwa_pending_card_unreadable" });
      return false;
    }
    const request = createDurableChatWakeupRequest({
      id: claimed.id,
      companyId: claimed.companyId,
      agentId,
      issueId,
      commentId,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_PENDING_CARD_WAKE_ACTOR_ID,
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
      reason: "Paperclip card waits for an owner",
      payload: { ...context, mutation: "openwa_pending_card" },
      contextSnapshot: { ...context, source: "chat:openwa" },
      allowRunCoalescing: false,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_PENDING_CARD_WAKE_ACTOR_ID,
      durableChatRequest: request,
    });
    await settle("processed", { code: "openwa_pending_card_wake_dispatched", wakeupRequestId: claimed.id });
    return true;
  } catch (error) {
    logger.warn({ err: error, actionId: claimed.id }, "failed to dispatch OpenWA pending card wake");
    await settle("failed", {
      code: "openwa_pending_card_wake_failed",
      error: error instanceof Error ? error.message : String(error),
      retryable: attemptCount < WAKE_MAX_ATTEMPTS,
      retryAt: new Date(Date.now() + WAKE_RETRY_MS * attemptCount).toISOString(),
    });
    return false;
  }
}

export async function processPendingOpenwaPendingCardWakes(db: Db, limit = 25): Promise<number> {
  if (!openwaWakeRuntime(db)) return 0;
  const rows = await db
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(dueChatAction(OPENWA_PENDING_CARD_ACTION_KIND))
    .orderBy(chatActions.createdAt)
    .limit(limit);
  let dispatched = 0;
  for (const row of rows) if (await dispatchOpenwaPendingCardWake(db, row.id)) dispatched++;
  return dispatched;
}

export interface OpenwaPendingCard {
  interactionId: string;
  card: string;
  kind: string;
  issue: string;
  issueTitle: string;
  url: string;
  requestedBy: string | null;
  title: string | null;
  prompt: string | null;
  options: Array<{ id: string; label: string }>;
  questions: Array<{ id: string; prompt: string; selectionMode: "single" | "multi"; options: Array<{ id: string; label: string }> }>;
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

function clipOptions(options: ReadonlyArray<{ id: string; label: string }>) {
  return options.slice(0, CARD_MAX_OPTIONS).map((option) => ({ id: option.id, label: clip(option.label, CARD_LABEL_LIMIT) }));
}

/** Still-pending owner cards named by a wake; titles, prompts and labels are worker-authored data. */
export async function openwaPendingCardsForWake(
  db: Db,
  input: { companyId: string; endpointId: string; chatKey: string; interactionIds: string[] },
): Promise<OpenwaPendingCard[]> {
  const { companyId, interactionIds } = input;
  if (!interactionIds.length) return [];
  const [endpoint] = await db.select().from(chatEndpoints).where(and(eq(chatEndpoints.companyId, companyId), eq(chatEndpoints.id, input.endpointId))).limit(1);
  if (!endpoint) return [];
  const recipients = await chatRecipients(db, endpoint, input.chatKey);
  const rows = await db
    .select({ card: issueThreadInteractions, identifier: issues.identifier, issueTitle: issues.title, requestedBy: agents.name })
    .from(issueThreadInteractions)
    .innerJoin(issues, and(eq(issues.companyId, issueThreadInteractions.companyId), eq(issues.id, issueThreadInteractions.issueId)))
    .leftJoin(agents, and(eq(agents.companyId, issueThreadInteractions.companyId), eq(agents.id, issueThreadInteractions.createdByAgentId)))
    .where(
      and(
        eq(issueThreadInteractions.companyId, companyId),
        inArray(issueThreadInteractions.id, interactionIds.slice(0, CARD_MAX_PER_WAKE)),
        eq(issueThreadInteractions.status, "pending"),
      ),
    )
    .orderBy(asc(issueThreadInteractions.createdAt));
  const readable = await Promise.all(
    rows.map(async (row) => openwaOwnerCard(row.card) && (await recipientsMayRead(db, endpoint, row.card.issueId, recipients))),
  );
  return rows.filter((_, index) => readable[index]).map(({ card, identifier, issueTitle, requestedBy }) => {
    const shape = pendingDecisionCardShape(card.kind, record(card.payload));
    const reference = identifier ?? card.issueId;
    return {
      interactionId: card.id,
      card: card.id.slice(0, 8),
      kind: card.kind,
      issue: reference,
      issueTitle: clip(issueTitle, CARD_TITLE_LIMIT),
      url: publicChatTaskUrl(reference) ?? "/issues/" + reference,
      requestedBy,
      title: card.title ? clip(card.title, CARD_TITLE_LIMIT) : null,
      prompt: shape.prompt ? clip(shape.prompt, CARD_PROMPT_LIMIT) : null,
      options: clipOptions(shape.options),
      questions: shape.questions.slice(0, CARD_MAX_OPTIONS).map((question) => ({
        id: question.id,
        prompt: clip(question.prompt, CARD_PROMPT_LIMIT),
        selectionMode: question.selectionMode,
        options: clipOptions(question.options),
      })),
    };
  });
}
