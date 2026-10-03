import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import {
  agentWakeupRequests,
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  heartbeatRuns,
  issueWorkProducts,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  OPENWA_APPROVAL_CATEGORIES,
  OPENWA_TRIGGER_CLASSES,
  openwaEndpointPolicySchema,
  type OpenwaApprovalCategory,
  type OpenwaEndpointPolicy,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import { RUN_TOOL_PROFILE_CONTEXT_KEY } from "@tickernelz/paperclip-pro-adapter-utils";
import { HttpError, forbidden } from "../../errors.js";
import { openwaPrincipalAuthorization } from "./owners.js";
import { logOpenwaActivity } from "./audit.js";

export const OPENWA_RUN_CONTEXT_KEY = "paperclipOpenwa";
export const OPENWA_APPROVAL_REQUIRED_CODE = "openwa_approval_required";
export const OPENWA_AGENT_KEY_READ_ONLY_CODE = "openwa_agent_key_read_only";

export type OpenwaRunProfile = "full" | "read_only";

export interface OpenwaRunContext {
  endpointId: string;
  chatKey: string;
  triggerClass: OpenwaTriggerClass;
  profile: OpenwaRunProfile;
  toolProfile: OpenwaRunProfile;
  event: string | null;
  grantIds: string[];
  deliveryIds: string[];
  runAllowedCategories: OpenwaApprovalCategory[];
  grantedCategories: OpenwaApprovalCategory[];
  requesterPrincipalId: string | null;
  approvalRequestId: string | null;
  triggerPrincipalId: string | null;
}

export class OpenwaApprovalRequiredError extends HttpError {
  readonly category: OpenwaApprovalCategory;

  constructor(category: OpenwaApprovalCategory) {
    super(403, `Owner approval is required for ${category}`, {
      code: OPENWA_APPROVAL_REQUIRED_CODE,
      category,
      hint: "Ask an endpoint owner with openwa_request_approval, then continue in the approved run.",
    });
    this.category = category;
  }
}

type RunLike = { id: string; companyId: string; contextSnapshot: unknown };
type GrantScope = { companyId: string; runId: string; grantIds: Set<string> };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BINDING_CACHE_LIMIT = 10_000;
const BINDING_CACHE_TTL_MS = 5 * 60_000;
const AGENT_KEY_CACHE_LIMIT = 2_000;
const AGENT_KEY_CACHE_TTL_MS = 30_000;
const EVENT_PATTERN = /^[a-z_]{1,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVAL_TOGGLES: Record<OpenwaApprovalCategory, keyof OpenwaEndpointPolicy["approvals"]> = {
  create_task: "createTask",
  external_tools: "externalTools",
  cross_chat_send: "crossChatSend",
  wa_admin: "waAdmin",
  gateway_admin: "gatewayAdmin",
};
const bindingCache = new WeakMap<Db, Map<string, { bound: boolean; at: number }>>();
const agentKeyCache = new WeakMap<Db, Map<string, { bound: boolean; at: number }>>();
const grantScopes = new AsyncLocalStorage<GrantScope>();

export function openwaRunAuthoritySnapshot() {
  return sql<Record<string, unknown> | null>`jsonb_build_object(
  'paperclipOpenwa', ${heartbeatRuns.contextSnapshot} -> 'paperclipOpenwa',
  'paperclipToolProfile', ${heartbeatRuns.contextSnapshot} -> 'paperclipToolProfile',
  'issueId', ${heartbeatRuns.contextSnapshot} -> 'issueId',
  'taskId', ${heartbeatRuns.contextSnapshot} -> 'taskId')`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function triggerClass(value: unknown): OpenwaTriggerClass | null {
  return OPENWA_TRIGGER_CLASSES.includes(value as OpenwaTriggerClass)
    ? (value as OpenwaTriggerClass)
    : null;
}

function runProfile(value: unknown): OpenwaRunProfile | null {
  return value === "full" ? "full" : value === "read_only" ? "read_only" : null;
}

function uuids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && UUID_PATTERN.test(entry)))];
}

function approvalCategories(value: unknown): OpenwaApprovalCategory[] {
  if (!Array.isArray(value)) return [];
  return OPENWA_APPROVAL_CATEGORIES.filter((category) => value.includes(category));
}

