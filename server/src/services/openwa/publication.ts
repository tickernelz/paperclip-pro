import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import {
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  chatOwnerGrants,
  chatPublications,
  heartbeatRuns,
  issueComments,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  openwaChatSettingsSchema,
  openwaEndpointPolicySchema,
  type OpenwaGrantCategory,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import { projectSafeChatPublicationTextOrNull } from "../chat-publication-projection.js";
import { parseOpenwaThreadId } from "./adapter.js";
import { formatOpenwaPublication } from "./format.js";
import type { OpenwaGatewayClient, OpenwaSendResult } from "./gateway.js";
import { openwaChatKey, sendThroughRegistry, type OpenwaOutboundRegistry } from "./outbound.js";
import type { OpenwaState } from "./state.js";
import { logOpenwaActivity, recordOpenwaAudit } from "./audit.js";
import { readOpenwaRunContext } from "./authority.js";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
type EndpointRow = typeof chatEndpoints.$inferSelect;
type ConversationRow = typeof chatConversations.$inferSelect;
type PublicationRow = typeof chatPublications.$inferSelect;

export const OPENWA_PUBLICATION_ACTION_KIND = "openwa_publication";
export const OPENWA_LAST_OUTPUT_ACTION_KIND = "openwa_last_output";
const PUBLICATION_KEY = /^(comment|attachment):[0-9a-f-]{36}:[0-9a-f-]{36}$/i;

export type OpenwaSuppressionReason =
  | "already_published"
  | "no_pending_trigger"
  | "reply_policy_ask_owner"
  | "reply_policy_owner_absent_only"
  | "outside_allowlist"
  | "no_openwa_context";

export type OpenwaPublicationDecision =
  | { kind: "publish"; runId: string; quotedMessageId: string | null; triggerIds: string[] }
  | { kind: "suppressed"; runId: string | null; reason: OpenwaSuppressionReason }
  | { kind: "empty"; runId: string }
  | { kind: "blocked"; reason: "not_agent_output" };

interface StoredDecision {
  version: 1;
  runId: string;
  decision: "published" | "suppressed";
  reason: OpenwaSuppressionReason | null;
  quotedMessageId: string | null;
  triggerIds: string[];
}

export interface OpenwaLastOutput {
  runId: string;
  suppressed: boolean;
  reason: OpenwaSuppressionReason | null;
  decidedAt: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function triggerClass(value: unknown): OpenwaTriggerClass | null {
  return value === "owner" || value === "other" || value === "grant" ? value : null;
}

export function openwaRunTriggerClass(contextSnapshot: unknown): OpenwaTriggerClass | null {
  return triggerClass(record(record(contextSnapshot).paperclipOpenwa).triggerClass);
}

function runGrantIds(contextSnapshot: unknown): Set<string> {
  const ids = record(record(contextSnapshot).paperclipOpenwa).grantIds;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

function runEvent(contextSnapshot: unknown): string | null {
  const event = record(record(contextSnapshot).paperclipOpenwa).event;
  return typeof event === "string" ? event : null;
}

function triggerWaMessageId(normalizedEvent: Record<string, unknown>): string | null {
  const openwa = record(normalizedEvent.openwa);
  if (typeof openwa.waMessageId === "string" && openwa.waMessageId) return openwa.waMessageId;
  const message = record(normalizedEvent.message);
  return typeof message.providerMessageId === "string" && !message.providerMessageId.startsWith("row:") ? message.providerMessageId : null;
}

function publicationActionId(publicationId: string): string {
  return "openwa-publication:" + publicationId;
}

function runPublishedActionId(runId: string, conversationId: string): string {
  return "openwa-run-published:" + runId + ":" + conversationId;
}

function lastOutputActionId(conversationId: string): string {
  return "openwa-last-output:" + conversationId;
}

export function openwaChatTarget(conversation: Pick<ConversationRow, "externalThreadId">): { chatId: string; chatKey: string; isGroup: boolean } {
  const thread = parseOpenwaThreadId(conversation.externalThreadId);
  return { chatId: thread.chatId, chatKey: openwaChatKey(thread.chatId), isGroup: thread.isGroup };
}

async function sourceRun(db: DbOrTransaction, endpoint: EndpointRow, publication: PublicationRow) {
  if (!PUBLICATION_KEY.test(publication.idempotencyKey) || !publication.commentId) return null;
  const [row] = await db
    .select({
      runId: heartbeatRuns.id,
      contextSnapshot: heartbeatRuns.contextSnapshot,
      startedAt: heartbeatRuns.startedAt,
      runCreatedAt: heartbeatRuns.createdAt,
      body: issueComments.body,
    })
    .from(issueComments)
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.companyId, issueComments.companyId),
        eq(heartbeatRuns.id, issueComments.createdByRunId),
        eq(heartbeatRuns.agentId, endpoint.assignedAgentId),
      ),
    )
    .where(
      and(
        eq(issueComments.companyId, publication.companyId),
        eq(issueComments.issueId, publication.issueId),
        eq(issueComments.id, publication.commentId),
        eq(issueComments.authorType, "agent"),
        eq(issueComments.authorAgentId, endpoint.assignedAgentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function upsertLastOutput(tx: DbOrTransaction, input: { companyId: string; endpointId: string; conversationId: string; value: OpenwaLastOutput }) {
  await tx
    .insert(chatActions)
    .values({
      companyId: input.companyId,
      endpointId: input.endpointId,
      conversationId: input.conversationId,
      kind: OPENWA_LAST_OUTPUT_ACTION_KIND,
      providerActionId: lastOutputActionId(input.conversationId),
      payload: { version: 1, ...input.value },
      status: "processed",
    })
    .onConflictDoUpdate({
      target: [chatActions.endpointId, chatActions.providerActionId],
      set: { payload: { version: 1, ...input.value }, updatedAt: new Date() },
    });
}

export async function decideOpenwaRunPublication(
  db: Db,
  input: { endpoint: EndpointRow; conversation: ConversationRow; publication: PublicationRow; now?: Date },
): Promise<OpenwaPublicationDecision> {
  const { endpoint, conversation, publication } = input;
  const run = await sourceRun(db, endpoint, publication);
  if (!run) return { kind: "blocked", reason: "not_agent_output" };
  const isText = !publication.payload.attachmentIds?.length;
  if (isText && projectSafeChatPublicationTextOrNull(run.body) === null) return { kind: "empty", runId: run.runId };
  const now = input.now ?? new Date();
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy);
  const target = openwaChatTarget(conversation);
  return db.transaction(async (tx) => {
    const actionKey = publicationActionId(publication.id);
    const runKey = runPublishedActionId(run.runId, conversation.id);
    const decided = await tx
      .select({ providerActionId: chatActions.providerActionId, payload: chatActions.payload })
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, endpoint.id), inArray(chatActions.providerActionId, [actionKey, runKey])))
      .for("update");
    const existing = decided.find((row) => row.providerActionId === actionKey);
    if (existing) {
      const stored = existing.payload as unknown as StoredDecision;
      return stored.decision === "published"
        ? { kind: "publish", runId: run.runId, quotedMessageId: stored.quotedMessageId, triggerIds: stored.triggerIds }
        : { kind: "suppressed", runId: run.runId, reason: stored.reason ?? "no_pending_trigger" };
    }
    if (decided.some((row) => row.providerActionId === runKey)) {
      const repeat: StoredDecision = isText
        ? { version: 1, runId: run.runId, decision: "suppressed", reason: "already_published", quotedMessageId: null, triggerIds: [] }
        : { version: 1, runId: run.runId, decision: "published", reason: null, quotedMessageId: null, triggerIds: [] };
      await tx.insert(chatActions).values({
        companyId: endpoint.companyId,
        endpointId: endpoint.id,
        conversationId: conversation.id,
        kind: OPENWA_PUBLICATION_ACTION_KIND,
        providerActionId: actionKey,
        payload: { ...repeat },
        status: "processed",
      });
      return isText
        ? { kind: "suppressed", runId: run.runId, reason: "already_published" }
        : { kind: "publish", runId: run.runId, quotedMessageId: null, triggerIds: [] };
    }
    const runClass = openwaRunTriggerClass(run.contextSnapshot);
    const deliveryIds = readOpenwaRunContext(run.contextSnapshot)?.deliveryIds ?? [];
    const pending = runClass
      ? await tx
          .select({
            id: chatDeliveries.id,
            principalId: chatDeliveries.principalId,
            principalRole: chatDeliveries.principalRole,
            normalizedEvent: chatDeliveries.normalizedEvent,
          })
          .from(chatDeliveries)
          .where(
            and(
              eq(chatDeliveries.companyId, endpoint.companyId),
              eq(chatDeliveries.endpointId, endpoint.id),
              eq(chatDeliveries.answerState, "pending"),
              eq(chatDeliveries.triggerClass, runClass),
              eq(chatDeliveries.conversationId, conversation.id),
              or(
                lte(chatDeliveries.receivedAt, run.startedAt ?? run.runCreatedAt),
                ...(deliveryIds.length ? [inArray(chatDeliveries.id, deliveryIds)] : []),
              ),
            ),
          )
          .orderBy(asc(chatDeliveries.receivedAt), asc(chatDeliveries.id))
          .for("update")
      : [];
    let reason: OpenwaSuppressionReason | null = runClass ? null : "no_openwa_context";
    if (!reason && pending.length === 0) reason = "no_pending_trigger";
    const consumable: string[] = [];
    if (!reason) {
      const settings = conversation.resourceId
        ? await tx
            .select({ settings: chatEndpointResources.settings })
            .from(chatEndpointResources)
            .where(
              and(
                eq(chatEndpointResources.companyId, endpoint.companyId),
                eq(chatEndpointResources.endpointId, endpoint.id),
                eq(chatEndpointResources.id, conversation.resourceId),
              ),
            )
            .then((rows) => openwaChatSettingsSchema.safeParse(rows[0]?.settings ?? {}))
        : null;
      const replyPolicy = (settings?.success ? settings.data.replyPolicy : undefined) ?? policy.replyPolicy;
      const event = runEvent(run.contextSnapshot);
      const needs: Array<{ principalId: string | null; category: OpenwaGrantCategory; reason: OpenwaSuppressionReason }> = [];
      for (const trigger of pending) {
        if (trigger.principalRole === "owner") continue;
        if (trigger.principalRole === "outside_allowlist")
          needs.push({ principalId: trigger.principalId, category: "reply_outside_allowlist", reason: "outside_allowlist" });
        if (runClass === "other" && replyPolicy === "ask_owner")
          needs.push({ principalId: trigger.principalId, category: "reply", reason: "reply_policy_ask_owner" });
        if (runClass === "other" && replyPolicy === "owner_absent_only" && event !== "owner_absent")
          needs.push({ principalId: trigger.principalId, category: "reply", reason: "reply_policy_owner_absent_only" });
      }
      if (needs.length > 0) {
        const principals = [...new Set(needs.map((need) => need.principalId).filter((id): id is string => id !== null))];
        const grantIds = [...runGrantIds(run.contextSnapshot)];
        const grants = principals.length && grantIds.length
          ? await tx
              .select({ id: chatOwnerGrants.id, category: chatOwnerGrants.category, scope: chatOwnerGrants.scope, requesterPrincipalId: chatOwnerGrants.requesterPrincipalId })
              .from(chatOwnerGrants)
              .where(
                and(
                  eq(chatOwnerGrants.companyId, endpoint.companyId),
                  eq(chatOwnerGrants.endpointId, endpoint.id),
                  inArray(chatOwnerGrants.id, grantIds),
                  eq(chatOwnerGrants.originChatKey, target.chatKey),
                  inArray(chatOwnerGrants.requesterPrincipalId, principals),
                  eq(chatOwnerGrants.status, "live"),
                  gt(chatOwnerGrants.expiresAt, now),
                  inArray(chatOwnerGrants.category, [...new Set(needs.map((need) => need.category))]),
                ),
              )
              .for("update")
          : [];
        for (const need of needs) {
          const grant = grants.find(
            (candidate) => candidate.category === need.category && candidate.requesterPrincipalId === need.principalId,
          );
          if (!grant) {
            reason = need.reason;
            break;
          }
          if (grant.scope === "one_action" && !consumable.includes(grant.id)) consumable.push(grant.id);
        }
      }
    }
    const triggerIds = pending.map((trigger) => trigger.id);
    const stored: StoredDecision = reason
      ? { version: 1, runId: run.runId, decision: "suppressed", reason, quotedMessageId: null, triggerIds }
      : {
          version: 1,
          runId: run.runId,
          decision: "published",
          reason: null,
          quotedMessageId: target.isGroup ? triggerWaMessageId(pending[0]!.normalizedEvent) : null,
          triggerIds,
        };
    await tx.insert(chatActions).values({
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      conversationId: conversation.id,
      kind: OPENWA_PUBLICATION_ACTION_KIND,
      providerActionId: actionKey,
      payload: { ...stored },
      status: "processed",
    });
    await upsertLastOutput(tx, {
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      conversationId: conversation.id,
      value: { runId: run.runId, suppressed: Boolean(reason), reason, decidedAt: now.toISOString() },
    });
    if (reason) {
      await recordOpenwaAudit(tx, {
        companyId: endpoint.companyId,
        endpointId: endpoint.id,
        conversationId: conversation.id,
        chatKey: target.chatKey,
        kind: "publication_suppressed",
        actorKind: "system",
        runId: run.runId,
        metadata: { reason, publicationId: publication.id, triggerIds, runClass },
        content: { text: publication.payload.text },
        retentionDays: policy.auditContentRetentionDays,
        occurredAt: now,
      });
      return { kind: "suppressed", runId: run.runId, reason };
    }
    await tx
      .insert(chatActions)
      .values({
        companyId: endpoint.companyId,
        endpointId: endpoint.id,
        conversationId: conversation.id,
        kind: OPENWA_PUBLICATION_ACTION_KIND,
        providerActionId: runKey,
        payload: { version: 1, runId: run.runId, publicationId: publication.id },
        status: "processed",
      })
      .onConflictDoNothing();
    await tx
      .update(chatDeliveries)
      .set({ answerState: "answered", updatedAt: now })
      .where(and(eq(chatDeliveries.endpointId, endpoint.id), inArray(chatDeliveries.id, triggerIds), eq(chatDeliveries.answerState, "pending")));
    if (consumable.length) {
      const consumed = await tx
        .update(chatOwnerGrants)
        .set({ status: "consumed", consumedAt: now, consumedByRunId: run.runId, updatedAt: now })
        .where(and(eq(chatOwnerGrants.endpointId, endpoint.id), inArray(chatOwnerGrants.id, consumable), eq(chatOwnerGrants.status, "live")))
        .returning({ id: chatOwnerGrants.id, category: chatOwnerGrants.category });
      for (const grant of consumed)
        await logOpenwaActivity(tx, {
          companyId: endpoint.companyId,
          endpointId: endpoint.id,
          action: "openwa.grant_consumed",
          runId: run.runId,
          details: { grantId: grant.id, category: grant.category, scope: "one_action", publicationId: publication.id },
        });
    }
    return { kind: "publish", runId: run.runId, quotedMessageId: stored.quotedMessageId, triggerIds };
  });
}

