import { createHash } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
  assets,
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  chatExternalPrincipals,
  chatOpenwaLinkedSessions,
  chatOutboundMessages,
  chatOwnerApprovalRequests,
  heartbeatRuns,
  issueAttachments,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  OPENWA_TOOL_RESULT_LIMIT_BYTES,
  maskOpenwaPhoneNumber,
  openwaChatSettingsSchema,
  openwaEndpointPolicySchema,
  openwaTool,
  type OpenwaEndpointPolicy,
  type OpenwaGrantCategory,
  type OpenwaSendKind,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import { DEFAULT_ATTACHMENT_CONTENT_TYPE, getMaxAttachmentBytes, SVG_CONTENT_TYPE, normalizeContentType } from "../../attachment-types.js";
import { HttpError, forbidden } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { getStorageService } from "../../storage/index.js";
import type { StorageService } from "../../storage/types.js";
import { projectSafeChatPublicationTextOrNull } from "../chat-publication-projection.js";
import { instanceSettingsService } from "../instance-settings.js";
import { parseOpenwaThreadId } from "./adapter.js";
import { openwaApprovalResolveTool, openwaApprovalWithdrawTool, openwaRequestApprovalTool } from "./approvals.js";
import { logOpenwaActivity, recordOpenwaAudit } from "./audit.js";
import {
  OpenwaApprovalRequiredError,
  assertOpenwaRunMay,
  openwaHeldGrantValid,
  openwaRunProfile,
  readOpenwaRunContext,
  restoreOpenwaGrant,
  type OpenwaRunContext,
  type OpenwaRunProfile,
} from "./authority.js";
import { OPENWA_DOCUMENT_CAPTION_LIMIT, formatOpenwaPublication, markdownToWhatsapp } from "./format.js";
import {
  OpenwaGatewayError,
  type OpenwaGatewayClient,
  type OpenwaHistoryMessage,
  type OpenwaSendResult,
  type OpenwaStoredMessage,
} from "./gateway.js";
import { openwaCallTool, openwaCatalogTool, openwaDescribeTool } from "./call.js";
import { assertOpenwaConfigOwnerRun, openwaEndpointConfigTool, refuseOpenwaUiOnlyConfig } from "./config-tool.js";
import { openwaAutonomyWindowTool } from "./autonomy-window-tool.js";
import { openwaLinkedGetMediaTool, openwaLinkedListTool, openwaLinkedReadTool, type OpenwaLinkedService } from "./linked.js";
import { maskOpenwaDigits } from "./guidance.js";
import { openwaAttachmentLocalPaths, type OpenwaIngestedMedia, type OpenwaMediaService } from "./media.js";
import { openwaChatKey, type OpenwaOutboundRegistry } from "./outbound.js";
import { openwaCurrentOwnerUserId, type OpenwaOwnerService } from "./owners.js";
import { openwaOutsideAllowlistNeedsGrant, openwaResourceGroupActive } from "./policy.js";
import { markTriggersAnswered } from "./publication.js";
import { redactOpenwaSecrets } from "./redact.js";
import {
  createOpenwaWrite,
  finishOpenwaWrite,
  openwaToolArgsHash,
  openwaWriteHashMatches,
  openwaWriteReplay,
  runOpenwaWrite,
  setOpenwaWriteGrant,
  type OpenwaPlannedSend,
  type OpenwaWriteScope,
} from "./tool-writes.js";

type EndpointRow = typeof chatEndpoints.$inferSelect;
type ConversationRow = typeof chatConversations.$inferSelect;
type Args = Record<string, unknown>;

export const OPENWA_HANDOFF_ACTION_KIND = "openwa_handoff";
const USABLE_ENDPOINT_STATUSES = new Set(["active", "verifying", "attention"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);
const ISSUE_ANCESTRY_DEPTH = 8;
const READ_TEXT_LIMIT = 2000;
const TRANSCRIPT_LIMIT = 8000;
const FIND_LIMIT = 20;
const RESULT_ENVELOPE_BYTES = 1024;
const CHAT_ID = /^[A-Za-z0-9._-]{1,128}@(c\.us|g\.us|lid|s\.whatsapp\.net)$/i;
const CHAT_REF = /^openwa:([A-Za-z0-9-]{1,64}):(.+)$/;
const E164 = /^\+?([1-9]\d{6,14})$/;

export type OpenwaToolErrorCode =
  | "approval_required"
  | "approval_not_authorized"
  | "owner_decision_unclear"
  | "approval_action_pending"
  | "approval_not_needed"
  | "already_resolved"
  | "no_owner_chat"
  | "message_too_long"
  | "requester_unknown"
  | "owner_only"
  | "chat_inactive"
  | "reply_denied"
  | "unavailable_on_engine"
  | "unavailable_without_admin_key"
  | "retry_after"
  | "quote_unresolvable"
  | "number_not_on_whatsapp"
  | "gateway_unavailable"
  | "session_not_ready"
  | "idempotency_conflict"
  | "invalid_target"
  | "invalid_cursor"
  | "attachment_unavailable"
  | "caption_too_long"
  | "not_found"
  | "gateway_error"
  | "gateway_admin_disabled"
  | "self_session_requires_confirmation"
  | "secret_issuing_operation"
  | "ui_only_setting"
  | "config_conflict"
  | "linked_chat_not_allowed"
  | "linked_session_unavailable"
  | "invalid_arguments";

export class OpenwaToolError extends HttpError {
  readonly code: OpenwaToolErrorCode;

  constructor(status: number, code: OpenwaToolErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(status, message, { code, ...extra });
    this.code = code;
  }
}

export interface OpenwaToolBinding {
  companyId: string;
  agentId: string;
  runId: string;
  issueId: string;
  workMode?: string;
}

export interface OpenwaToolRuntimeHandle {
  gateway: OpenwaGatewayClient;
  registry: OpenwaOutboundRegistry;
  media?: OpenwaMediaService;
  storage?: StorageService;
}

export interface OpenwaToolRuntime {
  resolve(endpoint: EndpointRow): Promise<OpenwaToolRuntimeHandle>;
  owners: OpenwaOwnerService;
  linked: OpenwaLinkedService;
}

const runtimes = new WeakMap<Db, OpenwaToolRuntime>();

export function registerOpenwaToolRuntime(db: Db, runtime: OpenwaToolRuntime): () => void {
  runtimes.set(db, runtime);
  return () => {
    if (runtimes.get(db) === runtime) runtimes.delete(db);
  };
}

export function openwaToolOwners(db: Db): OpenwaOwnerService {
  const runtime = runtimes.get(db);
  if (!runtime) throw new OpenwaToolError(503, "gateway_unavailable", "The OpenWA runtime is not available in this process");
  return runtime.owners;
}

function openwaToolLinked(db: Db): OpenwaLinkedService {
  const runtime = runtimes.get(db);
  if (!runtime) throw new OpenwaToolError(503, "gateway_unavailable", "The OpenWA runtime is not available in this process");
  return runtime.linked;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clip(value: string, limit: number): { text: string; truncated: boolean } {
  const chars = [...value];
  return chars.length <= limit ? { text: value, truncated: false } : { text: chars.slice(0, limit).join("") + "…", truncated: true };
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "");
}

function phoneDigits(jid: string | null | undefined): string | null {
  const match = /^\+?(\d{5,})(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/i.exec(jid ?? "");
  return match ? match[1]! : null;
}

function displayName(value: unknown): string | null {
  const name = str(value);
  if (!name) return null;
  const clipped = clip(name, 200).text;
  return /\d{6,}/.test(clipped) ? maskOpenwaDigits(clipped) : clipped;
}

interface ConversationBinding {
  conversationId: string;
  conversationIssueId: string;
  endpointId: string;
  connectionId: string;
  assignedAgentId: string;
  status: string;
}

async function findOpenwaConversation(db: Db, companyId: string, issueId: string): Promise<ConversationBinding | null> {
  const rows = (await db.execute(sql`
    with recursive chain(id, parent_id, depth) as (
      select id, parent_id, 0 from issues where company_id = ${companyId} and id = ${issueId}
      union all
      select parent.id, parent.parent_id, chain.depth + 1
      from issues parent join chain on parent.id = chain.parent_id
      where parent.company_id = ${companyId} and chain.depth < ${ISSUE_ANCESTRY_DEPTH}
    )
    select c.id as conversation_id, c.issue_id as conversation_issue_id, e.id as endpoint_id,
      e.connection_id, e.assigned_agent_id, e.status
    from chain
    join chat_conversations c on c.company_id = ${companyId} and c.issue_id = chain.id
    join chat_endpoints e on e.company_id = c.company_id and e.id = c.endpoint_id and e.provider = 'openwa'
    order by chain.depth asc, c.created_at desc
    limit 1
  `)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: String(row.conversation_id),
    conversationIssueId: String(row.conversation_issue_id),
    endpointId: String(row.endpoint_id),
    connectionId: String(row.connection_id),
    assignedAgentId: String(row.assigned_agent_id),
    status: String(row.status),
  };
}

async function chatConnectorsEnabled(db: Db): Promise<boolean> {
  return Boolean((await instanceSettingsService(db).getExperimental()).enableChatConnectors);
}

export async function openwaAssignedResource(
  db: Db,
  binding: { companyId: string; agentId: string; runId?: string; issueId?: string },
): Promise<Array<{ id: string; label: string; connectionId: string }>> {
  if (!binding.runId || !binding.issueId) return [];
  if (!(await chatConnectorsEnabled(db))) return [];
  const found = await findOpenwaConversation(db, binding.companyId, binding.issueId);
  if (!found || found.assignedAgentId !== binding.agentId || !USABLE_ENDPOINT_STATUSES.has(found.status)) return [];
  return [{ id: found.endpointId, label: "OpenWA", connectionId: found.connectionId }];
}

export async function openwaToolBindingForRun(
  db: Db,
  input: { companyId: string; agentId: string; runId: string },
): Promise<OpenwaToolBinding | null> {
  const [run] = await db
    .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId)))
    .limit(1);
  const context = record(run?.contextSnapshot);
  const issueId = str(context.issueId) ?? str(context.taskId);
  if (!issueId) return null;
  const binding = { ...input, issueId };
  return (await openwaAssignedResource(db, binding)).length ? binding : null;
}