function cacheGet(cache: WeakMap<Db, Map<string, { bound: boolean; at: number }>>, db: Db, key: string, ttl: number) {
  const entry = cache.get(db)?.get(key);
  return entry && Date.now() - entry.at < ttl ? entry.bound : null;
}

function cacheSet(cache: WeakMap<Db, Map<string, { bound: boolean; at: number }>>, db: Db, key: string, bound: boolean, limit: number) {
  let map = cache.get(db);
  if (!map) {
    map = new Map();
    cache.set(db, map);
  }
  map.delete(key);
  map.set(key, { bound, at: Date.now() });
  if (map.size > limit) map.delete(map.keys().next().value!);
}

function normalizeChatKey(value: string): string {
  const chatId = value.trim().toLowerCase();
  return chatId.endsWith("@s.whatsapp.net") ? chatId.slice(0, -"@s.whatsapp.net".length) + "@c.us" : chatId;
}

function chatKeyFromConversation(externalConversationId: string): string {
  const match = /^openwa:[^:]+:(.+)$/.exec(externalConversationId);
  return normalizeChatKey(match?.[1] ?? externalConversationId);
}

function parsePolicy(value: unknown): OpenwaEndpointPolicy {
  const parsed = openwaEndpointPolicySchema.safeParse(value ?? {});
  return (parsed.success ? parsed.data : openwaEndpointPolicySchema.parse({})) as OpenwaEndpointPolicy;
}

/** Splits categories into allowed (full run, granted, or approval toggle off), approval-required and unavailable. */
export function openwaAllowedCategories(
  policy: Pick<OpenwaEndpointPolicy, "approvals"> | null,
  profile: OpenwaRunProfile,
  grantCategories: readonly string[],
  gatewayAdminTools: OpenwaEndpointPolicy["gatewayAdminTools"],
): { allowed: OpenwaApprovalCategory[]; approvalRequired: OpenwaApprovalCategory[]; unavailable: OpenwaApprovalCategory[] } {
  const unavailable: OpenwaApprovalCategory[] = gatewayAdminTools === "off" ? ["gateway_admin"] : [];
  const granted = new Set(grantCategories);
  const allowed: OpenwaApprovalCategory[] = [];
  const approvalRequired: OpenwaApprovalCategory[] = [];
  for (const category of OPENWA_APPROVAL_CATEGORIES) {
    if (unavailable.includes(category)) continue;
    if (profile === "full" || granted.has(category) || policy?.approvals[APPROVAL_TOGGLES[category]] === false) allowed.push(category);
    else approvalRequired.push(category);
  }
  return { allowed, approvalRequired, unavailable };
}

/** Reads the normalized OpenWA run context written at run start, or null for other runs. */
export function readOpenwaRunContext(contextSnapshot: unknown): OpenwaRunContext | null {
  const raw = record(record(contextSnapshot)[OPENWA_RUN_CONTEXT_KEY]);
  const endpointId = text(raw.endpointId);
  const chatKey = text(raw.chatKey);
  const cls = triggerClass(raw.triggerClass);
  const profile = runProfile(raw.profile);
  if (!endpointId || !chatKey || !cls || !profile) return null;
  const event = text(raw.event);
  return {
    endpointId,
    chatKey,
    triggerClass: cls,
    profile,
    toolProfile: profile === "full" ? "full" : (runProfile(raw.toolProfile) ?? "read_only"),
    event: event && EVENT_PATTERN.test(event) ? event : null,
    grantIds: uuids(raw.grantIds),
    deliveryIds: uuids(raw.deliveryIds),
    runAllowedCategories: approvalCategories(raw.runAllowedCategories),
    grantedCategories: approvalCategories(raw.grantedCategories),
    requesterPrincipalId: text(raw.requesterPrincipalId),
    approvalRequestId: text(raw.approvalRequestId),
    triggerPrincipalId: text(raw.triggerPrincipalId),
  };
}

async function openwaConversationBinding(db: Db, companyId: string, issueId: string) {
  const [row] = await db
    .select({
      endpointId: chatConversations.endpointId,
      conversationId: chatConversations.id,
      externalConversationId: chatConversations.externalConversationId,
      isDirectMessage: chatConversations.isDirectMessage,
      companyId: chatEndpoints.companyId,
      id: chatEndpoints.id,
      policy: chatEndpoints.policy,
      status: chatEndpoints.status,
    })
    .from(chatConversations)
    .innerJoin(chatEndpoints, and(
      eq(chatEndpoints.companyId, chatConversations.companyId),
      eq(chatEndpoints.id, chatConversations.endpointId),
    ))
    .where(and(
      eq(chatConversations.companyId, companyId),
      eq(chatConversations.issueId, issueId),
      eq(chatEndpoints.provider, "openwa"),
    ))
    .limit(1);
  return row ?? null;
}

