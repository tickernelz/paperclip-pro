import { and, desc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import {
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpointOwners,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatOutboundMessages,
  chatOwnerApprovalBubbles,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  companyMemberships,
  heartbeatRuns,
  issueThreadInteractions,
  issues,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  OPENWA_GRANT_CATEGORIES,
  openwaEndpointPolicySchema,
  type ChatOwnerApprovalChannel,
  type ChatOwnerApprovalStatus,
  type ChatOwnerGrantScope,
  type OpenwaGrantCategory,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import { HttpError, badRequest, forbidden, notFound } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { createDurableChatWakeupRequest } from "../durable-chat-wakeup.js";
import type { IssueAssignmentWakeupDeps } from "../issue-assignment-wakeup.js";
import { issueService } from "../issues.js";
import { openwaThreadId } from "./adapter.js";
import { logOpenwaActivity, recordOpenwaAudit } from "./audit.js";
import { formatOpenwaPublication } from "./format.js";
import { OpenwaGatewayError } from "./gateway.js";
import { maskOpenwaDigits } from "./guidance.js";
import { openwaChatKey, type OpenwaOutboundRecord, type OpenwaOutboundRegistry } from "./outbound.js";
import { openwaCurrentOwnerUserId } from "./owners.js";
import { openwaDigits } from "./policy.js";
import { createOpenwaWrite, finishOpenwaWrite, openwaToolArgsHash, openwaWriteHashMatches, openwaWriteReplay, type OpenwaWriteScope } from "./tool-writes.js";
import { OpenwaToolError, type ToolContext } from "./tools.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTransaction = Db | DbTransaction;
type EndpointRow = typeof chatEndpoints.$inferSelect;
type RequestRow = typeof chatOwnerApprovalRequests.$inferSelect;
type Args = Record<string, unknown>;

export const OPENWA_APPROVAL_WAKE_ACTION_KIND = "openwa_approval_wakeup";
export const OPENWA_APPROVAL_WAKE_ACTOR_ID = "openwa:approval";
export const OPENWA_REMINDERS_UNAVAILABLE_CODE = "openwa_reminders_unavailable";
const WAKE_MAX_ATTEMPTS = 5;
const WAKE_STALE_PROCESSING_MS = 2 * 60_000;
const LIST_LIMIT = 100;

export type OpenwaApprovalDecision = "approve" | "reject";
export type OpenwaApprovalRequestStatus = "pending" | "resolved";

export interface OpenwaApprovalBubbleMatch {
  readonly requestId: string;
  readonly outboundMessageId: string;
  readonly chatKey: string;
  readonly requestStatus: OpenwaApprovalRequestStatus;
}

export interface OpenwaApprovalReminderHooks {
  schedule(db: DbOrTransaction, input: { companyId: string; endpointId: string; requestId: string; chatKey: string; createdAt: Date }): Promise<void>;
  cancel(db: DbOrTransaction, input: { companyId: string; endpointId: string; requestId: string }): Promise<void>;
}

export interface OpenwaApprovalWakeRuntime {
  wakeup: IssueAssignmentWakeupDeps["wakeup"];
}

export class OpenwaRemindersUnavailableError extends HttpError {
  readonly code = OPENWA_REMINDERS_UNAVAILABLE_CODE;
  constructor() {
    super(503, "Approval reminders are not available in this process", { code: OPENWA_REMINDERS_UNAVAILABLE_CODE });
  }
}

export class OpenwaApprovalAlreadyResolvedError extends HttpError {
  readonly requestStatus: ChatOwnerApprovalStatus | null;

  constructor(requestStatus: ChatOwnerApprovalStatus | null = null) {
    super(409, "This approval request has already been resolved", { code: "already_resolved", requestStatus });
    this.requestStatus = requestStatus;
  }
}

const UNAVAILABLE_REMINDERS: OpenwaApprovalReminderHooks = {
  async schedule() {
    throw new OpenwaRemindersUnavailableError();
  },
  async cancel() {
    throw new OpenwaRemindersUnavailableError();
  },
};

const reminderHooks = new WeakMap<Db, OpenwaApprovalReminderHooks>();
const wakeRuntimes = new WeakMap<Db, OpenwaApprovalWakeRuntime>();

/** Installs the reminder scheduler; until one is installed every approval mutation fails closed. */
export function registerOpenwaApprovalReminders(db: Db, hooks: OpenwaApprovalReminderHooks): () => void {
  reminderHooks.set(db, hooks);
  return () => {
    if (reminderHooks.get(db) === hooks) reminderHooks.delete(db);
  };
}

export function registerOpenwaApprovalWakeRuntime(db: Db, runtime: OpenwaApprovalWakeRuntime): () => void {
  wakeRuntimes.set(db, runtime);
  return () => {
    if (wakeRuntimes.get(db) === runtime) wakeRuntimes.delete(db);
  };
}

function reminders(db: Db): OpenwaApprovalReminderHooks {
  return reminderHooks.get(db) ?? UNAVAILABLE_REMINDERS;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sessionOf(endpoint: Pick<EndpointRow, "providerAccountId">): string {
  const account = endpoint.providerAccountId ?? "";
  return account.slice(account.lastIndexOf("#") + 1);
}

function maskedChat(chatKey: string): string {
  return chatKey.endsWith("@g.us") ? chatKey : maskOpenwaDigits(chatKey);
}

export interface OpenwaCurrentOwner {
  ownerId: string;
  principalId: string;
  userId: string;
  digits: string | null;
}

/** Current owners: linked identity and active, non-viewer company membership. */
export async function openwaCurrentOwners(
  database: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "id">,
): Promise<OpenwaCurrentOwner[]> {
  const rows = await database
    .select({
      ownerId: chatEndpointOwners.id,
      principalId: chatIdentityLinks.principalId,
      userId: chatIdentityLinks.paperclipUserId,
      externalId: chatExternalPrincipals.externalId,
    })
    .from(chatEndpointOwners)
    .innerJoin(
      chatIdentityLinks,
      and(eq(chatIdentityLinks.companyId, chatEndpointOwners.companyId), eq(chatIdentityLinks.id, chatEndpointOwners.identityLinkId)),
    )
    .innerJoin(
      chatExternalPrincipals,
      and(eq(chatExternalPrincipals.companyId, chatIdentityLinks.companyId), eq(chatExternalPrincipals.id, chatIdentityLinks.principalId)),
    )
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.companyId, chatIdentityLinks.companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, chatIdentityLinks.paperclipUserId),
      ),
    )
    .where(
      and(
        eq(chatEndpointOwners.companyId, endpoint.companyId),
        eq(chatEndpointOwners.endpointId, endpoint.id),
        eq(chatIdentityLinks.endpointId, endpoint.id),
        eq(chatIdentityLinks.status, "linked"),
        eq(companyMemberships.status, "active"),
        sql`coalesce(${companyMemberships.membershipRole}, '') <> 'viewer'`,
      ),
    );
  return rows
    .filter((row): row is typeof row & { userId: string } => typeof row.userId === "string" && row.userId.length > 0)
    .map((row) => ({ ownerId: row.ownerId, principalId: row.principalId, userId: row.userId, digits: openwaDigits(row.externalId) }));
}