export interface Target {
  chatId: string;
  chatKey: string;
  isGroup: boolean;
  isOrigin: boolean;
  number: string | null;
}

export interface ToolContext {
  db: Db;
  binding: OpenwaToolBinding;
  endpoint: EndpointRow;
  conversation: ConversationRow;
  policy: OpenwaEndpointPolicy;
  run: { id: string; companyId: string; contextSnapshot: Record<string, unknown>; visibleBefore: Date };
  openwa: OpenwaRunContext | null;
  profile: OpenwaRunProfile;
  runClass: OpenwaTriggerClass | null;
  sessionId: string;
  selfChatKey: string;
  origin: Target;
  audit: { chatKey: string | null; actionId: string | null; operation: string | null };
  runtime(): Promise<OpenwaToolRuntimeHandle>;
}

export function chatRef(ctx: Pick<ToolContext, "sessionId">, chatId: string): string {
  return "openwa:" + ctx.sessionId + ":" + chatId;
}

async function resolveContext(db: Db, binding: OpenwaToolBinding): Promise<ToolContext> {
  if (!(await chatConnectorsEnabled(db))) throw forbidden("Chat connectors are disabled");
  const [run] = await db
    .select({
      id: heartbeatRuns.id,
      companyId: heartbeatRuns.companyId,
      status: heartbeatRuns.status,
      contextSnapshot: heartbeatRuns.contextSnapshot,
      startedAt: heartbeatRuns.startedAt,
      createdAt: heartbeatRuns.createdAt,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, binding.runId), eq(heartbeatRuns.companyId, binding.companyId), eq(heartbeatRuns.agentId, binding.agentId)))
    .limit(1);
  if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) throw forbidden("OpenWA tools require the agent's active run");
  const snapshot = record(run.contextSnapshot);
  if ((str(snapshot.issueId) ?? str(snapshot.taskId)) !== binding.issueId) throw forbidden("OpenWA tools require the run's own task");
  const found = await findOpenwaConversation(db, binding.companyId, binding.issueId);
  if (!found || found.assignedAgentId !== binding.agentId || !USABLE_ENDPOINT_STATUSES.has(found.status))
    throw forbidden("This connector is no longer assigned or authorized");
  const [[endpoint], [conversation]] = await Promise.all([
    db.select().from(chatEndpoints).where(and(eq(chatEndpoints.companyId, binding.companyId), eq(chatEndpoints.id, found.endpointId))),
    db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.companyId, binding.companyId), eq(chatConversations.id, found.conversationId))),
  ]);
  if (!endpoint || !conversation) throw forbidden("This connector is no longer assigned or authorized");
  const openwa = readOpenwaRunContext(snapshot);
  if (openwa && openwa.endpointId !== endpoint.id) throw forbidden("The run belongs to another OpenWA endpoint");
  const thread = parseOpenwaThreadId(conversation.externalThreadId || conversation.externalConversationId);
  const sessionId = (endpoint.providerAccountId ?? "").slice((endpoint.providerAccountId ?? "").lastIndexOf("#") + 1);
  if (thread.sessionId !== sessionId) throw forbidden("The conversation belongs to another OpenWA session");
  const runRecord = { id: run.id, companyId: run.companyId, contextSnapshot: snapshot, visibleBefore: run.startedAt ?? run.createdAt };
  const profile = await openwaRunProfile(db, runRecord);
  const runClass: OpenwaTriggerClass | null = found.conversationIssueId === binding.issueId ? (openwa?.triggerClass ?? "other") : null;
  const originKey = openwaChatKey(thread.chatId);
  let handle: Promise<OpenwaToolRuntimeHandle> | null = null;
  return {
    db,
    binding,
    endpoint,
    conversation,
    policy: openwaEndpointPolicySchema.parse(endpoint.policy),
    run: runRecord,
    openwa,
    profile,
    runClass,
    sessionId,
    selfChatKey: (endpoint.botExternalId ?? "").replace(/\D/g, "") + "@c.us",
    origin: { chatId: thread.chatId, chatKey: originKey, isGroup: thread.isGroup, isOrigin: true, number: phoneDigits(thread.chatId) },
    audit: { chatKey: originKey, actionId: null, operation: null },
    runtime() {
      handle ??= (async () => {
        const runtime = runtimes.get(db);
        if (!runtime) throw new OpenwaToolError(503, "gateway_unavailable", "The OpenWA runtime is not available in this process");
        try {
          return await runtime.resolve(endpoint);
        } catch (error) {
          if (error instanceof OpenwaToolError) throw error;
          throw new OpenwaToolError(503, "gateway_unavailable", "The OpenWA runtime for this endpoint is not available");
        }
      })();
      return handle;
    },
  };
}

export function resolveTarget(ctx: ToolContext, ref: unknown): Target {
  const value = str(ref);
  if (!value) return ctx.origin;
  let chatId: string;
  let number: string | null = null;
  const refMatch = CHAT_REF.exec(value);
  if (refMatch) {
    if (refMatch[1] !== ctx.sessionId) throw new OpenwaToolError(400, "invalid_target", "The chatRef belongs to another WhatsApp session");
    chatId = refMatch[2]!;
  } else if (/@g\.us$/i.test(value)) {
    chatId = value;
  } else {
    const e164 = E164.exec(value.replace(/[\s()-]/g, ""));
    if (!e164) throw new OpenwaToolError(400, "invalid_target", "Use a chatRef, a group id or an E.164 number");
    number = e164[1]!;
    chatId = number + "@c.us";
  }
  if (!CHAT_ID.test(chatId)) throw new OpenwaToolError(400, "invalid_target", "The chat reference is malformed");
  const chatKey = openwaChatKey(chatId);
  return {
    chatId: chatKey === ctx.origin.chatKey ? ctx.origin.chatId : chatId,
    chatKey,
    isGroup: /@g\.us$/i.test(chatId),
    isOrigin: chatKey === ctx.origin.chatKey,
    number: number ?? phoneDigits(chatId),
  };
}

export async function enabledChatKeys(ctx: ToolContext, targets?: Target[]): Promise<Set<string>> {
  const keys = targets?.map((target) => target.chatKey) ?? [];
  const rows = await ctx.db
    .select({ providerResourceId: chatEndpointResources.providerResourceId, metadata: chatEndpointResources.metadata })
    .from(chatEndpointResources)
    .where(
      and(
        eq(chatEndpointResources.companyId, ctx.endpoint.companyId),
        eq(chatEndpointResources.endpointId, ctx.endpoint.id),
        sql`${chatEndpointResources.settings}->>'activation' = 'on'`,
        targets
          ? or(
              inArray(chatEndpointResources.providerResourceId, targets.map((target) => chatRef(ctx, target.chatId))),
              inArray(sql<string>`${chatEndpointResources.metadata}->>'chatKey'`, keys),
            )
          : undefined,
      ),
    );
  const enabled = new Set<string>([ctx.selfChatKey, ctx.origin.chatKey]);
  for (const row of rows) {
    const key = str(row.metadata.chatKey);
    if (key) enabled.add(openwaChatKey(key));
    const match = CHAT_REF.exec(row.providerResourceId);
    if (match) enabled.add(openwaChatKey(match[2]!));
  }
  return enabled;
}

export async function assertReadable(ctx: ToolContext, target: Target): Promise<void> {
  if (ctx.policy.numberMode !== "owner_number" || target.isOrigin || target.chatKey === ctx.selfChatKey) return;
  if ((await enabledChatKeys(ctx, [target])).has(target.chatKey)) return;
  throw new OpenwaToolError(403, "chat_inactive", "In owner_number mode only chats enabled in Settings are visible");
}

