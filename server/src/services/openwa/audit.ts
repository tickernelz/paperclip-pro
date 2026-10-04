import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import {
  chatAuditEntries,
  chatEndpointOwners,
  chatEndpoints,
  chatIdentityLinks,
  chatOwnerGrants,
  companyMemberships,
  heartbeatRuns,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type { ChatAuditActorKind, ChatAuditEntryKind } from "@tickernelz/paperclip-pro-shared";
import { badRequest, forbidden, notFound } from "../../errors.js";
import { sanitizeRecord } from "../../redaction.js";
import { logActivity, type ActivityPublication } from "../activity-log.js";
import { readOpenwaRunContext } from "./authority.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type OpenwaAuditDb = Db | DbTransaction;

export const OPENWA_AUDIT_ARG_LIMIT_BYTES = 4096;
export const OPENWA_AUDIT_RESULT_LIMIT_BYTES = 1024;
export const OPENWA_AUDIT_CONTENT_LIMIT_BYTES = 16384;
export const DEFAULT_OPENWA_AUDIT_CONTENT_RETENTION_DAYS = 90;
export const OPENWA_AUDIT_PURGE_BATCH_SIZE = 1000;
export const OPENWA_AUDIT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OPENWA_AUDIT_PURGE_MAX_BATCHES_PER_RUN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPENWA_ACTIVITY_ACTIONS = [
  "openwa.endpoint_created",
  "openwa.endpoint_updated",
  "openwa.owner_added",
  "openwa.owner_removed",
  "openwa.sender_rule_changed",
  "openwa.chat_activation_changed",
  "openwa.config_changed",
  "openwa.approval_requested",
  "openwa.approval_resolved",
  "openwa.approval_cancelled",
  "openwa.grant_created",
  "openwa.grant_consumed",
  "openwa.grant_revoked",
  "openwa.grant_expired",
  "openwa.gateway_admin_called",
  "openwa.linked_session_added",
  "openwa.linked_session_chats_changed",
  "openwa.linked_session_removed",
] as const;
export type OpenwaActivityAction = (typeof OPENWA_ACTIVITY_ACTIONS)[number];

export type OpenwaActivityDetailValue = string | number | boolean | null | string[];

export interface OpenwaActivityInput {
  companyId: string;
  endpointId: string;
  action: OpenwaActivityAction;
  actorUserId?: string | null;
  actorPrincipalId?: string | null;
  agentId?: string | null;
  runId?: string | null;
  details?: Record<string, OpenwaActivityDetailValue>;
}

/** Layer-1 metadata-only activity entry; details carry ids, counts and changed keys, never message, owner or tool text. */
export async function logOpenwaActivity(
  db: OpenwaAuditDb,
  input: OpenwaActivityInput,
  postCommitPublications?: ActivityPublication[],
) {
  return logActivity(
    db as Db,
    {
      companyId: input.companyId,
      actorType: input.actorUserId ? "user" : "system",
      actorId: input.actorUserId ?? (input.actorPrincipalId ? "chat:" + input.actorPrincipalId : "openwa"),
      action: input.action,
      entityType: "chat_endpoint",
      entityId: input.endpointId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: { ...input.details, endpointId: input.endpointId, provider: "openwa" },
    },
    postCommitPublications,
  );
}

export interface OpenwaAuditWrite {
  companyId: string;
  endpointId: string;
  kind: ChatAuditEntryKind;
  actorKind: ChatAuditActorKind;
  actorRef?: string | null;
  chatKey?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  metadata: Record<string, unknown>;
  content?: Record<string, unknown> | null;
  retentionDays?: number;
  occurredAt?: Date;
}

/** Retention days from a raw endpoint policy, falling back to the default when absent or out of bounds. */
export function openwaAuditRetentionDays(policy: unknown): number {
  const value = policy && typeof policy === "object" ? (policy as Record<string, unknown>).auditContentRetentionDays : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650
    ? value
    : DEFAULT_OPENWA_AUDIT_CONTENT_RETENTION_DAYS;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function truncateText(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const marker = "…[truncated " + bytes.length + " bytes]";
  const keep = Math.max(0, maxBytes - byteLength(marker));
  return decoder.decode(bytes.subarray(0, keep)).replace(/\uFFFD+$/, "") + marker;
}

function boundValue(value: unknown, maxBytes: number): unknown {
  if (typeof value === "string") return truncateText(value, maxBytes);
  const json = JSON.stringify(value) ?? "null";
  if (byteLength(json) <= maxBytes) return value;
  return { truncated: true, bytes: byteLength(json), preview: truncateText(json, Math.max(0, maxBytes - 64)) };
}

function fieldLimit(key: string): number {
  if (key === "args") return OPENWA_AUDIT_ARG_LIMIT_BYTES;
  if (key === "resultSummary") return OPENWA_AUDIT_RESULT_LIMIT_BYTES;
  return OPENWA_AUDIT_CONTENT_LIMIT_BYTES;
}

/** Redacts credentials and bounds content: args 4 KB, resultSummary 1 KB, whole entry 16 KB. */
export function boundOpenwaAuditContent(content: Record<string, unknown>): Record<string, unknown> {
  const fields = Object.entries(sanitizeRecord(content)).map(([key, value]) => [key, boundValue(value, fieldLimit(key))] as const);
  const bounded = Object.fromEntries(fields);
  if (fields.length === 0 || byteLength(JSON.stringify(bounded)) <= OPENWA_AUDIT_CONTENT_LIMIT_BYTES) return bounded;
  const share = Math.floor(OPENWA_AUDIT_CONTENT_LIMIT_BYTES / fields.length) - 32;
  return Object.fromEntries(fields.map(([key, value]) => [key, boundValue(value, share)]));
}

async function endpointRetentionDays(db: OpenwaAuditDb, companyId: string, endpointId: string): Promise<number> {
  const [row] = await db
    .select({ policy: chatEndpoints.policy })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, companyId), eq(chatEndpoints.id, endpointId)))
    .limit(1);
  return openwaAuditRetentionDays(row?.policy);
}