export async function openwaApprovalOwnerUserIds(db: Db, input: { companyId: string; requestId: string }): Promise<string[]> {
  const [request] = await db
    .select({ endpointId: chatOwnerApprovalRequests.endpointId })
    .from(chatOwnerApprovalRequests)
    .where(and(eq(chatOwnerApprovalRequests.companyId, input.companyId), eq(chatOwnerApprovalRequests.id, input.requestId)))
    .limit(1);
  if (!request) return [];
  return [...new Set((await openwaCurrentOwners(db, { companyId: input.companyId, id: request.endpointId })).map((owner) => owner.userId))];
}

export function openwaApprovalRequestIdOf(interaction: { kind: string; payload?: unknown }): string | null {
  if (interaction.kind !== "request_confirmation") return null;
  return str(record(interaction.payload).openwaApprovalRequestId);
}

export async function findOpenwaApprovalBubble(
  db: DbOrTransaction,
  outbound: Pick<OpenwaOutboundRecord, "id" | "companyId" | "endpointId" | "chatKey" | "source">,
): Promise<OpenwaApprovalBubbleMatch | null> {
  if (outbound.source !== "approval") return null;
  const [row] = await db
    .select({ requestId: chatOwnerApprovalBubbles.requestId, status: chatOwnerApprovalRequests.status })
    .from(chatOwnerApprovalBubbles)
    .innerJoin(
      chatOwnerApprovalRequests,
      and(
        eq(chatOwnerApprovalRequests.companyId, chatOwnerApprovalBubbles.companyId),
        eq(chatOwnerApprovalRequests.id, chatOwnerApprovalBubbles.requestId),
      ),
    )
    .where(
      and(
        eq(chatOwnerApprovalBubbles.companyId, outbound.companyId),
        eq(chatOwnerApprovalBubbles.endpointId, outbound.endpointId),
        eq(chatOwnerApprovalBubbles.outboundMessageId, outbound.id),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { requestId: row.requestId, outboundMessageId: outbound.id, chatKey: outbound.chatKey, requestStatus: row.status === "pending" ? "pending" : "resolved" };
}

async function serverWakeRecord(ctx: ToolContext) {
  const [run] = await ctx.db
    .select({ wakeupRequestId: heartbeatRuns.wakeupRequestId })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, ctx.run.id), eq(heartbeatRuns.companyId, ctx.endpoint.companyId)))
    .limit(1);
  if (!run?.wakeupRequestId) return null;
  const [action] = await ctx.db
    .select()
    .from(chatActions)
    .where(
      and(
        eq(chatActions.id, run.wakeupRequestId),
        eq(chatActions.companyId, ctx.endpoint.companyId),
        eq(chatActions.endpointId, ctx.endpoint.id),
        eq(chatActions.conversationId, ctx.conversation.id),
      ),
    )
    .limit(1);
  return action ?? null;
}