export function toolErrorFromGateway(error: unknown, quoting: boolean): unknown {
  if (!(error instanceof OpenwaGatewayError)) return error;
  const extra = { operationId: error.operationId };
  switch (error.code) {
    case "retry_after":
    case "rate_limited": {
      const seconds = error.retryAfterSeconds;
      return new OpenwaToolError(
        429,
        "retry_after",
        seconds === null ? "WhatsApp is throttling this session; retry later" : "WhatsApp is throttling this session; retry after " + seconds + " seconds",
        { ...extra, retryAfterSeconds: seconds, pacing: error.pacing },
      );
    }
    case "unavailable_on_engine":
      return new OpenwaToolError(422, "unavailable_on_engine", "This operation is not supported by the gateway's WhatsApp engine", extra);
    case "unavailable_without_admin_key":
      return new OpenwaToolError(422, "unavailable_without_admin_key", "This operation needs an OpenWA admin key, which is not configured", extra);
    case "gateway_unavailable":
      return new OpenwaToolError(503, "gateway_unavailable", "The OpenWA gateway is unreachable", { ...extra, retryAfterSeconds: error.retryAfterSeconds });
    case "conflict":
      return new OpenwaToolError(409, "session_not_ready", "The WhatsApp session is not ready", extra);
    case "not_found":
      return quoting
        ? new OpenwaToolError(422, "quote_unresolvable", "The quoted message cannot be resolved in this chat", extra)
        : new OpenwaToolError(404, "not_found", "WhatsApp has no such chat, contact or message", extra);
    case "bad_request":
      return quoting && /quot/i.test(error.message)
        ? new OpenwaToolError(422, "quote_unresolvable", "The quoted message cannot be resolved in this chat", extra)
        : new OpenwaToolError(422, "gateway_error", error.message, extra);
    default:
      return new OpenwaToolError(502, "gateway_error", error.message, extra);
  }
}

async function gatewayCall<T>(ctx: ToolContext, run: (gateway: OpenwaGatewayClient) => Promise<T>): Promise<T> {
  const { gateway } = await ctx.runtime();
  try {
    return await run(gateway);
  } catch (error) {
    throw toolErrorFromGateway(error, false);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WA_MESSAGE_CHAT = /^(?:true|false)_([^_]+@(?:c\.us|g\.us|lid|s\.whatsapp\.net))_/i;
const LIVE_LIMIT = 100;
const DEEP_LIMIT = 2000;

function requireConversationRun(ctx: ToolContext): OpenwaTriggerClass {
  if (!ctx.runClass) throw forbidden("Only runs on the WhatsApp conversation issue can change trigger state");
  return ctx.runClass;
}

function visibleTriggerScope(ctx: ToolContext) {
  const deliveryIds = ctx.openwa?.deliveryIds ?? [];
  return and(
    eq(chatDeliveries.companyId, ctx.endpoint.companyId),
    eq(chatDeliveries.endpointId, ctx.endpoint.id),
    eq(chatDeliveries.conversationId, ctx.conversation.id),
    eq(chatDeliveries.answerState, "pending"),
    or(lte(chatDeliveries.receivedAt, ctx.run.visibleBefore), ...(deliveryIds.length ? [inArray(chatDeliveries.id, deliveryIds)] : [])),
  );
}

/** Ids of this run's visible pending triggers from anyone but an owner. */
export async function openwaPendingNonOwnerTriggerIds(ctx: ToolContext): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: chatDeliveries.id })
    .from(chatDeliveries)
    .where(and(visibleTriggerScope(ctx), sql`${chatDeliveries.principalRole} is distinct from 'owner'`));
  return rows.map((row) => row.id).sort();
}

/** True when waMessageId is a visible pending trigger of this run. */
async function quotesVisibleTrigger(ctx: ToolContext, waMessageId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: chatDeliveries.id })
    .from(chatDeliveries)
    .where(and(visibleTriggerScope(ctx), sql`${chatDeliveries.normalizedEvent}->'openwa'->>'waMessageId' = ${waMessageId}`))
    .limit(1);
  return Boolean(row);
}

async function resolveQuote(ctx: ToolContext, target: Target, quote: unknown): Promise<string | null> {
  const value = str(quote);
  if (!value) return null;
  let waMessageId = value;
  if (UUID.test(value)) {
    const [row] = await ctx.db
      .select({ normalizedEvent: chatDeliveries.normalizedEvent })
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, ctx.endpoint.companyId), eq(chatDeliveries.endpointId, ctx.endpoint.id), eq(chatDeliveries.id, value)))
      .limit(1);
    const openwa = record(row?.normalizedEvent.openwa);
    const resolved = str(openwa.waMessageId);
    if (!resolved || openwaChatKey(str(openwa.chatKey) ?? "") !== target.chatKey)
      throw new OpenwaToolError(422, "quote_unresolvable", "The quoted trigger is not a message of this chat");
    waMessageId = resolved;
  }
  const chat = WA_MESSAGE_CHAT.exec(waMessageId);
  if (chat && openwaChatKey(chat[1]!) !== target.chatKey)
    throw new OpenwaToolError(422, "quote_unresolvable", "The quoted message belongs to another chat");
  return waMessageId;
}

function mentionTargets(ctx: ToolContext, mentions: unknown): Array<{ jid: string; token: string }> {
  if (!Array.isArray(mentions)) return [];
  const out = new Map<string, { jid: string; token: string }>();
  for (const entry of mentions) {
    const value = String(entry);
    const ref = CHAT_REF.exec(value);
    let jid: string;
    if (ref) {
      if (ref[1] !== ctx.sessionId) throw new OpenwaToolError(400, "invalid_target", "A mention chatRef belongs to another WhatsApp session");
      jid = ref[2]!;
      if (!/^\d{5,25}@(c\.us|lid)$/i.test(jid)) throw new OpenwaToolError(400, "invalid_target", "Mentions must be people, not groups");
    } else {
      const e164 = E164.exec(value);
      if (!e164) throw new OpenwaToolError(400, "invalid_target", "Mentions are E.164 numbers or DM chatRefs");
      jid = e164[1]! + "@c.us";
    }
    const digits = jid.slice(0, jid.indexOf("@"));
    out.set(jid.toLowerCase(), { jid: jid.toLowerCase(), token: "@" + digits });
  }
  return [...out.values()];
}

export function openwaMentionText(text: string, mentions: ReadonlyArray<{ token: string }>): string {
  const missing = mentions.filter((mention) => !new RegExp("(^|[^\\d])" + mention.token.replace(/[+]/g, "\\+") + "(?!\\d)").test(text));
  return missing.length ? missing.map((mention) => mention.token).join(" ") + " " + text : text;
}

export async function replyRequirementFailure(ctx: ToolContext, quotedMessageId: string | null = null): Promise<{ category: OpenwaGrantCategory; reason: string } | null> {
  return (await replyRequirementGaps(ctx, true, quotedMessageId))[0] ?? null;
}

/** Reply requirements of this run's visible triggers (only the quoted one when the reply quotes a visible trigger) that its grants do not cover; ownerAbsentExempt false ignores the owner_absent holding-reply exemption. */
export async function replyRequirementGaps(
  ctx: ToolContext,
  ownerAbsentExempt = true,
  quotedMessageId: string | null = null,
): Promise<Array<{ category: OpenwaGrantCategory; reason: string }>> {
  if (ctx.profile === "full" || !ctx.runClass) return [];
  const resource = ctx.conversation.resourceId
    ? await ctx.db
        .select({ settings: chatEndpointResources.settings, metadata: chatEndpointResources.metadata, availability: chatEndpointResources.availability })
        .from(chatEndpointResources)
        .where(and(eq(chatEndpointResources.companyId, ctx.endpoint.companyId), eq(chatEndpointResources.id, ctx.conversation.resourceId)))
        .then((rows) => rows[0] ?? null)
    : null;
  const settings = ctx.conversation.resourceId ? openwaChatSettingsSchema.safeParse(resource?.settings ?? {}) : null;
  const groupActive = ctx.origin.isGroup && openwaResourceGroupActive(ctx.policy, resource);
  const replyPolicy = (settings?.success ? settings.data.replyPolicy : undefined) ?? ctx.policy.replyPolicy;
  const event = str(record(ctx.run.contextSnapshot.openwa).event);
  const policyNeedsReply =
    ctx.runClass === "other" && (replyPolicy === "ask_owner" || (replyPolicy === "owner_absent_only" && event !== "owner_absent"));
  const visible = await ctx.db
    .select({ principalId: chatDeliveries.principalId, principalRole: chatDeliveries.principalRole, normalizedEvent: chatDeliveries.normalizedEvent })
    .from(chatDeliveries)
    .where(and(visibleTriggerScope(ctx), eq(chatDeliveries.triggerClass, ctx.runClass)));
  const quoted = quotedMessageId ? visible.filter((trigger) => str(record(record(trigger.normalizedEvent).openwa).waMessageId) === quotedMessageId) : [];
  const pending = quoted.length ? quoted : visible;
  const needs: Array<{ principalId: string | null; category: OpenwaGrantCategory; reason: string }> = [];
  for (const trigger of pending) {
    if (trigger.principalRole === "owner") continue;
    if (trigger.principalRole === "outside_allowlist" && openwaOutsideAllowlistNeedsGrant(trigger.normalizedEvent, groupActive, ctx.policy, ownerAbsentExempt ? ctx.openwa?.event : null))
      needs.push({ principalId: trigger.principalId, category: "reply_outside_allowlist", reason: "The sender is outside the allowlist" });
    if (policyNeedsReply) needs.push({ principalId: trigger.principalId, category: "reply", reason: "The chat's reply policy is " + replyPolicy });
  }
  if (policyNeedsReply && pending.length === 0)
    needs.push({ principalId: ctx.openwa?.requesterPrincipalId ?? null, category: "reply", reason: "The chat's reply policy is " + replyPolicy });
  if (needs.length === 0) return [];
  const grantIds = ctx.openwa?.grantIds ?? [];
  const grants = grantIds.length
    ? ((await ctx.db.execute(sql`
        select category, requester_principal_id from chat_owner_grants
        where company_id = ${ctx.endpoint.companyId} and endpoint_id = ${ctx.endpoint.id}
          and origin_chat_key = ${ctx.origin.chatKey} and status = 'live' and expires_at > now()
          and id in (${sql.join(grantIds.map((id) => sql`${id}::uuid`), sql`, `)})
      `)) as unknown as Array<{ category: string; requester_principal_id: string | null }>)
    : [];
  return needs
    .filter((need) => !(need.principalId !== null && grants.some((grant) => grant.category === need.category && grant.requester_principal_id === need.principalId)))
    .map(({ category, reason }) => ({ category, reason }));
}