/** Reads whether the conversation's most recent run output stayed internal (wake payload lastOutputSuppressed). */
export async function readOpenwaLastOutput(
  db: DbOrTransaction,
  input: { companyId: string; endpointId: string; conversationId: string },
): Promise<OpenwaLastOutput | null> {
  const [row] = await db
    .select({ payload: chatActions.payload })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.companyId, input.companyId),
        eq(chatActions.endpointId, input.endpointId),
        eq(chatActions.providerActionId, lastOutputActionId(input.conversationId)),
      ),
    );
  if (!row) return null;
  const payload = row.payload;
  return {
    runId: String(payload.runId),
    suppressed: payload.suppressed === true,
    reason: (payload.reason as OpenwaSuppressionReason | null) ?? null,
    decidedAt: String(payload.decidedAt),
  };
}

/** Spec 7.4: a quoted trigger becomes answered; without a quote every pending run-class trigger visible to the run does. */
export async function markTriggersAnswered(
  db: DbOrTransaction,
  input: {
    companyId: string;
    endpointId: string;
    conversationId: string;
    chatKey: string;
    quotedMessageId: string | null;
    runClass: OpenwaTriggerClass;
    visibleBefore: Date;
    deliveryIds: readonly string[];
  },
): Promise<string[]> {
  const chatKey = openwaChatKey(input.chatKey);
  const scope = and(
    eq(chatDeliveries.companyId, input.companyId),
    eq(chatDeliveries.endpointId, input.endpointId),
    eq(chatDeliveries.conversationId, input.conversationId),
    eq(chatDeliveries.answerState, "pending"),
    sql`${chatDeliveries.normalizedEvent}->'openwa'->>'chatKey' = ${chatKey}`,
  );
  const rows = await db
    .update(chatDeliveries)
    .set({ answerState: "answered", updatedAt: new Date() })
    .where(
      input.quotedMessageId
        ? and(scope, sql`${chatDeliveries.normalizedEvent}->'openwa'->>'waMessageId' = ${input.quotedMessageId}`)
        : and(
            scope,
            eq(chatDeliveries.triggerClass, input.runClass),
            or(
              lte(chatDeliveries.receivedAt, input.visibleBefore),
              ...(input.deliveryIds.length ? [inArray(chatDeliveries.id, [...input.deliveryIds])] : []),
            ),
          ),
    )
    .returning({ id: chatDeliveries.id });
  return rows.map((row) => row.id);
}

