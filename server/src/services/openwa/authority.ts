import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  agentWakeupRequests,
  chatConversations,
  chatEndpoints,
  chatOwnerGrants,
  heartbeatRuns,
  issueWorkProducts,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  OPENWA_TRIGGER_CLASSES,
  type OpenwaApprovalCategory,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import { RUN_TOOL_PROFILE_CONTEXT_KEY } from "@tickernelz/paperclip-pro-adapter-utils";
import { HttpError, forbidden } from "../../errors.js";

export const OPENWA_RUN_CONTEXT_KEY = "paperclipOpenwa";
export const OPENWA_APPROVAL_REQUIRED_CODE = "openwa_approval_required";
export const OPENWA_AGENT_KEY_READ_ONLY_CODE = "openwa_agent_key_read_only";

export type OpenwaRunProfile = "full" | "read_only";

export interface OpenwaRunContext {
  endpointId: string;
  chatKey: string;
  triggerClass: OpenwaTriggerClass;
  profile: OpenwaRunProfile;
  grantIds: string[];
  requesterPrincipalId: string | null;
  approvalRequestId: string | null;
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BINDING_CACHE_LIMIT = 10_000;
const BINDING_CACHE_TTL_MS = 5 * 60_000;
const AGENT_KEY_CACHE_LIMIT = 2_000;
const AGENT_KEY_CACHE_TTL_MS = 30_000;
const bindingCache = new WeakMap<Db, Map<string, { bound: boolean; at: number }>>();
const agentKeyCache = new WeakMap<Db, Map<string, { bound: boolean; at: number }>>();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function triggerClass(value: unknown): OpenwaTriggerClass | null {
  return OPENWA_TRIGGER_CLASSES.includes(value as OpenwaTriggerClass)
    ? (value as OpenwaTriggerClass)
    : null;
}

function uuids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && pattern.test(entry)))];
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

function chatKeyFromConversation(externalConversationId: string): string {
  const match = /^openwa:[^:]+:(.+)$/.exec(externalConversationId);
  const chatId = (match?.[1] ?? externalConversationId).trim().toLowerCase();
  return chatId.endsWith("@s.whatsapp.net") ? chatId.slice(0, -"@s.whatsapp.net".length) + "@c.us" : chatId;
}

/** Reads the normalized OpenWA run context written at run start, or null for other runs. */
export function readOpenwaRunContext(contextSnapshot: unknown): OpenwaRunContext | null {
  const raw = record(record(contextSnapshot)[OPENWA_RUN_CONTEXT_KEY]);
  const endpointId = text(raw.endpointId);
  const chatKey = text(raw.chatKey);
  const cls = triggerClass(raw.triggerClass);
  const profile = raw.profile === "full" ? "full" : raw.profile === "read_only" ? "read_only" : null;
  if (!endpointId || !chatKey || !cls || !profile) return null;
  return {
    endpointId,
    chatKey,
    triggerClass: cls,
    profile,
    grantIds: uuids(raw.grantIds),
    requesterPrincipalId: text(raw.requesterPrincipalId),
    approvalRequestId: text(raw.approvalRequestId),
  };
}