async function ownerPrincipal(ctx: ToolContext, digits: string): Promise<boolean> {
  const principals = await ctx.db
    .select({ id: chatExternalPrincipals.id })
    .from(chatExternalPrincipals)
    .where(
      and(
        eq(chatExternalPrincipals.companyId, ctx.endpoint.companyId),
        eq(chatExternalPrincipals.provider, "openwa"),
        eq(chatExternalPrincipals.providerAccountId, ctx.endpoint.providerAccountId ?? ""),
        eq(chatExternalPrincipals.externalId, digits.replace(/\D/g, "") + "@c.us"),
      ),
    )
    .limit(1);
  if (!principals[0]) return false;
  return (await openwaCurrentOwnerUserId(ctx.db, ctx.endpoint, principals[0].id)).ownerId !== null;
}

/** Refuses sends from an approval_reply run to the approval's origin chat; the approval_resolved run carries out the approved action. */
async function assertNotApprovalOrigin(ctx: ToolContext, target: Target): Promise<void> {
  if (ctx.openwa?.event !== "approval_reply" || !ctx.openwa.approvalRequestId) return;
  const [request] = await ctx.db
    .select({ originChatKey: chatOwnerApprovalRequests.originChatKey })
    .from(chatOwnerApprovalRequests)
    .where(
      and(
        eq(chatOwnerApprovalRequests.companyId, ctx.endpoint.companyId),
        eq(chatOwnerApprovalRequests.endpointId, ctx.endpoint.id),
        eq(chatOwnerApprovalRequests.id, ctx.openwa.approvalRequestId),
      ),
    )
    .limit(1);
  if (request && openwaChatKey(request.originChatKey) === target.chatKey)
    throw new OpenwaToolError(409, "approval_action_pending", "Resolve the approval with openwa_approval_resolve; the approved action is carried out in that chat by the approval_resolved run", {
      approvalRequestId: ctx.openwa.approvalRequestId,
    });
}

async function assertSendAllowed(ctx: ToolContext, target: Target, heldGrant: string | null, quote: string | null): Promise<string | null> {
  await assertNotApprovalOrigin(ctx, target);
  if (!target.isOrigin) {
    if (heldGrant && (await openwaHeldGrantValid(ctx.db, { companyId: ctx.endpoint.companyId, grantId: heldGrant }))) return null;
    try {
      return await assertOpenwaRunMay(ctx.db, ctx.run, "cross_chat_send");
    } catch (error) {
      if (error instanceof OpenwaApprovalRequiredError)
        throw new OpenwaToolError(403, "approval_required", "Sending to a chat other than the origin chat needs owner approval", {
          category: "cross_chat_send",
          hint: "Ask an endpoint owner with openwa_request_approval, then continue in the approved run.",
        });
      throw error;
    }
  }
  const failure = await replyRequirementFailure(ctx, quote);
  if (failure)
    throw new OpenwaToolError(403, "reply_denied", failure.reason + "; replying here needs owner approval", {
      category: failure.category,
      hint: "Ask an endpoint owner with openwa_request_approval, or stay silent.",
    });
  return null;
}

async function attachmentBase64(ctx: ToolContext, attachmentId: string, storage: StorageService | undefined) {
  const issueIds = [...new Set([ctx.binding.issueId, ctx.conversation.issueId])];
  const [row] = await ctx.db
    .select({ asset: assets })
    .from(issueAttachments)
    .innerJoin(assets, and(eq(assets.id, issueAttachments.assetId), eq(assets.companyId, ctx.endpoint.companyId)))
    .where(
      and(
        eq(issueAttachments.id, attachmentId),
        eq(issueAttachments.companyId, ctx.endpoint.companyId),
        inArray(issueAttachments.issueId, issueIds),
      ),
    )
    .limit(1);
  if (!row || row.asset.byteSize > getMaxAttachmentBytes())
    throw new OpenwaToolError(422, "attachment_unavailable", "Media must be an attachment of this task within the attachment size limit");
  const stored = await (storage ?? getStorageService()).getObject(ctx.endpoint.companyId, row.asset.objectKey);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stored.stream) {
      const buffer = Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > getMaxAttachmentBytes()) throw new OpenwaToolError(422, "attachment_unavailable", "Attachment exceeds the size limit");
      chunks.push(buffer);
    }
  } finally {
    stored.stream.destroy();
  }
  const data = Buffer.concat(chunks);
  if (createHash("sha256").update(data).digest("hex") !== row.asset.sha256)
    throw new OpenwaToolError(422, "attachment_unavailable", "Attachment changed before sending");
  return {
    base64: data.toString("base64"),
    mimetype: row.asset.contentType || DEFAULT_ATTACHMENT_CONTENT_TYPE,
    filename: row.asset.originalFilename ?? "attachment",
  };
}

/** Gateway media kind for an attachment: the requested kind when the file's MIME family fits it, otherwise a document. */
export function openwaGatewayMediaKind(kind: OpenwaSendKind, mimetype: string): "image" | "video" | "audio" | "document" | "sticker" {
  const essence = normalizeContentType(mimetype);
  const family = essence.slice(0, essence.indexOf("/"));
  if ((kind === "image" || kind === "sticker") && family === "image" && essence !== SVG_CONTENT_TYPE) return kind;
  if (kind === "video" && family === "video") return "video";
  if ((kind === "audio" || kind === "voice") && family === "audio") return "audio";
  return "document";
}

export function prefixFor(ctx: ToolContext): string | null {
  return ctx.policy.numberMode === "owner_number" && ctx.policy.ownerNumberPrefix.enabled ? ctx.policy.ownerNumberPrefix.text : null;
}

function safeText(text: string): string {
  const safe = projectSafeChatPublicationTextOrNull(text);
  if (safe === null) throw new OpenwaToolError(422, "gateway_error", "The message text is empty after removing hidden content");
  return safe;
}

export function messageIdOf(result: unknown): OpenwaSendResult {
  const data = record(result);
  return { messageId: String(data.messageId ?? ""), timestamp: Number(data.timestamp ?? 0) };
}