/** True when the issue is bound by a chat conversation to an OpenWA endpoint of the same company. */
export async function isOpenwaConversationIssue(db: Db, companyId: string, issueId: string): Promise<boolean> {
  const key = `${companyId}:${issueId}`;
  const cached = cacheGet(bindingCache, db, key, BINDING_CACHE_TTL_MS);
  if (cached !== null) return cached;
  const bound = (await openwaConversationBinding(db, companyId, issueId)) !== null;
  cacheSet(bindingCache, db, key, bound, BINDING_CACHE_LIMIT);
  return bound;
}

export interface OpenwaWakeAction {
  event: string | null;
  deliveryIds: string[];
  approvalRequestId: string | null;
}

/** payload.openwa of the chat action whose id is the wake request id, on the issue's endpoint and conversation. */
export async function loadOpenwaWakeAction(
  db: Db,
  input: { companyId: string; endpointId: string; conversationId: string; wakeupRequestId: string | null },
): Promise<OpenwaWakeAction | null> {
  if (!input.wakeupRequestId) return null;
  const [row] = await db
    .select({ openwa: sql<unknown>`${chatActions.payload} -> 'openwa'` })
    .from(chatActions)
    .where(and(
      eq(chatActions.id, input.wakeupRequestId),
      eq(chatActions.companyId, input.companyId),
      eq(chatActions.endpointId, input.endpointId),
      eq(chatActions.conversationId, input.conversationId),
    ))
    .limit(1);
  if (!row || !row.openwa || typeof row.openwa !== "object" || Array.isArray(row.openwa)) return null;
  const raw = row.openwa as Record<string, unknown>;
  const event = text(raw.event);
  return {
    event: event && EVENT_PATTERN.test(event) ? event : null,
    deliveryIds: uuids(raw.deliveryIds),
    approvalRequestId: uuid(raw.approvalRequestId),
  };
}

function hasBoardProvenance(
  wake: { requestedByActorType: string | null; requestedByActorId: string | null; idempotencyKey: string | null; payload: unknown } | undefined,
  contextSnapshot: Record<string, unknown>,
): boolean {
  if (!wake || wake.requestedByActorType !== "user" || !text(wake.requestedByActorId)) return false;
  if (wake.idempotencyKey?.startsWith("chat-inbound:")) return false;
  if (text(contextSnapshot.source)?.startsWith("chat:")) return false;
  if (record(wake.payload).chatFailedRunRetry !== undefined || contextSnapshot.chatFailedRunRetry !== undefined) return false;
  return true;
}