async function requesterOf(ctx: ToolContext): Promise<string | null> {
  if (ctx.openwa?.requesterPrincipalId) return ctx.openwa.requesterPrincipalId;
  const action = await serverWakeRecord(ctx);
  const deliveryIds = Array.isArray(record(record(action?.payload).openwa).deliveryIds)
    ? (record(record(action?.payload).openwa).deliveryIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  if (!deliveryIds.length) return null;
  const rows = await ctx.db
    .select({ principalId: chatDeliveries.principalId })
    .from(chatDeliveries)
    .where(
      and(
        eq(chatDeliveries.companyId, ctx.endpoint.companyId),
        eq(chatDeliveries.endpointId, ctx.endpoint.id),
        eq(chatDeliveries.conversationId, ctx.conversation.id),
        inArray(chatDeliveries.id, deliveryIds.slice(0, 50)),
      ),
    );
  const principals = new Set(rows.map((row) => row.principalId));
  return principals.size === 1 ? ([...principals][0] ?? null) : null;
}

interface PlannedBubble {
  owner: OpenwaCurrentOwner;
  chatId: string;
  chatKey: string;
}

function plannedBubbles(owners: OpenwaCurrentOwner[]): PlannedBubble[] {
  const byChat = new Map<string, PlannedBubble>();
  for (const owner of owners) {
    if (!owner.digits) continue;
    const chatId = owner.digits + "@c.us";
    if (!byChat.has(chatId)) byChat.set(chatId, { owner, chatId, chatKey: openwaChatKey(chatId) });
  }
  return [...byChat.values()];
}

function bubbleText(ctx: ToolContext, markdown: string): string {
  const prefix = ctx.policy.numberMode === "owner_number" && ctx.policy.ownerNumberPrefix.enabled ? ctx.policy.ownerNumberPrefix.text : null;
  const formatted = formatOpenwaPublication({ markdown, prefix });
  if (formatted.kind !== "text" || formatted.parts.length !== 1)
    throw new OpenwaToolError(422, "message_too_long", "messageToOwners must fit in one WhatsApp message");
  return formatted.parts[0]!;
}

async function sendReserved(
  registry: OpenwaOutboundRegistry,
  reserved: OpenwaOutboundRecord,
  send: () => Promise<{ messageId: string }>,
): Promise<{ messageId: string | null; state: "sent" | "uncertain" | "failed" }> {
  try {
    const result = await send();
    if (!result || typeof result.messageId !== "string" || !result.messageId) {
      await registry.settle({ record: reserved, providerMessageId: null, state: "uncertain" });
      return { messageId: null, state: "uncertain" };
    }
    await registry.settle({ record: reserved, providerMessageId: result.messageId, state: "sent" });
    return { messageId: result.messageId, state: "sent" };
  } catch (error) {
    const definite = error instanceof OpenwaGatewayError && error.code !== "uncertain";
    await registry.settle({ record: reserved, providerMessageId: null, state: definite ? "failed" : "uncertain" });
    return { messageId: null, state: definite ? "failed" : "uncertain" };
  }
}

async function reserveBubbles(
  tx: DbTransaction,
  ctx: ToolContext,
  registry: OpenwaOutboundRegistry,
  requestId: string,
  planned: PlannedBubble[],
  body: string,
  reserved: OpenwaOutboundRecord[],
) {
  for (const bubble of planned) {
    const outbound = await registry.reserve({
      database: tx,
      companyId: ctx.endpoint.companyId,
      endpointId: ctx.endpoint.id,
      chatKey: bubble.chatKey,
      source: "approval",
      body,
      runId: ctx.run.id,
    });
    reserved.push(outbound);
    await tx.insert(chatOwnerApprovalBubbles).values({
      companyId: ctx.endpoint.companyId,
      endpointId: ctx.endpoint.id,
      requestId,
      ownerId: bubble.owner.ownerId,
      outboundMessageId: outbound.id,
    });
  }
}

async function deliverBubbles(ctx: ToolContext, planned: PlannedBubble[], reserved: OpenwaOutboundRecord[], body: string) {
  const { gateway, registry } = await ctx.runtime();
  const results: Array<{ chatRef: string; messageId: string | null; state: string }> = [];
  for (let index = 0; index < reserved.length; index++) {
    const bubble = planned[index]!;
    const outcome = await sendReserved(registry, reserved[index]!, () => gateway.sendText({ chatId: bubble.chatId, text: body }));
    results.push({ chatRef: "openwa:" + ctx.sessionId + ":" + bubble.chatKey, messageId: outcome.messageId, state: outcome.state });
  }
  return results;
}

async function forgetReserved(registry: OpenwaOutboundRegistry, reserved: OpenwaOutboundRecord[]) {
  for (const outbound of reserved) await registry.settle({ record: outbound, providerMessageId: null, state: "failed" }).catch(() => undefined);
}

async function bubbleStates(ctx: ToolContext, requestId: string) {
  const rows = await ctx.db
    .select({ chatKey: chatOutboundMessages.chatKey, messageId: chatOutboundMessages.providerMessageId, state: chatOutboundMessages.state, runId: chatOutboundMessages.runId })
    .from(chatOwnerApprovalBubbles)
    .innerJoin(
      chatOutboundMessages,
      and(eq(chatOutboundMessages.companyId, chatOwnerApprovalBubbles.companyId), eq(chatOutboundMessages.id, chatOwnerApprovalBubbles.outboundMessageId)),
    )
    .where(and(eq(chatOwnerApprovalBubbles.companyId, ctx.endpoint.companyId), eq(chatOwnerApprovalBubbles.requestId, requestId)));
  return rows
    .filter((row) => row.runId === ctx.run.id)
    .map((row) => ({ chatRef: "openwa:" + ctx.sessionId + ":" + row.chatKey, messageId: row.messageId, state: row.state }));
}

function approvalPrompt(summary: string): string {
  return ("Approve: " + summary).slice(0, 1000);
}

function approvalDetails(input: { categories: string[]; scope: ChatOwnerGrantScope; proposedAction: string; originChatKey: string }): string {
  return [
    "**Proposed action:** " + input.proposedAction,
    "**Categories:** " + input.categories.join(", "),
    "**Scope:** " + (input.scope === "one_action" ? "one action in the approved run" : "this requester in this chat until the grant expires"),
    "**Origin chat:** " + maskedChat(input.originChatKey),
  ].join("\n");
}

export async function openwaRequestApprovalTool(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  if (!ctx.runClass) throw forbidden("Only runs on the WhatsApp conversation issue can request owner approval");
  if (ctx.runClass === "owner") throw new OpenwaToolError(422, "approval_not_needed", "Owner-triggered runs already have owner authority");
  const remindRequestId = str(args.remindRequestId);
  const scope: OpenwaWriteScope = {
    companyId: ctx.endpoint.companyId,
    endpointId: ctx.endpoint.id,
    conversationId: ctx.conversation.id,
    issueId: ctx.binding.issueId,
    runId: ctx.binding.runId,
    tool: "openwa_request_approval",
    idempotencyKey: String(args.idempotencyKey),
  };
  const hash = openwaToolArgsHash("openwa_request_approval", args);
  const action = await createOpenwaWrite(ctx.db, scope, hash, { chatKey: ctx.origin.chatKey });
  ctx.audit.actionId = action.id;
  if (!openwaWriteHashMatches(action, hash))
    throw new OpenwaToolError(409, "idempotency_conflict", "This idempotencyKey already belongs to a different OpenWA operation", { actionId: action.id });
  const replay = openwaWriteReplay(action);
  if (replay) return replay;
  const priorRequestId = str(record(action.result).requestId);
  if (priorRequestId) {
    const { gateway, registry } = await ctx.runtime();
    await registry.reconcileUncertain(ctx.endpoint.companyId, ctx.endpoint.id, gateway).catch(() => 0);
    return { requestId: priorRequestId, actionId: action.id, state: "uncertain", bubbles: await bubbleStates(ctx, priorRequestId) };
  }
  const owners = await openwaCurrentOwners(ctx.db, ctx.endpoint);
  const planned = plannedBubbles(owners);
  if (!planned.length) throw new OpenwaToolError(409, "no_owner_chat", "No current owner has a WhatsApp number to receive the request");
  const body = bubbleText(ctx, String(args.messageToOwners));
  const { registry } = await ctx.runtime();
  const reserved: OpenwaOutboundRecord[] = [];
  const db = ctx.db;
  let requestId: string;
  let reminded = false;
  try {
    requestId = await db.transaction(async (tx) => {
      if (remindRequestId) {
        const [request] = await tx
          .select()
          .from(chatOwnerApprovalRequests)
          .where(and(eq(chatOwnerApprovalRequests.companyId, ctx.endpoint.companyId), eq(chatOwnerApprovalRequests.endpointId, ctx.endpoint.id), eq(chatOwnerApprovalRequests.id, remindRequestId)))
          .for("update");
        if (!request || request.originChatKey !== ctx.origin.chatKey) throw new OpenwaToolError(404, "not_found", "No approval request from this chat has that id");
        if (request.status !== "pending") throw new OpenwaApprovalAlreadyResolvedError(request.status);
        await reserveBubbles(tx, ctx, registry, request.id, planned, body, reserved);
        await recordOpenwaAudit(tx, {
          companyId: ctx.endpoint.companyId,
          endpointId: ctx.endpoint.id,
          kind: "approval_reminded",
          actorKind: "agent",
          actorRef: ctx.binding.agentId,
          chatKey: request.originChatKey,
          conversationId: ctx.conversation.id,
          runId: ctx.run.id,
          metadata: { requestId: request.id, owners: planned.length, source: "agent" },
          content: { messageToOwners: body },
          retentionDays: ctx.policy.auditContentRetentionDays,
        });
        await tx.update(chatActions).set({ result: { ...record(action.result), requestId: request.id }, updatedAt: new Date() }).where(eq(chatActions.id, action.id));
        reminded = true;
        return request.id;
      }
      const categories = [...new Set(args.categories as OpenwaGrantCategory[])].filter((category) => OPENWA_GRANT_CATEGORIES.includes(category));
      const grantScope = (args.scope as ChatOwnerGrantScope | undefined) ?? "one_action";
      const requesterPrincipalId = await requesterOf(ctx);
      if (grantScope === "requester" && !requesterPrincipalId)
        throw new OpenwaToolError(422, "requester_unknown", "A requester-scoped approval needs a single identifiable requester for this run");
      const summary = String(args.summary);
      const proposedAction = String(args.proposedAction);
      const [request] = await tx
        .insert(chatOwnerApprovalRequests)
        .values({
          companyId: ctx.endpoint.companyId,
          endpointId: ctx.endpoint.id,
          originChatKey: ctx.origin.chatKey,
          originConversationId: ctx.conversation.id,
          requestedByPrincipalId: requesterPrincipalId,
          requestedInRunId: ctx.run.id,
          categories,
          scope: grantScope,
          summary,
          proposedAction,
        })
        .returning();
      const [interaction] = await tx
        .insert(issueThreadInteractions)
        .values({
          companyId: ctx.endpoint.companyId,
          issueId: ctx.conversation.issueId,
          kind: "request_confirmation",
          status: "pending",
          continuationPolicy: "none",
          requestedResolverPolicy: "chat_endpoint_owner",
          effectiveResolverPolicy: "chat_endpoint_owner",
          resolverPolicyProvenance: "explicit",
          effectiveResolverPolicySource: "requested",
          sourceRunId: ctx.run.id,
          title: "Owner approval: " + categories.join(", "),
          summary: summary.slice(0, 500),
          createdByAgentId: ctx.binding.agentId,
          payload: {
            version: 1,
            prompt: approvalPrompt(summary),
            acceptLabel: "Approve",
            rejectLabel: "Reject",
            allowDeclineReason: true,
            detailsMarkdown: approvalDetails({ categories, scope: grantScope, proposedAction, originChatKey: request!.originChatKey }),
            openwaApprovalRequestId: request!.id,
          },
        })
        .returning({ id: issueThreadInteractions.id });
      await tx
        .update(chatOwnerApprovalRequests)
        .set({ interactionId: interaction!.id })
        .where(eq(chatOwnerApprovalRequests.id, request!.id));
      await reserveBubbles(tx, ctx, registry, request!.id, planned, body, reserved);
      await reminders(db).schedule(tx, {
        companyId: ctx.endpoint.companyId,
        endpointId: ctx.endpoint.id,
        requestId: request!.id,
        chatKey: request!.originChatKey,
        createdAt: request!.createdAt,
      });
      await recordOpenwaAudit(tx, {
        companyId: ctx.endpoint.companyId,
        endpointId: ctx.endpoint.id,
        kind: "approval_requested",
        actorKind: "agent",
        actorRef: ctx.binding.agentId,
        chatKey: request!.originChatKey,
        conversationId: ctx.conversation.id,
        runId: ctx.run.id,
        metadata: { requestId: request!.id, categories, scope: grantScope, owners: planned.length, interactionId: interaction!.id },
        content: { summary, proposedAction, messageToOwners: body },
        retentionDays: ctx.policy.auditContentRetentionDays,
      });
      await logOpenwaActivity(tx, {
        companyId: ctx.endpoint.companyId,
        endpointId: ctx.endpoint.id,
        action: "openwa.approval_requested",
        agentId: ctx.binding.agentId,
        runId: ctx.run.id,
        details: { requestId: request!.id, categories, scope: grantScope },
      });
      await tx.update(chatActions).set({ result: { ...record(action.result), requestId: request!.id }, updatedAt: new Date() }).where(eq(chatActions.id, action.id));
      return request!.id;
    });
  } catch (error) {
    await forgetReserved(registry, reserved);
    throw error;
  }
  const bubbles = await deliverBubbles(ctx, planned, reserved, body);
  const receipt = { requestId, status: "pending", reminded, bubbles };
  if (bubbles.every((bubble) => bubble.state !== "uncertain")) await finishOpenwaWrite(ctx.db, action, receipt);
  if (bubbles.every((bubble) => bubble.state === "failed"))
    throw new OpenwaToolError(502, "gateway_error", "No approval bubble could be delivered; the request stays pending in Paperclip", { requestId });
  return { actionId: action.id, ...receipt };
}

export async function openwaApprovalResolveTool(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  const requestId = String(args.requestId);
  const deny = () =>
    new OpenwaToolError(403, "approval_not_authorized", "Only the run started by an owner's reply to this request's bubble can resolve it", { requestId });
  if (!ctx.runClass || ctx.openwa?.triggerClass !== "owner") throw deny();
  const action = await serverWakeRecord(ctx);
  const openwa = record(record(action?.payload).openwa);
  if (!action?.deliveryId || openwa.event !== "approval_reply" || openwa.triggerClass !== "owner" || openwa.approvalRequestId !== requestId) throw deny();
  const [delivery] = await ctx.db
    .select({ principalId: chatDeliveries.principalId, normalizedEvent: chatDeliveries.normalizedEvent, triggerClass: chatDeliveries.triggerClass })
    .from(chatDeliveries)
    .where(and(eq(chatDeliveries.companyId, ctx.endpoint.companyId), eq(chatDeliveries.endpointId, ctx.endpoint.id), eq(chatDeliveries.id, action.deliveryId)))
    .limit(1);
  if (!delivery?.principalId || delivery.triggerClass !== "owner") throw deny();
  const decision = String(args.decision);
  const conditions = str(args.conditions);
  if (decision === "clarify") {
    const [request] = await ctx.db
      .select({ status: chatOwnerApprovalRequests.status })
      .from(chatOwnerApprovalRequests)
      .where(and(eq(chatOwnerApprovalRequests.companyId, ctx.endpoint.companyId), eq(chatOwnerApprovalRequests.endpointId, ctx.endpoint.id), eq(chatOwnerApprovalRequests.id, requestId)))
      .limit(1);
    if (!request) throw new OpenwaToolError(404, "not_found", "Approval request not found");
    if (request.status !== "pending") throw new OpenwaToolError(409, "already_resolved", "This approval request has already been resolved", { requestStatus: request.status });
    return { requestId, status: "pending", decision: "clarify" };
  }
  const ownerText = str(record(record(delivery.normalizedEvent).message).text);
  try {
    const resolved = await resolveOpenwaApproval(ctx.db, {
      companyId: ctx.endpoint.companyId,
      endpointId: ctx.endpoint.id,
      requestId,
      decision: decision as OpenwaApprovalDecision,
      via: "whatsapp",
      owner: { principalId: delivery.principalId },
      ownerText,
      conditions,
      runId: ctx.run.id,
      agentId: ctx.binding.agentId,
    });
    return { requestId, status: resolved.status, grantIds: resolved.grantIds };
  } catch (error) {
    if (error instanceof OpenwaApprovalAlreadyResolvedError)
      throw new OpenwaToolError(409, "already_resolved", "This approval request has already been resolved", { requestStatus: error.requestStatus });
    if (error instanceof HttpError && error.status === 403) throw deny();
    throw error;
  }
}

async function currentConversation(tx: DbOrTransaction, endpoint: EndpointRow, request: RequestRow) {
  const isGroup = request.originChatKey.endsWith("@g.us");
  let threadId: string | null = null;
  try {
    threadId = openwaThreadId({ sessionId: sessionOf(endpoint), chatId: request.originChatKey, isGroup });
  } catch {
    threadId = null;
  }
  const [current] = threadId
    ? await tx
        .select()
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.companyId, endpoint.companyId),
            eq(chatConversations.endpointId, endpoint.id),
            eq(chatConversations.externalConversationId, threadId),
            inArray(chatConversations.state, ["active", "waiting"]),
          ),
        )
        .orderBy(desc(chatConversations.createdAt))
        .limit(1)
    : [];
  if (current) return current;
  if (!request.originConversationId) return null;
  const [origin] = await tx
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.companyId, endpoint.companyId), eq(chatConversations.id, request.originConversationId)))
    .limit(1);
  return origin ?? null;
}