export interface OpenwaPublicationFile {
  data: Buffer | Blob | ArrayBuffer;
  filename: string;
  mimeType?: string;
}

async function base64(data: OpenwaPublicationFile["data"]): Promise<string> {
  if (Buffer.isBuffer(data)) return data.toString("base64");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("base64");
  return Buffer.from(await data.arrayBuffer()).toString("base64");
}

export async function sendOpenwaPublication(input: {
  db: Db;
  registry: OpenwaOutboundRegistry;
  gateway: OpenwaGatewayClient;
  state: OpenwaState;
  endpoint: EndpointRow;
  conversation: ConversationRow;
  publication: PublicationRow;
  runId: string | null;
  text: string;
  files: readonly OpenwaPublicationFile[];
  quotedMessageId: string | null;
  assertCurrent?: () => Promise<void>;
}): Promise<{ id: string; messageIds: string[] }> {
  const policy = openwaEndpointPolicySchema.parse(input.endpoint.policy);
  const target = openwaChatTarget(input.conversation);
  const sends: Array<{ key: string; body: string; send: (quote: string | undefined) => Promise<OpenwaSendResult> }> = [];
  for (const [index, file] of input.files.entries()) {
    const encoded = await base64(file.data);
    sends.push({
      key: "file:" + index,
      body: "",
      send: (quote) =>
        input.gateway.sendMedia({
          kind: "document",
          chatId: target.chatId,
          base64: encoded,
          filename: file.filename,
          mimetype: file.mimeType ?? "application/octet-stream",
          ...(quote ? { quotedMessageId: quote } : {}),
        }),
    });
  }
  const safe = input.files.length ? null : projectSafeChatPublicationTextOrNull(input.text);
  let sentText: string | null = null;
  if (safe !== null) {
    const prefix = policy.numberMode === "owner_number" && policy.ownerNumberPrefix.enabled ? policy.ownerNumberPrefix.text : null;
    const formatted = formatOpenwaPublication({ markdown: safe, prefix });
    if (formatted.kind === "text") {
      sentText = formatted.parts.join("\n\n");
      for (const [index, part] of formatted.parts.entries())
        sends.push({
          key: "part:" + index,
          body: part,
          send: (quote) => input.gateway.sendText({ chatId: target.chatId, text: part, ...(quote ? { quotedMessageId: quote } : {}) }),
        });
    } else {
      sentText = formatted.caption;
      const encoded = Buffer.from(formatted.document.content, "utf8").toString("base64");
      sends.push({
        key: "document",
        body: formatted.caption,
        send: (quote) =>
          input.gateway.sendMedia({
            kind: "document",
            chatId: target.chatId,
            base64: encoded,
            filename: formatted.document.filename,
            mimetype: formatted.document.mimetype,
            caption: formatted.caption,
            ...(quote ? { quotedMessageId: quote } : {}),
          }),
      });
    }
  }
  if (sends.length === 0) throw Object.assign(new Error("OpenWA publication has no content"), { code: "CHAT_PROVIDER_PRETRANSPORT_REJECTED" });
  const messageIds: string[] = [];
  for (const [index, item] of sends.entries()) {
    const stateKey = "publication:" + input.publication.id + ":" + item.key;
    const previous = await input.state.read<{ messageId: string }>(stateKey);
    if (previous?.messageId) {
      messageIds.push(previous.messageId);
      continue;
    }
    await input.assertCurrent?.();
    const quote = index === 0 && input.quotedMessageId ? input.quotedMessageId : undefined;
    const { result } = await sendThroughRegistry({
      registry: input.registry,
      companyId: input.endpoint.companyId,
      endpointId: input.endpoint.id,
      chatId: target.chatId,
      source: "publication",
      body: item.body,
      runId: input.runId,
      send: () => item.send(quote),
    });
    await input.state.update<{ messageId: string }>(stateKey, (current) => current ?? { messageId: result.messageId });
    messageIds.push(result.messageId);
  }
  const now = new Date();
  await recordOpenwaAudit(input.db, {
    companyId: input.endpoint.companyId,
    endpointId: input.endpoint.id,
    conversationId: input.conversation.id,
    chatKey: target.chatKey,
    kind: "message_sent",
    actorKind: "agent",
    runId: input.runId,
    metadata: {
      source: "publication",
      publicationId: input.publication.id,
      messageIds,
      quotedMessageId: input.quotedMessageId,
      attachments: input.files.map((file) => file.filename),
    },
    content: sentText === null ? null : { text: sentText },
    retentionDays: policy.auditContentRetentionDays,
    occurredAt: now,
  });
  return { id: messageIds[0]!, messageIds };
}