async function chatActionBacked(db: Db, companyId: string, wakeupRequestId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(and(eq(chatActions.id, wakeupRequestId), eq(chatActions.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}

/** Resolves the run's OpenWA authority from server-written wake records at run start; null off OpenWA issues. */
export async function resolveOpenwaRunContext(
  db: Db,
  input: { companyId: string; issueId: string; runId: string; contextSnapshot: Record<string, unknown>; wakeupRequestId: string | null },
): Promise<OpenwaRunContext | null> {
  const binding = await openwaConversationBinding(db, input.companyId, input.issueId);
  cacheSet(bindingCache, db, `${input.companyId}:${input.issueId}`, binding !== null, BINDING_CACHE_LIMIT);
  if (!binding) return null;
  const chatKey = chatKeyFromConversation(binding.externalConversationId);
  const policy = parsePolicy(binding.policy);
  const [wakeAction, wake] = input.wakeupRequestId
    ? await Promise.all([
        loadOpenwaWakeAction(db, {
          companyId: input.companyId,
          endpointId: binding.endpointId,
          conversationId: binding.conversationId,
          wakeupRequestId: input.wakeupRequestId,
        }),
        db
          .select({
            requestedByActorType: agentWakeupRequests.requestedByActorType,
            requestedByActorId: agentWakeupRequests.requestedByActorId,
            idempotencyKey: agentWakeupRequests.idempotencyKey,
            payload: agentWakeupRequests.payload,
          })
          .from(agentWakeupRequests)
          .where(and(eq(agentWakeupRequests.id, input.wakeupRequestId), eq(agentWakeupRequests.companyId, input.companyId)))
          .limit(1)
          .then((rows) => rows[0]),
      ])
    : [null, undefined];
  const base = { endpointId: binding.endpointId, chatKey };
  if (
    !wakeAction &&
    hasBoardProvenance(wake, input.contextSnapshot) &&
    !(await chatActionBacked(db, input.companyId, input.wakeupRequestId!))
  ) {
    return {
      ...base,
      triggerClass: "other",
      profile: "full",
      toolProfile: "full",
      event: null,
      grantIds: [],
      deliveryIds: [],
      runAllowedCategories: openwaAllowedCategories(policy, "full", [], policy.gatewayAdminTools).allowed,
      grantedCategories: [],
      requesterPrincipalId: null,
      approvalRequestId: null,
      triggerPrincipalId: null,
    };
  }
  const deliveryIds = wakeAction?.deliveryIds ?? [];
  const deliveries = deliveryIds.length > 0
    ? await db
        .select({
          id: chatDeliveries.id,
          principalId: chatDeliveries.principalId,
          triggerClass: chatDeliveries.triggerClass,
          chatKey: sql<string | null>`${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'chatKey'`,
        })
        .from(chatDeliveries)
        .where(and(
          eq(chatDeliveries.companyId, input.companyId),
          eq(chatDeliveries.endpointId, binding.endpointId),
          inArray(chatDeliveries.id, deliveryIds),
        ))
    : [];
  const sameChat = deliveries.length > 0 && deliveries.length === deliveryIds.length &&
    deliveries.every((delivery) => delivery.principalId && delivery.chatKey && normalizeChatKey(delivery.chatKey) === chatKey);
  const principals = sameChat ? [...new Set(deliveries.map((delivery) => delivery.principalId!))] : [];
  let cls: OpenwaTriggerClass = "other";
  if (principals.length > 0 && binding.status !== "archived" && deliveries.every((delivery) => delivery.triggerClass === "owner")) {
    let owners = true;
    for (const principalId of principals) {
      const current = await db.transaction((tx) =>
        openwaPrincipalAuthorization(tx, binding, principalId, { isDirectMessage: binding.isDirectMessage }));
      if (current.role !== "owner") {
        owners = false;
        break;
      }
    }
    if (owners) cls = "owner";
  }
  const approval = wakeAction?.approvalRequestId
    ? await db
        .select({
          id: chatOwnerApprovalRequests.id,
          status: chatOwnerApprovalRequests.status,
          requesterPrincipalId: chatOwnerApprovalRequests.requestedByPrincipalId,
        })
        .from(chatOwnerApprovalRequests)
        .where(and(
          eq(chatOwnerApprovalRequests.id, wakeAction.approvalRequestId),
          eq(chatOwnerApprovalRequests.companyId, input.companyId),
          eq(chatOwnerApprovalRequests.endpointId, binding.endpointId),
          eq(chatOwnerApprovalRequests.originChatKey, chatKey),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;
  const grantRequest = cls !== "owner" && wakeAction?.event === "approval_resolved" && approval?.status === "approved" ? approval : null;
  const requesterPrincipalId = cls === "owner"
    ? null
    : grantRequest
      ? grantRequest.requesterPrincipalId
      : principals.length === 1 ? principals[0]! : null;
  const now = new Date();
  const grantFilters = [
    ...(grantRequest
      ? [and(
          eq(chatOwnerGrants.requestId, grantRequest.id),
          or(eq(chatOwnerGrants.status, "live"), and(eq(chatOwnerGrants.status, "consumed"), eq(chatOwnerGrants.consumedByRunId, input.runId))),
        )!]
      : []),
    ...(requesterPrincipalId
      ? [and(
          eq(chatOwnerGrants.scope, "requester"),
          eq(chatOwnerGrants.requesterPrincipalId, requesterPrincipalId),
          eq(chatOwnerGrants.status, "live"),
        )!]
      : []),
  ];
  const grants = cls !== "owner" && grantFilters.length > 0
    ? await db
        .select({
          id: chatOwnerGrants.id,
          requestId: chatOwnerGrants.requestId,
          category: chatOwnerGrants.category,
          scope: chatOwnerGrants.scope,
          status: chatOwnerGrants.status,
        })
        .from(chatOwnerGrants)
        .where(and(
          eq(chatOwnerGrants.companyId, input.companyId),
          eq(chatOwnerGrants.endpointId, binding.endpointId),
          eq(chatOwnerGrants.originChatKey, chatKey),
          gt(chatOwnerGrants.expiresAt, now),
          or(...grantFilters),
        ))
    : [];
  if (grantRequest && grants.some((grant) => grant.requestId === grantRequest.id)) cls = "grant";
  const runGranted: OpenwaApprovalCategory[] = [];
  if (cls === "grant") {
    for (const grant of grants) {
      if (grant.requestId !== grantRequest!.id || grant.scope !== "one_action" || grant.category !== "external_tools") continue;
      if (grant.status === "consumed") {
        runGranted.push("external_tools");
        continue;
      }
      const [consumed] = await db
        .update(chatOwnerGrants)
        .set({ status: "consumed", consumedAt: now, consumedByRunId: input.runId, updatedAt: now })
        .where(and(
          eq(chatOwnerGrants.id, grant.id),
          eq(chatOwnerGrants.companyId, input.companyId),
          eq(chatOwnerGrants.status, "live"),
          gt(chatOwnerGrants.expiresAt, now),
        ))
        .returning({ id: chatOwnerGrants.id });
      if (consumed) {
        runGranted.push("external_tools");
        await logOpenwaActivity(db, {
          companyId: input.companyId,
          endpointId: binding.endpointId,
          action: "openwa.grant_consumed",
          runId: input.runId,
          details: { grantId: consumed.id, category: "external_tools", scope: "one_action" },
        });
      }
    }
  }
  const profile: OpenwaRunProfile = cls === "owner" ? "full" : "read_only";
  const runAllowedCategories = openwaAllowedCategories(policy, profile, runGranted, policy.gatewayAdminTools).allowed;
  const requesterExternalTools = grants.some((grant) => grant.scope === "requester" && grant.category === "external_tools");
  return {
    ...base,
    triggerClass: cls,
    profile,
    toolProfile: profile === "full" || runAllowedCategories.includes("external_tools") || requesterExternalTools ? "full" : "read_only",
    event: wakeAction?.event ?? null,
    grantIds: grants.map((grant) => grant.id).sort(),
    deliveryIds: deliveries
      .filter((delivery) => delivery.chatKey && normalizeChatKey(delivery.chatKey) === chatKey)
      .map((delivery) => delivery.id),
    runAllowedCategories,
    grantedCategories: runGranted,
    requesterPrincipalId,
    approvalRequestId: approval?.id ?? null,
    triggerPrincipalId: cls === "owner"
      ? (deliveries.find((delivery) => delivery.id === deliveryIds[deliveryIds.length - 1])?.principalId ?? null)
      : null,
  };
}

/** Writes the resolved context, or the explicit non-OpenWA marker when openwa is null. */
export function applyOpenwaRunContext(context: Record<string, unknown>, openwa: OpenwaRunContext | null) {
  if (!openwa) {
    delete context[OPENWA_RUN_CONTEXT_KEY];
    context[RUN_TOOL_PROFILE_CONTEXT_KEY] = "full";
    return;
  }
  context[OPENWA_RUN_CONTEXT_KEY] = openwa;
  context[RUN_TOOL_PROFILE_CONTEXT_KEY] = openwa.toolProfile;
}

/** False for OpenWA runs with a read_only tool profile: host GitHub credentials are withheld. */
export function openwaHostGitHubAllowed(openwa: OpenwaRunContext | null): boolean {
  return openwa?.toolProfile !== "read_only";
}

export function clearOpenwaRunContext(context: Record<string, unknown>) {
  delete context[OPENWA_RUN_CONTEXT_KEY];
  delete context[RUN_TOOL_PROFILE_CONTEXT_KEY];
}

/** Run profile from the run context; unmarked runs on an OpenWA conversation issue are read_only. */
export async function openwaRunProfile(db: Db, run: RunLike): Promise<OpenwaRunProfile> {
  const context = record(run.contextSnapshot);
  const openwa = readOpenwaRunContext(context);
  if (openwa) return openwa.profile;
  if (context[OPENWA_RUN_CONTEXT_KEY] !== undefined && context[OPENWA_RUN_CONTEXT_KEY] !== null) return "read_only";
  const marker = context[RUN_TOOL_PROFILE_CONTEXT_KEY];
  if (marker === "read_only") return "read_only";
  if (marker === "full") return "full";
  const issueId = text(context.issueId) ?? text(context.taskId);
  if (!issueId) return "full";
  return (await isOpenwaConversationIssue(db, run.companyId, issueId)) ? "read_only" : "full";
}

/** Runs fn in a request scope whose consumed one_action grants inner seams of the same effect accept. */
export function openwaGrantScope<T>(input: { companyId: string; runId: string; grantId?: string | null }, fn: () => T): T {
  return grantScopes.run(
    { companyId: input.companyId, runId: input.runId, grantIds: new Set(input.grantId ? [input.grantId] : []) },
    fn,
  );
}

function scopedGrantIds(run: RunLike): Set<string> | null {
  const scope = grantScopes.getStore();
  return scope && scope.runId === run.id && scope.companyId === run.companyId ? scope.grantIds : null;
}

/** Throws OpenwaApprovalRequiredError unless the run may act in the category; returns the one_action grant id it consumed. */
export async function assertOpenwaRunMay(
  db: Db,
  run: RunLike,
  category: OpenwaApprovalCategory,
  options: { consume?: boolean } = {},
): Promise<string | null> {
  if ((await openwaRunProfile(db, run)) === "full") return null;
  const openwa = readOpenwaRunContext(run.contextSnapshot);
  if (openwa?.runAllowedCategories.includes(category)) {
    const [endpoint] = await db
      .select({ policy: chatEndpoints.policy })
      .from(chatEndpoints)
      .where(and(eq(chatEndpoints.companyId, run.companyId), eq(chatEndpoints.id, openwa.endpointId)))
      .limit(1);
    const policy = endpoint ? parsePolicy(endpoint.policy) : null;
    const live = openwaAllowedCategories(policy, openwa.profile, openwa.grantedCategories, policy?.gatewayAdminTools ?? "off");
    if (live.allowed.includes(category)) return null;
  }
  if (!openwa || openwa.grantIds.length === 0) throw new OpenwaApprovalRequiredError(category);
  const now = new Date();
  const grants = await db
    .select({ id: chatOwnerGrants.id, scope: chatOwnerGrants.scope, status: chatOwnerGrants.status, consumedByRunId: chatOwnerGrants.consumedByRunId })
    .from(chatOwnerGrants)
    .where(and(
      eq(chatOwnerGrants.companyId, run.companyId),
      eq(chatOwnerGrants.endpointId, openwa.endpointId),
      eq(chatOwnerGrants.originChatKey, openwa.chatKey),
      eq(chatOwnerGrants.category, category),
      inArray(chatOwnerGrants.id, openwa.grantIds),
      gt(chatOwnerGrants.expiresAt, now),
    ));
  if (grants.some((grant) => grant.scope === "requester" && grant.status === "live")) return null;
  const scoped = scopedGrantIds(run);
  if (scoped && grants.some((grant) => grant.scope === "one_action" && grant.status === "consumed" && grant.consumedByRunId === run.id && scoped.has(grant.id))) return null;
  if (options.consume === false) {
    if (grants.some((grant) => grant.scope === "one_action" && grant.status === "live")) return null;
    throw new OpenwaApprovalRequiredError(category);
  }
  for (const grant of grants) {
    if (grant.scope !== "one_action" || grant.status !== "live") continue;
    const [consumed] = await db
      .update(chatOwnerGrants)
      .set({ status: "consumed", consumedAt: now, consumedByRunId: run.id, updatedAt: now })
      .where(and(
        eq(chatOwnerGrants.id, grant.id),
        eq(chatOwnerGrants.companyId, run.companyId),
        eq(chatOwnerGrants.status, "live"),
        gt(chatOwnerGrants.expiresAt, now),
      ))
      .returning({ id: chatOwnerGrants.id });
    if (consumed) {
      scoped?.add(consumed.id);
      await logOpenwaActivity(db, {
        companyId: run.companyId,
        endpointId: openwa.endpointId,
        action: "openwa.grant_consumed",
        runId: run.id,
        details: { grantId: consumed.id, category, scope: "one_action" },
      });
      return consumed.id;
    }
  }
  throw new OpenwaApprovalRequiredError(category);
}

/** Returns a one_action grant consumed by a request that was rejected before its effect. */
export async function restoreOpenwaGrant(db: Db, input: { companyId: string; runId: string; grantId: string }) {
  await db
    .update(chatOwnerGrants)
    .set({ status: "live", consumedAt: null, consumedByRunId: null, updatedAt: new Date() })
    .where(and(
      eq(chatOwnerGrants.id, input.grantId),
      eq(chatOwnerGrants.companyId, input.companyId),
      eq(chatOwnerGrants.status, "consumed"),
      eq(chatOwnerGrants.consumedByRunId, input.runId),
    ));
}

/** True while a grant held on a write receipt is still consumed; a revoked grant no longer covers retries of that write. */
export async function openwaHeldGrantValid(db: Db, input: { companyId: string; grantId: string }): Promise<boolean> {
  const [grant] = await db
    .select({ id: chatOwnerGrants.id })
    .from(chatOwnerGrants)
    .where(and(eq(chatOwnerGrants.id, input.grantId), eq(chatOwnerGrants.companyId, input.companyId), eq(chatOwnerGrants.status, "consumed")))
    .limit(1);
  return grant !== undefined;
}

export async function loadOpenwaRunAuthority(db: Db, input: { companyId: string; runId: string }): Promise<RunLike | null> {
  const [run] = await db
    .select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, contextSnapshot: openwaRunAuthoritySnapshot() })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId)))
    .limit(1);
  return run ?? null;
}