async function planSends(ctx: ToolContext, args: Args, target: Target, quote: string | null): Promise<{ sends: OpenwaPlannedSend[]; text: string | null; kind: OpenwaSendKind }> {
  const handle = await ctx.runtime();
  const gateway = handle.gateway;
  const kind = (args.kind as OpenwaSendKind | undefined) ?? "text";
  const mentions = mentionTargets(ctx, args.mentions);
  const mentionIds = mentions.map((mention) => mention.jid);
  const withQuote = (index: number) => (index === 0 && quote ? { quotedMessageId: quote } : {});
  const withMentions = (index: number) => (index === 0 && mentionIds.length ? { mentions: mentionIds } : {});
  const chatId = target.chatId;
  if (kind === "text") {
    const markdown = openwaMentionText(safeText(String(args.text)), mentions);
    const formatted = formatOpenwaPublication({ markdown, prefix: prefixFor(ctx) });
    if (formatted.kind === "text") {
      return {
        kind,
        text: formatted.parts.join("\n\n"),
        sends: formatted.parts.map((part, index) => ({
          key: "part:" + index,
          body: part,
          send: () => gateway.sendText({ chatId, text: part, ...withQuote(index), ...withMentions(index) }),
        })),
      };
    }
    const encoded = Buffer.from(formatted.document.content, "utf8").toString("base64");
    return {
      kind,
      text: formatted.caption,
      sends: [
        {
          key: "document",
          body: formatted.caption,
          send: () =>
            gateway.sendMedia({
              kind: "document",
              chatId,
              base64: encoded,
              filename: formatted.document.filename,
              mimetype: formatted.document.mimetype,
              caption: formatted.caption,
              ...withQuote(0),
              ...withMentions(0),
            }),
        },
      ],
    };
  }
  if (kind === "location") {
    const location = record(args.location);
    return {
      kind,
      text: null,
      sends: [
        {
          key: "location",
          body: "",
          send: async () =>
            messageIdOf(
              record(
                await gateway.call("MessageController_sendLocation", {
                  chatId,
                  latitude: location.lat,
                  longitude: location.lng,
                  ...(location.name ? { description: location.name } : {}),
                  ...(location.address ? { address: location.address } : {}),
                  ...withQuote(0),
                }),
              ).data,
            ),
        },
      ],
    };
  }
  if (kind === "contact") {
    const contact = record(args.contact);
    return {
      kind,
      text: null,
      sends: [
        {
          key: "contact",
          body: "",
          send: async () =>
            messageIdOf(
              record(
                await gateway.call("MessageController_sendContact", {
                  chatId,
                  contactName: String(contact.name),
                  contactNumber: String(contact.number).replace(/^\+/, ""),
                  ...withQuote(0),
                }),
              ).data,
            ),
        },
      ],
    };
  }
  if (kind === "poll") {
    const poll = record(args.poll);
    return {
      kind,
      text: String(poll.question),
      sends: [
        {
          key: "poll",
          body: String(poll.question),
          send: async () =>
            messageIdOf(
              record(
                await gateway.call("MessageController_sendPoll", {
                  chatId,
                  name: String(poll.question),
                  options: poll.options,
                  ...(poll.multi ? { allowMultipleAnswers: true } : {}),
                  ...withQuote(0),
                }),
              ).data,
            ),
        },
      ],
    };
  }
  const media = await attachmentBase64(ctx, String(args.attachmentId), handle.storage);
  const gatewayKind = openwaGatewayMediaKind(kind, media.mimetype);
  const sentKind: OpenwaSendKind = gatewayKind === "document" ? "document" : kind;
  const prefix = prefixFor(ctx);
  const captionSource = args.text ? markdownToWhatsapp(openwaMentionText(safeText(String(args.text)), mentions)) : mentions.length ? mentions.map((mention) => mention.token).join(" ") : "";
  const caption = captionSource ? (prefix ? prefix + "\n" + captionSource : captionSource) : "";
  if ([...caption].length > OPENWA_DOCUMENT_CAPTION_LIMIT)
    throw new OpenwaToolError(422, "caption_too_long", "Media captions are limited to " + OPENWA_DOCUMENT_CAPTION_LIMIT + " characters; send the text separately");
  return {
    kind: sentKind,
    text: caption || null,
    sends: [
      {
        key: "media",
        body: caption,
        send: () =>
          gateway.sendMedia({
            kind: gatewayKind,
            chatId,
            base64: media.base64,
            mimetype: media.mimetype,
            filename: media.filename,
            ...(caption && sentKind !== "sticker" ? { caption } : {}),
            ...(sentKind === "voice" ? { ptt: true } : {}),
            ...withQuote(0),
            ...withMentions(0),
          }),
      },
    ],
  };
}

async function precheckNumber(ctx: ToolContext, target: Target): Promise<Target> {
  if (target.isOrigin || target.isGroup || !target.number) return target;
  const [known] = await ctx.db
    .select({ id: chatOutboundMessages.id })
    .from(chatOutboundMessages)
    .where(
      and(
        eq(chatOutboundMessages.companyId, ctx.endpoint.companyId),
        eq(chatOutboundMessages.endpointId, ctx.endpoint.id),
        eq(chatOutboundMessages.chatKey, target.chatKey),
        eq(chatOutboundMessages.state, "sent"),
      ),
    )
    .limit(1);
  if (known) return target;
  const check = await gatewayCall(ctx, (gateway) => gateway.checkNumber(target.number!));
  if (!check.exists) throw new OpenwaToolError(422, "number_not_on_whatsapp", "The number " + maskOpenwaPhoneNumber(target.number) + " is not on WhatsApp");
  const chatId = check.whatsappId && CHAT_ID.test(check.whatsappId) ? check.whatsappId : target.chatId;
  return { ...target, chatId, chatKey: openwaChatKey(chatId), isOrigin: openwaChatKey(chatId) === ctx.origin.chatKey };
}

export async function consumeReplyGrants(ctx: ToolContext): Promise<void> {
  const grantIds = ctx.openwa?.grantIds ?? [];
  if (ctx.profile === "full" || !grantIds.length) return;
  await ctx.db.transaction(async (tx) => {
    const consumed = (await tx.execute(sql`
      update chat_owner_grants set status = 'consumed', consumed_at = now(), consumed_by_run_id = ${ctx.run.id}, updated_at = now()
      where company_id = ${ctx.endpoint.companyId} and endpoint_id = ${ctx.endpoint.id} and origin_chat_key = ${ctx.origin.chatKey}
        and scope = 'one_action' and status = 'live' and category in ('reply', 'reply_outside_allowlist')
        and id in (${sql.join(grantIds.map((id) => sql`${id}::uuid`), sql`, `)})
      returning id, category
    `)) as unknown as Array<{ id: string; category: string }>;
    for (const grant of consumed)
      await logOpenwaActivity(tx, {
        companyId: ctx.endpoint.companyId,
        endpointId: ctx.endpoint.id,
        action: "openwa.grant_consumed",
        agentId: ctx.binding.agentId,
        runId: ctx.run.id,
        details: { grantId: grant.id, category: grant.category, scope: "one_action" },
      });
  });
}

async function openwaSend(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  let target = resolveTarget(ctx, args.chat);
  ctx.audit.chatKey = target.chatKey;
  const scope: OpenwaWriteScope = {
    companyId: ctx.endpoint.companyId,
    endpointId: ctx.endpoint.id,
    conversationId: ctx.conversation.id,
    issueId: ctx.binding.issueId,
    runId: ctx.binding.runId,
    tool: "openwa_send",
    idempotencyKey: String(args.idempotencyKey),
  };
  const hash = openwaToolArgsHash("openwa_send", args);
  const action = await createOpenwaWrite(ctx.db, scope, hash, { chatKey: target.chatKey });
  ctx.audit.actionId = action.id;
  if (!openwaWriteHashMatches(action, hash))
    throw new OpenwaToolError(409, "idempotency_conflict", "This idempotencyKey already belongs to a different OpenWA operation", { actionId: action.id });
  const replay = openwaWriteReplay(action);
  if (replay) return replay;
  target = await precheckNumber(ctx, target);
  ctx.audit.chatKey = target.chatKey;
  const heldGrant = typeof action.payload.grantId === "string" ? action.payload.grantId : null;
  const quote = await resolveQuote(ctx, target, args.quoteMessageId);
  const consumedGrant = await assertSendAllowed(ctx, target, heldGrant, quote);
  if (consumedGrant) await setOpenwaWriteGrant(ctx.db, action.id, consumedGrant);
  const releaseGrant = async () => {
    if (!consumedGrant) return;
    await restoreOpenwaGrant(ctx.db, { companyId: ctx.endpoint.companyId, runId: ctx.run.id, grantId: consumedGrant });
    await setOpenwaWriteGrant(ctx.db, action.id, null);
  };
  let planned: Awaited<ReturnType<typeof planSends>>;
  try {
    planned = await planSends(ctx, args, target, quote);
  } catch (error) {
    await releaseGrant();
    throw error;
  }
  const { gateway, registry } = await ctx.runtime();
  let outcome = await runOpenwaWrite(ctx.db, { action, registry, gateway, chatId: target.chatId, runId: ctx.run.id, sends: planned.sends });
  let quoteDropped = false;
  if (outcome.state === "failed" && outcome.delivered === 0 && quote && (await quotesVisibleTrigger(ctx, quote))) {
    const mapped = toolErrorFromGateway(outcome.error, true);
    if (mapped instanceof OpenwaToolError && mapped.code === "quote_unresolvable") {
      planned = await planSends(ctx, args, target, null);
      quoteDropped = true;
      outcome = await runOpenwaWrite(ctx.db, { action, registry, gateway, chatId: target.chatId, runId: ctx.run.id, sends: planned.sends });
    }
  }
  if (outcome.state === "failed") {
    if (outcome.delivered === 0) await releaseGrant();
    const mapped = toolErrorFromGateway(outcome.error, Boolean(quote) && !quoteDropped);
    if (mapped instanceof HttpError) mapped.details = { ...record(mapped.details), actionId: action.id, state: "failed" };
    throw mapped;
  }
  if (outcome.state !== "delivered")
    return {
      actionId: action.id,
      state: outcome.state,
      instruction: "The outcome is not confirmed yet. Do not send again with a new key; retry later with the same idempotencyKey to reconcile.",
    };
  const answeredTriggerIds =
    target.isOrigin && ctx.runClass
      ? await markTriggersAnswered(ctx.db, {
          companyId: ctx.endpoint.companyId,
          endpointId: ctx.endpoint.id,
          conversationId: ctx.conversation.id,
          chatKey: target.chatKey,
          quotedMessageId: quote,
          runClass: ctx.runClass,
          visibleBefore: ctx.run.visibleBefore,
          deliveryIds: ctx.openwa?.deliveryIds ?? [],
        })
      : [];
  if (target.isOrigin) await consumeReplyGrants(ctx);
  const receipt = {
    messageIds: outcome.messageIds,
    chatRef: chatRef(ctx, target.chatId),
    answeredTriggerIds,
    ...(quote && !quoteDropped ? { quotedMessageId: quote } : {}),
    ...(quoteDropped ? { quoteDropped: true } : {}),
  };
  await finishOpenwaWrite(ctx.db, action, receipt);
  await auditSafely(ctx, {
    kind: "message_sent",
    metadata: { source: "tool", actionId: action.id, kind: planned.kind, messageIds: outcome.messageIds, quotedMessageId: quoteDropped ? null : quote, ...(quoteDropped ? { quoteDropped: true } : {}) },
    content: planned.text === null ? null : { text: planned.text },
  });
  return { actionId: action.id, state: "delivered", ...receipt };
}