export async function openwaTypingAllowed(
  db: DbOrTransaction,
  input: { companyId: string; endpointId: string; agentId: string; threadId: string; requireActiveRun: boolean },
): Promise<boolean> {
  if (!input.requireActiveRun) {
    const [endpoint] = await db
      .select({ policy: chatEndpoints.policy })
      .from(chatEndpoints)
      .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId)));
    return Boolean(endpoint) && openwaEndpointPolicySchema.parse(endpoint!.policy).typingIndicator;
  }
  const [row] = await db
    .select({ policy: chatEndpoints.policy, runId: heartbeatRuns.id })
    .from(chatEndpoints)
    .innerJoin(
      chatConversations,
      and(
        eq(chatConversations.companyId, chatEndpoints.companyId),
        eq(chatConversations.endpointId, chatEndpoints.id),
        eq(chatConversations.externalThreadId, input.threadId),
        inArray(chatConversations.state, ["active", "waiting"]),
      ),
    )
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.companyId, chatConversations.companyId),
        eq(heartbeatRuns.agentId, input.agentId),
        eq(sql<string>`${heartbeatRuns.contextSnapshot}->>'issueId'`, sql<string>`${chatConversations.issueId}::text`),
        inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`(${heartbeatRuns.contextSnapshot} -> 'openwa' ->> 'triggerClass' is not null or ${heartbeatRuns.contextSnapshot} -> 'paperclipOpenwa' ->> 'triggerClass' is not null)`,
      ),
    )
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId)))
    .limit(1);
  return Boolean(row) && openwaEndpointPolicySchema.parse(row!.policy).typingIndicator;
}