/** Loads a run (company scoped, fail-closed) and asserts the category; requests without a run pass. */
export async function assertOpenwaRunIdMay(
  db: Db,
  input: { companyId: string; runId: string | null | undefined },
  category: OpenwaApprovalCategory,
  options: { consume?: boolean } = {},
): Promise<string | null> {
  if (!input.runId) return null;
  const run = await loadOpenwaRunAuthority(db, { companyId: input.companyId, runId: input.runId });
  if (!run) throw forbidden("Run is not available in this company");
  return assertOpenwaRunMay(db, run, category, options);
}

type RestRule = {
  method: string;
  path: RegExp;
  ownIssue?: number;
  check?: "workProduct" | "issuePatch";
};

const READ_ONLY_REST_ALLOW: readonly RestRule[] = [
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/comments$/i, ownIssue: 1 },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/issues\/([^/]+)\/attachments$/i, ownIssue: 1 },
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/work-products$/i, ownIssue: 1 },
  { method: "PATCH", path: /^\/api\/work-products\/([^/]+)$/i, check: "workProduct" },
  { method: "PUT", path: /^\/api\/issues\/([^/]+)\/documents\/[^/]+$/i, ownIssue: 1 },
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/checkout$/i, ownIssue: 1 },
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/release$/i, ownIssue: 1 },
  { method: "PATCH", path: /^\/api\/issues\/([^/]+)$/i, ownIssue: 1, check: "issuePatch" },
  { method: "POST", path: /^\/api\/mcp\/paperclip$/i },
  { method: "POST", path: /^\/api\/tool-gateway\/sessions$/i },
  { method: "POST", path: /^\/api\/tool-gateway\/tools\/call$/i },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/email\/send$/i },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/openwa\/tasks\/[^/]+\/tools(?:\/.*)?$/i },
  { method: "POST", path: /^\/api\/plugins\/tools\/execute$/i },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/slack\/tasks\/[^/]+\/tools$/i },
  { method: "PUT", path: /^\/api\/companies\/[^/]+\/slack\/endpoints\/[^/]+\/search$/i },
  { method: "POST", path: /^\/api\/mcp\/project-tools$/i },
];