function resolvedCommentBody(request: RequestRow, approved: boolean, via: ChatOwnerApprovalChannel, conditions: string | null): string {
  return [
    (approved ? "An endpoint owner approved" : "An endpoint owner rejected") + " the approval request via " + (via === "whatsapp" ? "WhatsApp" : "Paperclip") + ": " + request.summary,
    ...(conditions ? ["Conditions: " + conditions] : []),
  ].join("\n\n");
}

export interface OpenwaApprovalResolution {
  status: "approved" | "rejected";
  grantIds: string[];
  wakeActionId: string | null;
  interactionId: string | null;
}

/** First-writer-wins resolution shared by WhatsApp and Paperclip; throws already_resolved for the loser. */
export async function resolveOpenwaApproval(
  db: Db,
  input: {
    companyId: string;
    endpointId: string;
    requestId: string;
    decision: OpenwaApprovalDecision;
    via: ChatOwnerApprovalChannel;
    owner: { principalId: string } | { userId: string };
    ownerText: string | null;
    conditions?: string | null;
    runId?: string | null;
    agentId?: string | null;
  },
): Promise<OpenwaApprovalResolution> {
  const [endpoint] = await db
    .select()
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId), eq(chatEndpoints.provider, "openwa")))
    .limit(1);
  if (!endpoint) throw notFound("Chat endpoint not found");
  const approved = input.decision === "approve";
  const conditions = input.conditions ?? null;
  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(chatOwnerApprovalRequests)
      .where(and(eq(chatOwnerApprovalRequests.companyId, input.companyId), eq(chatOwnerApprovalRequests.endpointId, input.endpointId), eq(chatOwnerApprovalRequests.id, input.requestId)))
      .for("update");
    if (!request) throw notFound("Approval request not found");
    if (request.status !== "pending") throw new OpenwaApprovalAlreadyResolvedError(request.status);
    let ownerUserId: string | null;
    if ("principalId" in input.owner) {
      ownerUserId = (await openwaCurrentOwnerUserId(tx, endpoint, input.owner.principalId, true)).userId;
    } else {
      const userId = input.owner.userId;
      ownerUserId = (await openwaCurrentOwners(tx, endpoint)).some((owner) => owner.userId === userId) ? userId : null;
    }
    if (!ownerUserId) throw forbidden("Only a current owner of the chat endpoint can resolve this approval");
    const now = new Date();
    await tx
      .update(chatOwnerApprovalRequests)
      .set({
        status: approved ? "approved" : "rejected",
        resolvedVia: input.via,
        resolvedByUserId: ownerUserId,
        ownerText: input.ownerText,
        agentConditions: conditions,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(chatOwnerApprovalRequests.id, request.id));
    const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
    const expiresAt = new Date(now.getTime() + policy.approvals.grantTtlHours * 3_600_000);
    const grants = approved
      ? await tx
          .insert(chatOwnerGrants)
          .values(
            request.categories.map((category) => ({
              companyId: input.companyId,
              endpointId: input.endpointId,
              requestId: request.id,
              originChatKey: request.originChatKey,
              requesterPrincipalId: request.requestedByPrincipalId,
              category,
              scope: request.scope,
              approvedByUserId: ownerUserId,
              approvedVia: input.via,
              expiresAt,
            })),
          )
          .returning({ id: chatOwnerGrants.id })
      : [];
    if (request.interactionId) {
      await tx
        .update(issueThreadInteractions)
        .set({
          status: approved ? "accepted" : "rejected",
          result: { version: 1, outcome: approved ? "accepted" : "rejected", reason: approved ? null : (input.ownerText ?? null) },
          resolvedByUserId: ownerUserId,
          resolvedByAgentId: null,
          resolvedByRunId: null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(issueThreadInteractions.id, request.interactionId), eq(issueThreadInteractions.companyId, input.companyId), eq(issueThreadInteractions.status, "pending")));
    }
    await reminders(db).cancel(tx, { companyId: input.companyId, endpointId: input.endpointId, requestId: request.id });
    const wakeActionId = await stageApprovalResolvedWake(tx, endpoint, request, {
      approved,
      via: input.via,
      conditions,
    });
    await recordOpenwaAudit(tx, {
      companyId: input.companyId,
      endpointId: input.endpointId,
      kind: "approval_resolved",
      actorKind: input.via === "paperclip" ? "user" : "chat_principal",
      actorRef: "principalId" in input.owner ? input.owner.principalId : ownerUserId,
      chatKey: request.originChatKey,
      conversationId: request.originConversationId,
      runId: input.runId ?? null,
      metadata: { requestId: request.id, decision: approved ? "approved" : "rejected", via: input.via, grantIds: grants.map((grant) => grant.id) },
      content: { ownerText: input.ownerText, conditions },
      retentionDays: policy.auditContentRetentionDays,
    });
    await logOpenwaActivity(tx, {
      companyId: input.companyId,
      endpointId: input.endpointId,
      action: "openwa.approval_resolved",
      actorUserId: input.via === "paperclip" ? ownerUserId : null,
      actorPrincipalId: "principalId" in input.owner ? input.owner.principalId : null,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: { requestId: request.id, decision: approved ? "approved" : "rejected", via: input.via },
    });
    if (grants.length)
      await logOpenwaActivity(tx, {
        companyId: input.companyId,
        endpointId: input.endpointId,
        action: "openwa.grant_created",
        actorUserId: input.via === "paperclip" ? ownerUserId : null,
        actorPrincipalId: "principalId" in input.owner ? input.owner.principalId : null,
        details: { requestId: request.id, grantIds: grants.map((grant) => grant.id), scope: request.scope, categories: request.categories },
      });
    return {
      status: approved ? ("approved" as const) : ("rejected" as const),
      grantIds: grants.map((grant) => grant.id),
      wakeActionId,
      interactionId: request.interactionId,
    };
  });
  if (result.wakeActionId) await dispatchOpenwaApprovalWake(db, result.wakeActionId);
  return result;
}