/** Records a Layer-2 content-bearing audit entry; pass a transaction so it commits with the mutation. */
export async function recordOpenwaAudit(db: OpenwaAuditDb, write: OpenwaAuditWrite): Promise<void> {
  const occurredAt = write.occurredAt ?? new Date();
  const content = write.content ? boundOpenwaAuditContent(write.content) : null;
  const retentionDays = content
    ? write.retentionDays ?? (await endpointRetentionDays(db, write.companyId, write.endpointId))
    : null;
  await db.insert(chatAuditEntries).values({
    companyId: write.companyId,
    endpointId: write.endpointId,
    conversationId: write.conversationId ?? null,
    chatKey: write.chatKey ?? null,
    kind: write.kind,
    actorKind: write.actorKind,
    actorRef: write.actorRef ?? null,
    runId: write.runId ?? null,
    metadata: sanitizeRecord(write.metadata),
    content,
    contentPurgeAt: retentionDays === null ? null : new Date(occurredAt.getTime() + retentionDays * DAY_MS),
    occurredAt,
  });
}

export type OpenwaAuditAccess = "content" | "metadata";

export type OpenwaAuditViewer =
  | { type: "board"; userId: string | null; instanceAdmin: boolean }
  | { type: "owner_run"; runId: string };

export interface OpenwaAuditFilters {
  kinds?: ChatAuditEntryKind[];
  chatKey?: string;
  actorKind?: ChatAuditActorKind;
  actorRef?: string;
  from?: Date;
  to?: Date;
}

export interface OpenwaAuditEntryView {
  id: string;
  kind: ChatAuditEntryKind;
  actorKind: ChatAuditActorKind;
  actorRef: string | null;
  chatKey: string | null;
  conversationId: string | null;
  runId: string | null;
  metadata: Record<string, unknown>;
  content: Record<string, unknown> | null;
  contentPurged: boolean;
  occurredAt: string;
}

export interface OpenwaAuditPage {
  items: OpenwaAuditEntryView[];
  nextCursor: string | null;
  access: OpenwaAuditAccess;
}