const CREATE_TASK_REST: readonly { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/companies\/[^/]+\/issues$/i },
  { method: "POST", path: /^\/api\/issues\/[^/]+\/children$/i },
  { method: "POST", path: /^\/api\/issues\/[^/]+\/accepted-plan-decompositions$/i },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/projects$/i },
  { method: "PATCH", path: /^\/api\/issues\/[^/]+$/i },
];

const ISSUE_DELEGATION_FIELDS = ["assigneeAgentId", "assigneeUserId", "parentId", "projectId", "blockedByIssueIds", "deferWakeForGoal"];
const ISSUE_LIFECYCLE_PATCH_FIELDS = new Set(["status", "comment", "commentClientRequestId", "commentDeliver", "attachmentIds", "reopen", "resume", "interrupt"]);

export type OpenwaRestDecision = { allowed: true } | { allowed: false; category: OpenwaApprovalCategory };

/** Pure read_only REST allowlist; the work-product owner check is resolved by the caller. */
export function openwaReadOnlyRestDecision(input: {
  method: string;
  path: string;
  ownIssueId: string | null;
  body?: unknown;
  workProductIssueId?: string | null;
}): OpenwaRestDecision | { allowed: "workProduct"; workProductId: string } {
  const method = input.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return { allowed: true };
  const path = (input.path.length > 1 ? input.path.replace(/\/+$/, "") : input.path).toLowerCase();
  const ownIssueId = input.ownIssueId?.toLowerCase() ?? null;
  const body = record(input.body);
  const delegates = ISSUE_DELEGATION_FIELDS.some((field) => body[field] !== undefined);
  const lifecycleOnly = Object.keys(body).every((field) => ISSUE_LIFECYCLE_PATCH_FIELDS.has(field));
  for (const rule of READ_ONLY_REST_ALLOW) {
    if (rule.method !== method) continue;
    const match = rule.path.exec(path);
    if (!match) continue;
    if (rule.ownIssue && (!ownIssueId || match[rule.ownIssue] !== ownIssueId)) continue;
    if (rule.check === "issuePatch" && !lifecycleOnly) continue;
    if (rule.check === "workProduct") {
      if (input.workProductIssueId === undefined) return { allowed: "workProduct", workProductId: match[1]! };
      if (!ownIssueId || input.workProductIssueId?.toLowerCase() !== ownIssueId) continue;
    }
    return { allowed: true };
  }
  const createsTask = CREATE_TASK_REST.some((rule) =>
    rule.method === method && rule.path.test(path) && (method !== "PATCH" || delegates));
  return { allowed: false, category: createsTask ? "create_task" : "external_tools" };
}