function senderView(ctx: Pick<ToolContext, "sessionId">, jid: string | null | undefined, name: unknown, phone?: unknown) {
  const id = str(jid);
  const digits = phoneDigits(id) ?? (typeof phone === "string" && /^\d{5,}$/.test(phone) ? phone : null);
  return {
    ref: id && /@(c\.us|lid|s\.whatsapp\.net)$/i.test(id) ? chatRef(ctx, openwaChatKey(id)) : null,
    phone: digits ? maskOpenwaPhoneNumber(digits) : null,
    name: displayName(name),
  };
}

function textView(value: unknown) {
  const text = typeof value === "string" ? value : "";
  const clipped = clip(text, READ_TEXT_LIMIT);
  return clipped.truncated ? { text: clipped.text, textTruncated: true } : { text: clipped.text };
}

function mentionView(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 50)
        .map((jid) => (phoneDigits(jid) ? maskOpenwaPhoneNumber(phoneDigits(jid)!) : maskOpenwaDigits(jid)))
    : [];
}

function locationView(value: unknown) {
  const location = record(value);
  const lat = Number(location.latitude ?? location.lat);
  const lng = Number(location.longitude ?? location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = str(location.description) ?? str(location.name);
  return name ? { lat, lng, name: clip(name, 200).text } : { lat, lng };
}

function quotedView(value: unknown) {
  const quoted = record(value);
  const id = str(quoted.id) ?? str(quoted.waMessageId);
  if (!id) return null;
  return { id, text: clip(typeof quoted.body === "string" ? quoted.body : "", 200).text };
}

function storedView(ctx: ToolContext, message: OpenwaStoredMessage) {
  const metadata = record(message.metadata);
  const fromMe = message.direction === "outgoing";
  return {
    id: message.waMessageId ?? "row:" + message.id,
    fromMe,
    sender: fromMe ? null : senderView(ctx, message.author ?? message.from, metadata.pushName ?? metadata.senderName),
    type: message.type,
    timestamp: message.timestamp ?? Math.floor(Date.parse(message.createdAt) / 1000),
    ...textView(message.body),
    quoted: quotedView(metadata.quotedMessage ?? metadata.quoted),
    mentions: mentionView(metadata.mentionedIds),
    media: message.mediaMimetype ? { mime: message.mediaMimetype } : null,
    location: locationView(metadata.location),
  };
}

export function liveView(ctx: Pick<ToolContext, "sessionId">, message: OpenwaHistoryMessage) {
  const media = record(message.media);
  const contact = record(message.contact);
  return {
    id: message.id,
    fromMe: message.fromMe,
    sender: message.fromMe
      ? null
      : senderView(ctx, message.author ?? message.from, contact.name ?? contact.pushName, message.senderPhone),
    type: message.type,
    timestamp: message.timestamp,
    ...textView(message.body),
    quoted: quotedView(message.quotedMessage),
    mentions: mentionView(message.mentionedIds),
    media: str(media.mimetype)
      ? { mime: str(media.mimetype), ...(str(media.filename) ? { filename: str(media.filename) } : {}), ...(typeof media.sizeBytes === "number" ? { size: media.sizeBytes } : {}) }
      : null,
    location: locationView(message.location),
  };
}

export function fitPage<T>(envelope: Record<string, unknown>, items: T[]): { page: T[]; truncated: boolean } {
  const budget = OPENWA_TOOL_RESULT_LIMIT_BYTES - bytes(envelope) - RESULT_ENVELOPE_BYTES;
  let used = 0;
  const page: T[] = [];
  for (const item of items) {
    const size = bytes(item) + 1;
    if (used + size > budget && page.length > 0) return { page, truncated: true };
    used += size;
    page.push(item);
  }
  return { page, truncated: false };
}

async function openwaReadChat(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  const target = resolveTarget(ctx, args.chat);
  ctx.audit.chatKey = target.chatKey;
  await assertReadable(ctx, target);
  const cursor = str(args.cursor);
  const source = args.source === "live" || (args.source === undefined && cursor?.startsWith("l:")) ? "live" : "stored";
  const deep = args.deep === true;
  const limit = Math.min(Number(args.limit ?? 50), deep ? DEEP_LIMIT : LIVE_LIMIT);
  const ref = chatRef(ctx, target.chatId);
  if (source === "stored") {
    if (cursor && !cursor.startsWith("s:")) throw new OpenwaToolError(400, "invalid_cursor", "The cursor belongs to the live source");
    const after = cursor ? cursor.slice(2) : null;
    const page = await gatewayCall(ctx, (gateway) => gateway.listStoredMessages({ chatId: target.chatId, limit: Math.min(limit, LIVE_LIMIT), after, inlineMedia: false }));
    const views = page.messages.map((message) => ({ row: message.id, view: storedView(ctx, message) }));
    const envelope = { chatRef: ref, source };
    const fitted = fitPage(envelope, views.map((entry) => entry.view));
    const last = views[fitted.page.length - 1];
    const more = fitted.truncated || page.messages.length >= Math.min(limit, LIVE_LIMIT);
    return { ...envelope, messages: fitted.page, nextCursor: more && last ? "s:" + last.row : null, ...(fitted.truncated ? { truncated: true } : {}) };
  }
  if (cursor && !cursor.startsWith("l:")) throw new OpenwaToolError(400, "invalid_cursor", "The cursor belongs to the stored source");
  const offset = cursor ? Number(cursor.slice(2)) : 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= DEEP_LIMIT) throw new OpenwaToolError(400, "invalid_cursor", "The cursor is malformed");
  const want = Math.min(offset + limit, deep || offset + limit > LIVE_LIMIT ? DEEP_LIMIT : LIVE_LIMIT);
  const history = await gatewayCall(ctx, (gateway) =>
    gateway.chatHistory({ chatId: target.chatId, limit: want, deep: deep || want > LIVE_LIMIT, includeMedia: false }),
  );
  const ordered = [...history].sort((a, b) => b.timestamp - a.timestamp).slice(offset, offset + limit);
  const envelope = { chatRef: ref, source };
  const fitted = fitPage(envelope, ordered.map((message) => liveView(ctx, message)));
  const consumed = offset + fitted.page.length;
  const more = fitted.truncated || (history.length >= want && consumed < DEEP_LIMIT);
  return { ...envelope, messages: fitted.page, nextCursor: more ? "l:" + consumed : null, ...(fitted.truncated ? { truncated: true } : {}) };
}

function mediaView(item: OpenwaIngestedMedia, localPaths: ReadonlyMap<string, string>) {
  const transcript = item.transcript ? clip(item.transcript, TRANSCRIPT_LIMIT) : null;
  const localPath = item.attachmentId ? localPaths.get(item.attachmentId) : undefined;
  return {
    kind: item.kind,
    status: item.status,
    ...(item.reason ? { reason: item.reason } : {}),
    ...(item.limitBytes ? { limitBytes: item.limitBytes } : {}),
    attachmentId: item.attachmentId,
    ...(localPath ? { localPath } : item.attachmentId ? { contentPath: "/api/attachments/" + item.attachmentId + "/content" } : {}),
    mime: item.mime,
    size: item.size,
    ...(item.filename ? { filename: item.filename } : {}),
    ...(item.transcriptStatus ? { transcriptStatus: item.transcriptStatus } : {}),
    ...(transcript ? { transcript: transcript.text, ...(transcript.truncated || item.transcriptTruncated ? { transcriptTruncated: true } : {}) } : {}),
    ...(item.transcriptAttachmentId ? { transcriptAttachmentId: item.transcriptAttachmentId } : {}),
    ...(item.location ? { location: { lat: item.location.lat, lng: item.location.lng, name: item.location.name } } : {}),
    ...(item.contact ? { contact: { name: item.contact.name, phones: item.contact.numbers.slice(0, 10).map((entry) => maskOpenwaPhoneNumber(entry)) } } : {}),
  };
}