async function stageApprovalResolvedWake(
  tx: DbTransaction,
  endpoint: EndpointRow,
  request: RequestRow,
  input: { approved: boolean; via: ChatOwnerApprovalChannel; conditions: string | null },
): Promise<string | null> {
  const conversation = await currentConversation(tx, endpoint, request);
  if (!conversation) return null;
  const [issue] = await tx
    .select({ id: issues.id, assigneeAgentId: issues.assigneeAgentId })
    .from(issues)
    .where(and(eq(issues.companyId, endpoint.companyId), eq(issues.id, conversation.issueId)))
    .limit(1);
  if (!issue?.assigneeAgentId || issue.assigneeAgentId !== endpoint.assignedAgentId) return null;
  const comment = await issueService(tx as unknown as Db).addComment(
    issue.id,
    resolvedCommentBody(request, input.approved, input.via, input.conditions),
    {},
    { authorType: "system" },
    tx,
  );
  const triggerClass: OpenwaTriggerClass = input.approved ? "grant" : "other";
  const [action] = await tx
    .insert(chatActions)
    .values({
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      conversationId: conversation.id,
      principalId: request.requestedByPrincipalId,
      kind: OPENWA_APPROVAL_WAKE_ACTION_KIND,
      providerActionId: "openwa-approval-resolved:" + request.id,
      status: "queued",
      payload: {
        version: 1,
        issueId: issue.id,
        agentId: issue.assigneeAgentId,
        commentId: comment.id,
        expectedStatus: input.approved ? "approved" : "rejected",
        openwa: { event: "approval_resolved", triggerClass, deliveryIds: [], approvalRequestId: request.id },
      },
    })
    .onConflictDoNothing()
    .returning({ id: chatActions.id });
  return action?.id ?? null;
}