/** REST seam for signed run JWT requests: denies non-allowlisted mutations of read_only runs; returns a consumed grant id. */
export async function assertOpenwaRestAllowed(
  db: Db,
  input: { run: RunLike; method: string; path: string; body?: unknown },
): Promise<string | null> {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return null;
  if ((await openwaRunProfile(db, input.run)) === "full") return null;
  const context = record(input.run.contextSnapshot);
  const ownIssueId = text(context.issueId) ?? text(context.taskId);
  let decision = openwaReadOnlyRestDecision({ method: input.method, path: input.path, ownIssueId, body: input.body });
  if (decision.allowed === "workProduct") {
    const [product] = await db
      .select({ issueId: issueWorkProducts.issueId })
      .from(issueWorkProducts)
      .where(and(eq(issueWorkProducts.id, decision.workProductId), eq(issueWorkProducts.companyId, input.run.companyId)))
      .limit(1);
    decision = openwaReadOnlyRestDecision({
      method: input.method, path: input.path, ownIssueId, body: input.body, workProductIssueId: product?.issueId ?? null,
    }) as OpenwaRestDecision;
  }
  if (decision.allowed === true) return null;
  return assertOpenwaRunMay(db, input.run, decision.category);
}

/** D35: persistent keys of an agent bound to a non-archived OpenWA endpoint never mutate. */
export async function assertOpenwaAgentKeyMethodAllowed(
  db: Db,
  input: { companyId: string; agentId: string; method: string },
): Promise<void> {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return;
  const key = `${input.companyId}:${input.agentId}`;
  let bound = cacheGet(agentKeyCache, db, key, AGENT_KEY_CACHE_TTL_MS) === true;
  if (!bound) {
    const [row] = await db
      .select({ id: chatEndpoints.id })
      .from(chatEndpoints)
      .where(and(
        eq(chatEndpoints.companyId, input.companyId),
        eq(chatEndpoints.assignedAgentId, input.agentId),
        eq(chatEndpoints.provider, "openwa"),
        ne(chatEndpoints.status, "archived"),
      ))
      .limit(1);
    bound = Boolean(row);
    if (bound) cacheSet(agentKeyCache, db, key, true, AGENT_KEY_CACHE_LIMIT);
  }
  if (bound) {
    throw forbidden("Persistent agent keys of an OpenWA agent are read-only; use run-bound credentials", {
      code: OPENWA_AGENT_KEY_READ_ONLY_CODE,
    });
  }
}

export async function openwaRunSuppressesMentionWakes(db: Db, run: RunLike): Promise<boolean> {
  return (await openwaRunProfile(db, run)) === "read_only";
}