async function refuseLinkedChatRef(ctx: ToolContext, ref: unknown): Promise<void> {
  const match = CHAT_REF.exec(str(ref) ?? "");
  if (!match || match[1] === ctx.sessionId) return;
  const [linked] = await ctx.db
    .select({ id: chatOpenwaLinkedSessions.id })
    .from(chatOpenwaLinkedSessions)
    .where(
      and(
        eq(chatOpenwaLinkedSessions.companyId, ctx.endpoint.companyId),
        eq(chatOpenwaLinkedSessions.endpointId, ctx.endpoint.id),
        eq(chatOpenwaLinkedSessions.sessionId, match[1]!),
      ),
    )
    .limit(1);
  if (linked) throw new OpenwaToolError(400, "invalid_target", "This chat is on a linked number; use openwa_linked_get_media with its linkedRef");
}

export async function openwaMediaResult(
  ctx: ToolContext,
  handle: OpenwaToolRuntimeHandle,
  envelope: Record<string, unknown>,
  items: OpenwaIngestedMedia[],
): Promise<Record<string, unknown>> {
  const localPaths = await openwaAttachmentLocalPaths(
    ctx.db,
    handle.storage ?? getStorageService(),
    ctx.endpoint.companyId,
    items.flatMap((item) => (item.status === "stored" && item.attachmentId ? [item.attachmentId] : [])),
  );
  const fitted = fitMedia(envelope, items.map((item) => mediaView(item, localPaths)));
  return { ...envelope, media: fitted.media, ...(fitted.omitted ? { truncated: true, omittedMedia: fitted.omitted } : {}) };
}

async function openwaGetMedia(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  await refuseLinkedChatRef(ctx, args.chat);
  const target = resolveTarget(ctx, args.chat);
  ctx.audit.chatKey = target.chatKey;
  await assertReadable(ctx, target);
  const messageId = await resolveQuote(ctx, target, args.messageId).catch((error) => {
    if (error instanceof OpenwaToolError && error.code === "quote_unresolvable")
      throw new OpenwaToolError(404, "not_found", "The message is not in this chat");
    throw error;
  });
  const handle = await ctx.runtime();
  if (!handle.media) throw new OpenwaToolError(503, "gateway_unavailable", "OpenWA media handling is not available in this process");
  const items = await handle.media.fetchOpenwaMessageMedia({
    endpoint: ctx.endpoint,
    client: handle.gateway,
    issueId: ctx.binding.issueId,
    chatId: target.chatId,
    messageId: messageId!,
  });
  return openwaMediaResult(ctx, handle, { chatRef: chatRef(ctx, target.chatId), messageId }, items);
}

function fitMedia(envelope: Record<string, unknown>, views: Array<ReturnType<typeof mediaView>>): { media: Array<ReturnType<typeof mediaView>>; omitted: number } {
  const budget = OPENWA_TOOL_RESULT_LIMIT_BYTES - bytes(envelope) - RESULT_ENVELOPE_BYTES;
  let used = 0;
  const media: Array<ReturnType<typeof mediaView>> = [];
  for (const [index, view] of views.entries()) {
    const room = Math.floor((budget - used) / (views.length - index)) - 1;
    let fitted = view;
    if (bytes(fitted) > room && typeof fitted.transcript === "string") {
      const chars = [...fitted.transcript];
      do {
        const over = bytes({ ...fitted, transcript: chars.join("") + "…", transcriptTruncated: true }) - room;
        if (over <= 0) break;
        chars.length = Math.max(0, chars.length - Math.max(1, Math.ceil(over / 4)));
      } while (chars.length > 0);
      fitted = { ...fitted, transcript: chars.join("") + "…", transcriptTruncated: true };
    }
    if (bytes(fitted) > room) return { media, omitted: views.length - index };
    used += bytes(fitted) + 1;
    media.push(fitted);
  }
  return { media, omitted: 0 };
}

function matches(query: string, ...values: unknown[]): boolean {
  const needle = query.toLowerCase();
  const digits = query.replace(/\D/g, "");
  return values.some((value) => {
    if (typeof value !== "string" || !value) return false;
    if (value.toLowerCase().includes(needle)) return true;
    return digits.length >= 4 && value.replace(/\D/g, "").includes(digits);
  });
}

async function openwaFind(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  if (typeof args.phone === "string") {
    const digits = args.phone.replace(/^\+/, "");
    const check = await gatewayCall(ctx, (gateway) => gateway.checkNumber(digits));
    const chatId = check.whatsappId && CHAT_ID.test(check.whatsappId) ? check.whatsappId : digits + "@c.us";
    return { phone: maskOpenwaPhoneNumber(digits), exists: check.exists, chatRef: check.exists ? chatRef(ctx, openwaChatKey(chatId)) : null };
  }
  if (typeof args.lid === "string") {
    const lid = args.lid;
    const resolved = await gatewayCall(ctx, (gateway) => gateway.contactPhone(lid));
    const owner = resolved.phone ? await ownerPrincipal(ctx, resolved.phone) : false;
    return {
      lid: chatRef(ctx, lid),
      phone: resolved.phone ? maskOpenwaPhoneNumber(resolved.phone) : null,
      chatRef: resolved.phone ? chatRef(ctx, resolved.phone + "@c.us") : null,
      ...(owner ? { role: "owner" } : {}),
    };
  }
  const query = String(args.query);
  const cursor = str(args.cursor);
  const offset = cursor ? Number(cursor.slice(2)) : 0;
  if (cursor && (!cursor.startsWith("f:") || !Number.isInteger(offset) || offset <= 0 || offset >= FIND_LIMIT * 2))
    throw new OpenwaToolError(400, "invalid_cursor", "The cursor is malformed");
  const [contactsResult, chatsResult] = await gatewayCall(ctx, (gateway) =>
    Promise.all([gateway.call("ContactController_findAll", { limit: "1000" }), gateway.call("SessionController_getChats", { limit: "1000" })]),
  );
  const list = (result: unknown) => {
    const data = record(result).data;
    return Array.isArray(data) ? data.map(record) : [];
  };
  const enabled = ctx.policy.numberMode === "owner_number" ? await enabledChatKeys(ctx) : null;
  const chats = list(chatsResult)
    .filter((chat) => typeof chat.id === "string" && CHAT_ID.test(chat.id))
    .filter((chat) => !enabled || enabled.has(openwaChatKey(String(chat.id))))
    .filter((chat) => matches(query, chat.name, chat.id))
    .slice(0, FIND_LIMIT)
    .map((chat) => ({ chatRef: chatRef(ctx, openwaChatKey(String(chat.id))), name: displayName(chat.name), kind: String(chat.id).endsWith("@g.us") ? "group" : "dm" }));
  const contacts = list(contactsResult)
    .filter((contact) => typeof contact.id === "string" && CHAT_ID.test(contact.id))
    .filter((contact) => matches(query, contact.name, contact.pushName, contact.number))
    .slice(0, FIND_LIMIT)
    .map((contact) => {
      const digits = str(contact.number) ?? phoneDigits(String(contact.id));
      return {
        chatRef: chatRef(ctx, openwaChatKey(String(contact.id))),
        name: displayName(contact.name ?? contact.pushName),
        phone: digits ? maskOpenwaPhoneNumber(digits) : null,
      };
    });
  const remaining = [...chats.map((chat) => ({ chat })), ...contacts.map((contact) => ({ contact }))].slice(offset);
  const fitted = fitPage({ query, nextCursor: "f:" + FIND_LIMIT * 2 }, remaining);
  return {
    query,
    chats: fitted.page.flatMap((entry) => ("chat" in entry ? [entry.chat] : [])),
    contacts: fitted.page.flatMap((entry) => ("contact" in entry ? [entry.contact] : [])),
    nextCursor: fitted.truncated ? "f:" + (offset + fitted.page.length) : null,
    ...(fitted.truncated ? { truncated: true } : {}),
  };
}