export async function dispatchOpenwaApprovalWake(db: Db, actionId: string): Promise<boolean> {
  const runtime = wakeRuntimes.get(db);
  if (!runtime) return false;
  const now = new Date();
  const [claimed] = await db
    .update(chatActions)
    .set({ status: "processing", updatedAt: now })
    .where(
      and(
        eq(chatActions.id, actionId),
        eq(chatActions.kind, OPENWA_APPROVAL_WAKE_ACTION_KIND),
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
    const requestId = String(openwa.approvalRequestId);
    const expectedStatus = String(payload.expectedStatus);
    const [issue] = await db
      .select({ identifier: issues.identifier, assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, claimed.companyId), eq(issues.id, issueId)))
      .limit(1);
    if (!issue || issue.assigneeAgentId !== agentId || issue.status === "backlog") {
      await settle("failed", { code: "openwa_approval_wake_target_changed" });
      return false;
    }
    const request = createDurableChatWakeupRequest({
      id: claimed.id,
      companyId: claimed.companyId,
      agentId,
      issueId,
      commentId,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_APPROVAL_WAKE_ACTOR_ID,
      requestedAt: claimed.createdAt,
      authorize: async (tx) => {
        const [current] = await tx
          .select({ status: chatOwnerApprovalRequests.status })
          .from(chatOwnerApprovalRequests)
          .where(and(eq(chatOwnerApprovalRequests.companyId, claimed.companyId), eq(chatOwnerApprovalRequests.id, requestId)))
          .limit(1);
        if (current?.status !== expectedStatus) throw forbidden("The approval decision changed", { code: "chat_action_authorization_changed" });
      },
    });
    const context = {
      issueId,
      taskKey: issue.identifier,
      wakeCommentId: commentId,
      openwa,
    };
    await runtime.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "OpenWA approval resolved",
      payload: { ...context, mutation: "openwa_approval_resolved" },
      contextSnapshot: { ...context, source: "chat:openwa" },
      allowRunCoalescing: false,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_APPROVAL_WAKE_ACTOR_ID,
      durableChatRequest: request,
    });
    await settle("processed", { code: "openwa_approval_wake_dispatched", wakeupRequestId: claimed.id });
    return true;
  } catch (error) {
    logger.warn({ err: error, actionId: claimed.id }, "failed to dispatch OpenWA approval wake");
    await settle(attemptCount >= WAKE_MAX_ATTEMPTS ? "failed" : "queued", {
      code: "openwa_approval_wake_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function processPendingOpenwaApprovalWakes(db: Db, limit = 25): Promise<number> {
  if (!wakeRuntimes.get(db)) return 0;
  const staleBefore = new Date(Date.now() - WAKE_STALE_PROCESSING_MS);
  const rows = await db
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.kind, OPENWA_APPROVAL_WAKE_ACTION_KIND),
        or(eq(chatActions.status, "queued"), and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, staleBefore))),
      ),
    )
    .orderBy(chatActions.createdAt)
    .limit(limit);
  let dispatched = 0;
  for (const row of rows) if (await dispatchOpenwaApprovalWake(db, row.id)) dispatched++;
  return dispatched;
}