async function openwaConversationBinding(db: Db, companyId: string, issueId: string) {
  const [row] = await db
    .select({ endpointId: chatConversations.endpointId, externalConversationId: chatConversations.externalConversationId })
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

/**
 * Resolves the OpenWA run context once at run start; null when the issue is not an OpenWA conversation.
 * Fail-closed: only a verified owner trigger or a human board user wake is full.
 */
export async function resolveOpenwaRunContext(
  db: Db,
  input: { companyId: string; issueId: string; contextSnapshot: Record<string, unknown>; wakeupRequestId: string | null },
): Promise<OpenwaRunContext | null> {
  const binding = await openwaConversationBinding(db, input.companyId, input.issueId);
  cacheSet(bindingCache, db, `${input.companyId}:${input.issueId}`, binding !== null, BINDING_CACHE_LIMIT);
  if (!binding) return null;
  const chatKey = chatKeyFromConversation(binding.externalConversationId);
  const [wake] = input.wakeupRequestId
    ? await db
        .select({
          requestedByActorType: agentWakeupRequests.requestedByActorType,
          requestedByActorId: agentWakeupRequests.requestedByActorId,
          payload: agentWakeupRequests.payload,
        })
        .from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.id, input.wakeupRequestId), eq(agentWakeupRequests.companyId, input.companyId)))
        .limit(1)
    : [];
  const raw = record(input.contextSnapshot[OPENWA_RUN_CONTEXT_KEY]);
  const wakeClass = triggerClass(record(record(wake?.payload).openwa).triggerClass);
  const verifiedClass = wakeClass && wakeClass === triggerClass(raw.triggerClass) ? wakeClass : null;
  if (!verifiedClass) {
    const boardUser = wake?.requestedByActorType === "user" && Boolean(text(wake.requestedByActorId)) && !wakeClass;
    return {
      endpointId: binding.endpointId,
      chatKey,
      triggerClass: "other",
      profile: boardUser ? "full" : "read_only",
      grantIds: [],
      requesterPrincipalId: null,
      approvalRequestId: null,
    };
  }
  const requesterPrincipalId = text(raw.requesterPrincipalId);
  const approvalRequestId = text(raw.approvalRequestId);
  const now = new Date();
  const candidateIds = verifiedClass === "grant" ? uuids(raw.grantIds) : [];
  const grants = verifiedClass === "owner" ? [] : await db
    .select({ id: chatOwnerGrants.id, scope: chatOwnerGrants.scope, requestId: chatOwnerGrants.requestId })
    .from(chatOwnerGrants)
    .where(and(
      eq(chatOwnerGrants.companyId, input.companyId),
      eq(chatOwnerGrants.endpointId, binding.endpointId),
      eq(chatOwnerGrants.originChatKey, chatKey),
      eq(chatOwnerGrants.status, "live"),
      gt(chatOwnerGrants.expiresAt, now),
      sql`(${candidateIds.length > 0
        ? sql`(${chatOwnerGrants.scope} = 'one_action' and ${inArray(chatOwnerGrants.id, candidateIds)})`
        : sql`false`} or ${requesterPrincipalId
        ? sql`(${chatOwnerGrants.scope} = 'requester' and ${chatOwnerGrants.requesterPrincipalId} = ${requesterPrincipalId})`
        : sql`false`})`,
    ));
  const grantIds = grants
    .filter((grant) => grant.scope === "requester" || !approvalRequestId || grant.requestId === approvalRequestId)
    .map((grant) => grant.id)
    .sort();
  return {
    endpointId: binding.endpointId,
    chatKey,
    triggerClass: verifiedClass,
    profile: verifiedClass === "owner" ? "full" : "read_only",
    grantIds,
    requesterPrincipalId,
    approvalRequestId,
  };
}

/** Writes the resolved profile into a run context; non-OpenWA contexts stay untouched. */
export function applyOpenwaRunContext(context: Record<string, unknown>, openwa: OpenwaRunContext | null) {
  if (!openwa) return;
  context[OPENWA_RUN_CONTEXT_KEY] = openwa;
  context[RUN_TOOL_PROFILE_CONTEXT_KEY] = openwa.profile;
}

/** Run profile from the run context; a run on an OpenWA conversation issue without one is read_only. */
export async function openwaRunProfile(db: Db, run: RunLike): Promise<OpenwaRunProfile> {
  const context = record(run.contextSnapshot);
  if (context[RUN_TOOL_PROFILE_CONTEXT_KEY] === "read_only") return "read_only";
  const openwa = readOpenwaRunContext(context);
  if (openwa) return openwa.profile;
  const issueId = text(context.issueId) ?? text(context.taskId);
  if (!issueId) return "full";
  return (await isOpenwaConversationIssue(db, run.companyId, issueId)) ? "read_only" : "full";
}

/**
 * Throws OpenwaApprovalRequiredError unless the run may act in the category; returns a one_action grant id it consumed.
 * consume=false only checks; a one_action grant this run already consumed still counts.
 */