async function openwaStaySilent(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  const runClass = requireConversationRun(ctx);
  const listed = Array.isArray(args.triggerIds) ? (args.triggerIds as string[]) : null;
  const rows = await ctx.db
    .update(chatDeliveries)
    .set({ answerState: "silenced", updatedAt: new Date() })
    .where(
      listed
        ? and(
            eq(chatDeliveries.companyId, ctx.endpoint.companyId),
            eq(chatDeliveries.endpointId, ctx.endpoint.id),
            eq(chatDeliveries.conversationId, ctx.conversation.id),
            eq(chatDeliveries.answerState, "pending"),
            inArray(chatDeliveries.id, listed),
          )
        : and(visibleTriggerScope(ctx), eq(chatDeliveries.triggerClass, runClass)),
    )
    .returning({ id: chatDeliveries.id });
  const silenced = rows.map((row) => row.id);
  const skipped = listed ? listed.filter((id) => !silenced.includes(id)) : [];
  return { silenced, ...(skipped.length ? { notPending: skipped } : {}) };
}

async function openwaHandoff(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  requireConversationRun(ctx);
  const listed = [...new Set(args.triggerIds as string[])].sort();
  const note = String(args.note);
  return ctx.db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: chatDeliveries.id, triggerClass: chatDeliveries.triggerClass, answerState: chatDeliveries.answerState })
      .from(chatDeliveries)
      .where(
        and(
          eq(chatDeliveries.companyId, ctx.endpoint.companyId),
          eq(chatDeliveries.endpointId, ctx.endpoint.id),
          eq(chatDeliveries.conversationId, ctx.conversation.id),
          inArray(chatDeliveries.id, listed),
        ),
      )
      .for("update");
    const notOwner = listed.filter((id) => candidates.find((row) => row.id === id)?.triggerClass !== "owner");
    if (notOwner.length)
      throw new OpenwaToolError(422, "owner_only", "Only owner triggers of this chat can be handed off", { triggerIds: notOwner });
    const pending = candidates.filter((row) => row.answerState === "pending").map((row) => row.id);
    const handedOff = pending.length
      ? (
          await tx
            .update(chatDeliveries)
            .set({ answerState: "handed_off", updatedAt: new Date() })
            .where(and(eq(chatDeliveries.endpointId, ctx.endpoint.id), inArray(chatDeliveries.id, pending), eq(chatDeliveries.answerState, "pending")))
            .returning({ id: chatDeliveries.id })
        ).map((row) => row.id)
      : [];
    const providerActionId = "openwa-handoff:" + ctx.run.id + ":" + createHash("sha256").update(listed.join(",")).digest("hex").slice(0, 32);
    const [stored] = await tx
      .insert(chatActions)
      .values({
        companyId: ctx.endpoint.companyId,
        endpointId: ctx.endpoint.id,
        conversationId: ctx.conversation.id,
        kind: OPENWA_HANDOFF_ACTION_KIND,
        providerActionId,
        status: "received",
        payload: { version: 1, runId: ctx.run.id, issueId: ctx.conversation.issueId, chatKey: ctx.origin.chatKey, triggerIds: handedOff, note },
      })
      .onConflictDoUpdate({
        target: [chatActions.endpointId, chatActions.providerActionId],
        set: { payload: { version: 1, runId: ctx.run.id, issueId: ctx.conversation.issueId, chatKey: ctx.origin.chatKey, triggerIds: handedOff, note }, updatedAt: new Date() },
      })
      .returning({ id: chatActions.id });
    ctx.audit.actionId = stored!.id;
    const skipped = listed.filter((id) => !handedOff.includes(id));
    return { handedOff, handoffId: stored!.id, ...(skipped.length ? { notPending: skipped } : {}) };
  });
}

export async function auditSafely(
  ctx: ToolContext,
  entry: { kind: "tool_called" | "message_sent"; metadata: Record<string, unknown>; content: Record<string, unknown> | null },
): Promise<void> {
  try {
    await recordOpenwaAudit(ctx.db, {
      companyId: ctx.endpoint.companyId,
      endpointId: ctx.endpoint.id,
      kind: entry.kind,
      actorKind: "agent",
      actorRef: ctx.binding.agentId,
      chatKey: ctx.audit.chatKey,
      conversationId: ctx.conversation.id,
      runId: ctx.run.id,
      metadata: entry.metadata,
      content: entry.content && redactOpenwaSecrets(entry.content),
      retentionDays: ctx.policy.auditContentRetentionDays,
    });
  } catch (error) {
    logger.warn({ err: error, endpointId: ctx.endpoint.id, runId: ctx.run.id }, "failed to record OpenWA tool audit");
  }
}

const EXECUTORS: Record<string, (ctx: ToolContext, args: Args) => Promise<Record<string, unknown>>> = {
  openwa_send: openwaSend,
  openwa_read_chat: openwaReadChat,
  openwa_get_media: openwaGetMedia,
  openwa_find: openwaFind,
  openwa_request_approval: (ctx, args) => openwaRequestApprovalTool(ctx, args),
  openwa_approval_resolve: (ctx, args) => openwaApprovalResolveTool(ctx, args),
  openwa_approval_withdraw: (ctx, args) => openwaApprovalWithdrawTool(ctx, args),
  openwa_stay_silent: openwaStaySilent,
  openwa_handoff: openwaHandoff,
  openwa_catalog: (ctx, args) => openwaCatalogTool(ctx, args),
  openwa_endpoint_config: (ctx, args) => openwaEndpointConfigTool(ctx, args),
  openwa_autonomy_window: (ctx, args) => openwaAutonomyWindowTool(ctx, args),
  openwa_describe: (ctx, args) => openwaDescribeTool(ctx, args),
  openwa_call: (ctx, args) => openwaCallTool(ctx, args),
  openwa_linked_list: (ctx) => openwaLinkedListTool(ctx, openwaToolLinked(ctx.db)),
  openwa_linked_read: (ctx, args) => openwaLinkedReadTool(ctx, openwaToolLinked(ctx.db), args),
  openwa_linked_get_media: (ctx, args) => openwaLinkedGetMediaTool(ctx, openwaToolLinked(ctx.db), args),
};

const LINKED_TOOLS = new Set(["openwa_linked_list", "openwa_linked_read", "openwa_linked_get_media"]);

function linkedResultSummary(result: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(result.messages)) return { linkedRef: result.linkedRef ?? null, chatRef: result.chatRef ?? null, count: result.messages.length };
  if (Array.isArray(result.media)) return { linkedRef: result.linkedRef ?? null, chatRef: result.chatRef ?? null, messageId: result.messageId ?? null, count: result.media.length };
  return { count: Array.isArray(result.linked) ? result.linked.length : 0 };
}

const MANIFEST_ONLY_TOOLS = new Set(["openwa_catalog", "openwa_describe"]);

export async function executeOpenwaTool(db: Db, binding: OpenwaToolBinding, name: string, value: unknown): Promise<Record<string, unknown>> {
  const tool = openwaTool(name);
  const execute = EXECUTORS[name];
  if (!tool || !execute) throw forbidden("Unknown OpenWA tool");
  const config = name === "openwa_endpoint_config";
  let args: Args = config ? record(value) : (tool.schema.parse(value) as Args);
  const ctx = await resolveContext(db, binding);
  const started = performance.now();
  try {
    if (config) {
      assertOpenwaConfigOwnerRun(ctx);
      refuseOpenwaUiOnlyConfig(value);
      args = tool.schema.parse(value) as Args;
    }
    const output = await execute(ctx, args);
    const result = MANIFEST_ONLY_TOOLS.has(name) ? output : redactOpenwaSecrets(output);
    await auditSafely(ctx, {
      kind: "tool_called",
      metadata: {
        tool: name,
        latencyMs: Math.round(performance.now() - started),
        errorCode: null,
        actionId: ctx.audit.actionId,
        ...(ctx.audit.operation ? { operation: ctx.audit.operation } : {}),
      },
      content: { args, resultSummary: LINKED_TOOLS.has(name) ? linkedResultSummary(result) : result },
    });
    return result;
  } catch (error) {
    const details = error instanceof HttpError ? record(error.details) : {};
    const errorCode =
      typeof details.code === "string"
        ? details.code
        : error instanceof HttpError
          ? "http_" + error.status
          : (error as { name?: unknown } | null)?.name === "ZodError"
            ? "invalid_arguments"
            : "internal_error";
    await auditSafely(ctx, {
      kind: "tool_called",
      metadata: {
        tool: name,
        latencyMs: Math.round(performance.now() - started),
        errorCode,
        actionId: ctx.audit.actionId,
        ...(ctx.audit.operation ? { operation: ctx.audit.operation } : {}),
        ...(details.pacing === true ? { pacing: true } : {}),
      },
      content: { args, resultSummary: { error: error instanceof Error ? error.message : String(error) } },
    });
    throw error;
  }
}

export function openwaToolErrorBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpError) {
    const details = record(error.details);
    return redactOpenwaSecrets({ error: typeof details.code === "string" ? details.code : "http_" + error.status, message: error.message, ...details });
  }
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "ZodError")
    return { error: "invalid_arguments", issues: (error as { issues?: unknown }).issues };
  return { error: "internal_error", message: error instanceof Error ? error.message : String(error) };
}