export async function revokeOpenwaGrantsOfFormerOwners(
  tx: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "id">,
  actorUserId: string | null,
): Promise<string[]> {
  const current = [...new Set((await openwaCurrentOwners(tx, endpoint)).map((owner) => owner.userId))];
  const revoked = await tx
    .update(chatOwnerGrants)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(chatOwnerGrants.companyId, endpoint.companyId),
        eq(chatOwnerGrants.endpointId, endpoint.id),
        eq(chatOwnerGrants.status, "live"),
        current.length
          ? or(sql`${chatOwnerGrants.approvedByUserId} is null`, notInArray(chatOwnerGrants.approvedByUserId, current))
          : undefined,
      ),
    )
    .returning({ id: chatOwnerGrants.id });
  const ids = revoked.map((grant) => grant.id);
  if (ids.length)
    await logOpenwaActivity(tx, {
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      action: "openwa.grant_revoked",
      actorUserId,
      details: { grantIds: ids, reason: "approver_no_longer_owner" },
    });
  return ids;
}

export interface OpenwaApprovalView {
  id: string;
  status: ChatOwnerApprovalStatus;
  categories: OpenwaGrantCategory[];
  scope: ChatOwnerGrantScope;
  summary: string;
  proposedAction: string;
  originChat: string;
  originConversationId: string | null;
  interactionId: string | null;
  reminderCount: number;
  resolvedVia: ChatOwnerApprovalChannel | null;
  resolvedByUserId: string | null;
  ownerText: string | null;
  agentConditions: string | null;
  resolvedAt: string | null;
  createdAt: string;
  grants: Array<{ id: string; category: OpenwaGrantCategory; status: string; expiresAt: string }>;
  canResolve: boolean;
}