async function boardAccess(
  db: Db,
  companyId: string,
  endpointId: string,
  viewer: { userId: string | null; instanceAdmin: boolean },
): Promise<OpenwaAuditAccess> {
  if (viewer.instanceAdmin) return "content";
  if (!viewer.userId) return "metadata";
  const [companyOwner, endpointOwner] = await Promise.all([
    db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, viewer.userId),
        eq(companyMemberships.status, "active"),
        eq(companyMemberships.membershipRole, "owner"),
      ))
      .limit(1),
    db
      .select({ id: chatEndpointOwners.id })
      .from(chatEndpointOwners)
      .innerJoin(chatIdentityLinks, and(
        eq(chatIdentityLinks.id, chatEndpointOwners.identityLinkId),
        eq(chatIdentityLinks.companyId, chatEndpointOwners.companyId),
        eq(chatIdentityLinks.endpointId, chatEndpointOwners.endpointId),
        eq(chatIdentityLinks.status, "linked"),
      ))
      .innerJoin(companyMemberships, and(
        eq(companyMemberships.companyId, chatEndpointOwners.companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, viewer.userId),
        eq(companyMemberships.status, "active"),
        sql`coalesce(${companyMemberships.membershipRole}, '') <> 'viewer'`,
      ))
      .where(and(
        eq(chatEndpointOwners.companyId, companyId),
        eq(chatEndpointOwners.endpointId, endpointId),
        eq(chatIdentityLinks.paperclipUserId, viewer.userId),
      ))
      .limit(1),
  ]);
  return companyOwner.length > 0 || endpointOwner.length > 0 ? "content" : "metadata";
}

async function ownerRunAccess(db: Db, companyId: string, endpointId: string, runId: string): Promise<OpenwaAuditAccess> {
  const [run] = await db
    .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId)))
    .limit(1);
  const openwa = run ? readOpenwaRunContext(run.contextSnapshot) : null;
  if (!openwa || openwa.endpointId !== endpointId || openwa.triggerClass !== "owner") {
    throw forbidden("Only owner-class runs of this endpoint may read its audit");
  }
  return "content";
}

function parseCursor(cursor: string): { occurredAt: string; id: string } {
  try {
    if (cursor.length > 256) throw new Error("Invalid cursor");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2
      || typeof value[0] !== "string" || new Date(value[0]).toISOString() !== value[0]
      || typeof value[1] !== "string" || !UUID_RE.test(value[1])) throw new Error("Invalid cursor");
    return { occurredAt: value[0], id: value[1] };
  } catch {
    throw badRequest("Invalid audit cursor");
  }
}

/** Lists an endpoint's audit newest first; content is selected only for endpoint owners, company owners and owner-class runs. */
export async function listOpenwaAudit(
  db: Db,
  input: {
    companyId: string;
    endpointId: string;
    viewer: OpenwaAuditViewer;
    filters?: OpenwaAuditFilters;
    cursor?: string;
    limit?: number;
  },
): Promise<OpenwaAuditPage> {
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest("Audit limit must be between 1 and 100");
  const before = input.cursor === undefined ? null : parseCursor(input.cursor);
  const [endpoint] = await db
    .select({ id: chatEndpoints.id })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId)))
    .limit(1);
  if (!endpoint) throw notFound("Chat endpoint not found");
  const access = input.viewer.type === "owner_run"
    ? await ownerRunAccess(db, input.companyId, input.endpointId, input.viewer.runId)
    : await boardAccess(db, input.companyId, input.endpointId, input.viewer);
  const filters = input.filters ?? {};
  const conditions: (SQL | undefined)[] = [
    eq(chatAuditEntries.companyId, input.companyId),
    eq(chatAuditEntries.endpointId, input.endpointId),
    filters.kinds?.length ? inArray(chatAuditEntries.kind, filters.kinds) : undefined,
    filters.chatKey ? eq(chatAuditEntries.chatKey, filters.chatKey) : undefined,
    filters.actorKind ? eq(chatAuditEntries.actorKind, filters.actorKind) : undefined,
    filters.actorRef ? eq(chatAuditEntries.actorRef, filters.actorRef) : undefined,
    filters.from ? gte(chatAuditEntries.occurredAt, filters.from) : undefined,
    filters.to ? lte(chatAuditEntries.occurredAt, filters.to) : undefined,
    before
      ? sql`(date_trunc('milliseconds', ${chatAuditEntries.occurredAt}), ${chatAuditEntries.id}) < (${before.occurredAt}::timestamptz, ${before.id}::uuid)`
      : undefined,
  ];
  const rows = await db
    .select({
      id: chatAuditEntries.id,
      kind: chatAuditEntries.kind,
      actorKind: chatAuditEntries.actorKind,
      actorRef: chatAuditEntries.actorRef,
      chatKey: chatAuditEntries.chatKey,
      conversationId: chatAuditEntries.conversationId,
      runId: chatAuditEntries.runId,
      metadata: chatAuditEntries.metadata,
      content: access === "content"
        ? chatAuditEntries.content
        : sql<Record<string, unknown> | null>`null::jsonb`,
      contentPurged: sql<boolean>`(${chatAuditEntries.content} is null and ${chatAuditEntries.contentPurgeAt} is not null)`,
      occurredAt: chatAuditEntries.occurredAt,
    })
    .from(chatAuditEntries)
    .where(and(...conditions))
    .orderBy(desc(sql`date_trunc('milliseconds', ${chatAuditEntries.occurredAt})`), desc(chatAuditEntries.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify([last.occurredAt, last.id])).toString("base64url")
      : null,
    access,
  };
}