export async function assertOpenwaRunMay(
  db: Db,
  run: RunLike,
  category: OpenwaApprovalCategory,
  options: { consume?: boolean } = {},
): Promise<string | null> {
  if ((await openwaRunProfile(db, run)) === "full") return null;
  const openwa = readOpenwaRunContext(run.contextSnapshot);
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
  if (options.consume === false) {
    if (grants.some((grant) => grant.scope === "one_action" && (grant.status === "live" || (grant.status === "consumed" && grant.consumedByRunId === run.id)))) return null;
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
    if (consumed) return consumed.id;
  }
  throw new OpenwaApprovalRequiredError(category);
}

/** Returns a one_action grant consumed by a request that then failed before committing its effect. */
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

/** Loads a run (company scoped, fail-closed) and asserts the category; requests without a run pass. */
export async function assertOpenwaRunIdMay(
  db: Db,
  input: { companyId: string; runId: string | null | undefined },
  category: OpenwaApprovalCategory,
  options: { consume?: boolean } = {},
): Promise<string | null> {
  if (!input.runId) return null;
  const [run] = await db
    .select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId)))
    .limit(1);
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
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/comments$/, ownIssue: 1 },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/issues\/([^/]+)\/attachments$/, ownIssue: 1 },
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/work-products$/, ownIssue: 1 },
  { method: "PATCH", path: /^\/api\/work-products\/([^/]+)$/, check: "workProduct" },
  { method: "PUT", path: /^\/api\/issues\/([^/]+)\/documents\/[^/]+$/, ownIssue: 1 },
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/checkout$/, ownIssue: 1 },
  { method: "POST", path: /^\/api\/issues\/([^/]+)\/release$/, ownIssue: 1 },
  { method: "PATCH", path: /^\/api\/issues\/([^/]+)$/, ownIssue: 1, check: "issuePatch" },
  { method: "POST", path: /^\/api\/mcp\/paperclip$/ },
  { method: "POST", path: /^\/api\/tool-gateway\/sessions$/ },
  { method: "POST", path: /^\/api\/tool-gateway\/tools\/call$/ },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/email\/send$/ },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/openwa\/tasks\/[^/]+\/tools(?:\/.*)?$/ },
];

const CREATE_TASK_REST: readonly { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/companies\/[^/]+\/issues$/ },
  { method: "POST", path: /^\/api\/issues\/[^/]+\/children$/ },
  { method: "POST", path: /^\/api\/issues\/[^/]+\/accepted-plan-decompositions$/ },
  { method: "POST", path: /^\/api\/companies\/[^/]+\/projects$/ },
  { method: "PATCH", path: /^\/api\/issues\/[^/]+$/ },
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
  const path = input.path.length > 1 ? input.path.replace(/\/+$/, "") : input.path;
  const body = record(input.body);
  const delegates = ISSUE_DELEGATION_FIELDS.some((field) => body[field] !== undefined);
  const lifecycleOnly = Object.keys(body).every((field) => ISSUE_LIFECYCLE_PATCH_FIELDS.has(field));
  for (const rule of READ_ONLY_REST_ALLOW) {
    if (rule.method !== method) continue;
    const match = rule.path.exec(path);
    if (!match) continue;
    if (rule.ownIssue && (!input.ownIssueId || match[rule.ownIssue] !== input.ownIssueId)) continue;
    if (rule.check === "issuePatch" && !lifecycleOnly) continue;
    if (rule.check === "workProduct") {
      if (input.workProductIssueId === undefined) return { allowed: "workProduct", workProductId: match[1]! };
      if (!input.ownIssueId || input.workProductIssueId !== input.ownIssueId) continue;
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
  let bound = cacheGet(agentKeyCache, db, key, AGENT_KEY_CACHE_TTL_MS);
  if (bound === null) {
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
    cacheSet(agentKeyCache, db, key, bound, AGENT_KEY_CACHE_LIMIT);
  }
  if (bound) {
    throw forbidden("Persistent agent keys of an OpenWA agent are read-only; use run-bound credentials", {
      code: OPENWA_AGENT_KEY_READ_ONLY_CODE,
    });
  }
}

/** True when the run context says read_only; mention wakes from such runs are suppressed. */
export function openwaRunSuppressesMentionWakes(run: { contextSnapshot?: unknown } | null | undefined): boolean {
  return record(run?.contextSnapshot)[RUN_TOOL_PROFILE_CONTEXT_KEY] === "read_only";
}