/** Paperclip resolution through the generic interaction routes; the route already enforced chat_endpoint_owner. */
export async function resolveOpenwaApprovalInteraction(
  db: Db,
  input: { companyId: string; issueId: string; interactionId: string; requestId: string; decision: OpenwaApprovalDecision; userId: string; reason?: string | null },
): Promise<OpenwaApprovalResolution> {
  const [request] = await db
    .select({ endpointId: chatOwnerApprovalRequests.endpointId, interactionId: chatOwnerApprovalRequests.interactionId })
    .from(chatOwnerApprovalRequests)
    .where(and(eq(chatOwnerApprovalRequests.companyId, input.companyId), eq(chatOwnerApprovalRequests.id, input.requestId)))
    .limit(1);
  if (!request || request.interactionId !== input.interactionId) throw notFound("Approval request not found");
  return resolveOpenwaApproval(db, {
    companyId: input.companyId,
    endpointId: request.endpointId,
    requestId: input.requestId,
    decision: input.decision,
    via: "paperclip",
    owner: { userId: input.userId },
    ownerText: input.reason?.trim() || null,
  });
}

export function openwaApprovalService(db: Db) {
  async function endpointFor(endpointId: string): Promise<EndpointRow> {
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpointId)).limit(1);
    if (!endpoint) throw notFound("Chat endpoint not found");
    if (endpoint.provider !== "openwa") throw badRequest("This action is only valid for OpenWA endpoints");
    return endpoint;
  }

  async function list(endpointId: string, input: { status?: ChatOwnerApprovalStatus; viewerUserId: string | null }): Promise<OpenwaApprovalView[]> {
    const endpoint = await endpointFor(endpointId);
    const rows = await db
      .select()
      .from(chatOwnerApprovalRequests)
      .where(
        and(
          eq(chatOwnerApprovalRequests.companyId, endpoint.companyId),
          eq(chatOwnerApprovalRequests.endpointId, endpoint.id),
          input.status ? eq(chatOwnerApprovalRequests.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(chatOwnerApprovalRequests.createdAt))
      .limit(LIST_LIMIT);
    const grants = rows.length
      ? await db
          .select()
          .from(chatOwnerGrants)
          .where(and(eq(chatOwnerGrants.companyId, endpoint.companyId), inArray(chatOwnerGrants.requestId, rows.map((row) => row.id))))
      : [];
    const owner = input.viewerUserId ? (await openwaCurrentOwners(db, endpoint)).some((entry) => entry.userId === input.viewerUserId) : false;
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      categories: row.categories,
      scope: row.scope,
      summary: row.summary,
      proposedAction: row.proposedAction,
      originChat: maskedChat(row.originChatKey),
      originConversationId: row.originConversationId,
      interactionId: row.interactionId,
      reminderCount: row.reminderCount,
      resolvedVia: row.resolvedVia,
      resolvedByUserId: row.resolvedByUserId,
      ownerText: owner ? row.ownerText : null,
      agentConditions: owner ? row.agentConditions : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      grants: grants
        .filter((grant) => grant.requestId === row.id)
        .map((grant) => ({ id: grant.id, category: grant.category, status: grant.status, expiresAt: grant.expiresAt.toISOString() })),
      canResolve: owner && row.status === "pending",
    }));
  }

  async function resolve(endpointId: string, requestId: string, input: { decision: OpenwaApprovalDecision; reason?: string | null; userId: string }) {
    const endpoint = await endpointFor(endpointId);
    const result = await resolveOpenwaApproval(db, {
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      requestId,
      decision: input.decision,
      via: "paperclip",
      owner: { userId: input.userId },
      ownerText: input.reason?.trim() || null,
    });
    return { requestId, status: result.status, grantIds: result.grantIds };
  }

  return { list, resolve };
}

export type OpenwaApprovalService = ReturnType<typeof openwaApprovalService>;