export interface OpenwaAuditPurgeResult {
  purged: number;
  batches: number;
}

export interface OpenwaAuditMaintenanceResult extends OpenwaAuditPurgeResult {
  expiredGrants: number;
}

/** Marks live grants past expires_at as expired and logs one openwa.grant_expired activity per endpoint. */
export async function expireOpenwaGrants(db: Db, options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(chatOwnerGrants)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(chatOwnerGrants.status, "live"), lte(chatOwnerGrants.expiresAt, now)))
      .returning({ id: chatOwnerGrants.id, companyId: chatOwnerGrants.companyId, endpointId: chatOwnerGrants.endpointId });
    const byEndpoint = new Map<string, { companyId: string; endpointId: string; grantIds: string[] }>();
    for (const grant of expired) {
      const key = grant.companyId + ":" + grant.endpointId;
      const entry = byEndpoint.get(key) ?? { companyId: grant.companyId, endpointId: grant.endpointId, grantIds: [] };
      entry.grantIds.push(grant.id);
      byEndpoint.set(key, entry);
    }
    for (const entry of byEndpoint.values())
      await logOpenwaActivity(tx, {
        companyId: entry.companyId,
        endpointId: entry.endpointId,
        action: "openwa.grant_expired",
        details: { grantIds: entry.grantIds.sort(), count: entry.grantIds.length },
      });
    return expired.length;
  });
}

/** Nulls audit content whose retention ended, in batches; metadata and content_purge_at stay. */
export async function purgeOpenwaAuditContent(
  db: Db,
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {},
): Promise<OpenwaAuditPurgeResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? OPENWA_AUDIT_PURGE_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  let purged = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const due = db
      .select({ id: chatAuditEntries.id })
      .from(chatAuditEntries)
      .where(and(isNotNull(chatAuditEntries.content), lte(chatAuditEntries.contentPurgeAt, now)))
      .orderBy(asc(chatAuditEntries.contentPurgeAt))
      .limit(batchSize);
    const updated = await db
      .update(chatAuditEntries)
      .set({ content: null, updatedAt: now })
      .where(inArray(chatAuditEntries.id, due))
      .returning({ id: chatAuditEntries.id });
    if (updated.length === 0) break;
    batches += 1;
    purged += updated.length;
    if (updated.length < batchSize) break;
  }
  return { purged, batches };
}

/** Runs the content purge and grant expiry at most once per interval; a purge cut short by maxBatches stays due so the next tick continues. */
export function openwaAuditPurgeScheduler(
  db: Db,
  options: { intervalMs?: number; maxBatches?: number; batchSize?: number; now?: () => Date } = {},
) {
  const intervalMs = options.intervalMs ?? OPENWA_AUDIT_PURGE_INTERVAL_MS;
  const maxBatches = options.maxBatches ?? OPENWA_AUDIT_PURGE_MAX_BATCHES_PER_RUN;
  const batchSize = options.batchSize ?? OPENWA_AUDIT_PURGE_BATCH_SIZE;
  const clock = options.now ?? (() => new Date());
  let lastCompletedAt: number | null = null;
  let running: Promise<OpenwaAuditMaintenanceResult | null> | null = null;
  return {
    runDue(): Promise<OpenwaAuditMaintenanceResult | null> {
      if (running) return running;
      const now = clock();
      if (lastCompletedAt !== null && now.getTime() - lastCompletedAt < intervalMs) return Promise.resolve(null);
      running = Promise.all([purgeOpenwaAuditContent(db, { now, maxBatches, batchSize }), expireOpenwaGrants(db, { now })])
        .then(([purge, expiredGrants]) => {
          const result = { ...purge, expiredGrants };
          if (result.batches < maxBatches || result.purged < result.batches * batchSize) lastCompletedAt = now.getTime();
          return result;
        })
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
}
