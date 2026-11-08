import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  agents,
  approvals,
  budgetIncidents,
  decisionQueueItems,
  decisionQueues,
  decisions,
  decisionTriage,
  decisionTriageEvents,
  heartbeatRuns,
  issueApprovals,
  issueRecoveryActions,
  issueThreadInteractions,
  issueWorkProducts,
  issues,
  joinRequests,
} from "@tickernelz/paperclip-pro-db";
import type {
  AttentionItem,
  AttentionSourceKind,
  DecisionQueue,
  DecisionQueueItem,
  DecisionQueueSeedRule,
  DecisionTriage,
} from "@tickernelz/paperclip-pro-shared";
import { notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import {
  authorizationService,
  type AuthorizationActor,
  type AuthorizationResource,
} from "./authorization.js";

export type DecisionMutationActor = {
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId: string | null;
  userId: string | null;
  runId: string | null;
  agentApiKeyId: string | null;
  responsibleUserId: string | null;
};

type SeedDefinition = {
  key: string;
  title: string;
  description: string;
  rules: DecisionQueueSeedRule[];
};

export const DECISION_QUEUE_SEEDS: readonly SeedDefinition[] = [
  {
    key: "prs",
    title: "PRs",
    description: "Pull-request and merge decisions detected from issue work products.",
    rules: [{
      key: "issue-pull-request-work-product",
      signal: "issue_has_pull_request_work_product",
      description: "Attention items whose issue has a pull_request work product.",
    }],
  },
  {
    key: "plans",
    title: "Plans",
    description: "Plan revisions waiting for confirmation.",
    rules: [{
      key: "plan-document-confirmation",
      signal: "plan_document_confirmation",
      description: "Pending request_confirmation interactions bound to the issue's plan document.",
    }],
  },
  {
    key: "questions",
    title: "Questions",
    description: "Structured questions waiting for a board response.",
    rules: [{
      key: "ask-user-questions",
      signal: "ask_user_questions",
      description: "Pending ask_user_questions interactions.",
    }],
  },
] as const;

const SYSTEM_ACTOR: DecisionMutationActor = {
  actorType: "system",
  actorId: "decision_queue_seed",
  agentId: null,
  userId: null,
  runId: null,
  agentApiKeyId: null,
  responsibleUserId: null,
};

function creatorColumns(actor: DecisionMutationActor) {
  return {
    createdByType: actor.actorType,
    createdByAgentId: actor.agentId,
    createdByUserId: actor.userId,
    createdByRunId: actor.runId,
    createdByAgentApiKeyId: actor.agentApiKeyId,
  };
}

function addedByColumns(actor: DecisionMutationActor) {
  return {
    addedByType: actor.actorType,
    addedByAgentId: actor.agentId,
    addedByUserId: actor.userId,
    addedByRunId: actor.runId,
    addedByAgentApiKeyId: actor.agentApiKeyId,
  };
}

function eventActorColumns(actor: DecisionMutationActor) {
  return {
    actorType: actor.actorType,
    actorAgentId: actor.agentId,
    actorUserId: actor.userId,
    actorRunId: actor.runId,
    agentApiKeyId: actor.agentApiKeyId,
    responsibleUserId: actor.responsibleUserId,
  };
}

export type DecisionQueueCounts = {
  openByKey: ReadonlyMap<string, number>;
  resolvedByQueueId: ReadonlyMap<string, number> | null;
};

const EMPTY_QUEUE_COUNTS: DecisionQueueCounts = { openByKey: new Map(), resolvedByQueueId: new Map() };

function toQueue(row: typeof decisionQueues.$inferSelect, counts: DecisionQueueCounts): DecisionQueue {
  return {
    id: row.id,
    companyId: row.companyId,
    key: row.key,
    title: row.title,
    description: row.description ?? null,
    createdByType: row.createdByType as DecisionQueue["createdByType"],
    createdByAgentId: row.createdByAgentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdByRunId: row.createdByRunId ?? null,
    retentionDays: row.retentionDays ?? null,
    seedRules: row.seedRules ?? [],
    seedRulesEnabled: row.seedRulesEnabled,
    itemCount: counts.openByKey.get(row.key) ?? 0,
    resolvedCount: counts.resolvedByQueueId ? counts.resolvedByQueueId.get(row.id) ?? 0 : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toQueueItem(row: typeof decisionQueueItems.$inferSelect): DecisionQueueItem {
  return {
    id: row.id,
    companyId: row.companyId,
    queueId: row.queueId,
    sourceKind: row.sourceKind as AttentionSourceKind,
    sourceId: row.sourceId,
    addedByType: row.addedByType as DecisionQueueItem["addedByType"],
    addedByAgentId: row.addedByAgentId ?? null,
    addedByUserId: row.addedByUserId ?? null,
    addedByRunId: row.addedByRunId ?? null,
    responsibleUserId: row.responsibleUserId ?? null,
    createdAt: row.createdAt,
  };
}

function toTriage(row: typeof decisionTriage.$inferSelect): DecisionTriage {
  return {
    id: row.id,
    companyId: row.companyId,
    sourceKind: row.sourceKind as AttentionSourceKind,
    sourceId: row.sourceId,
    decideBy: row.decideBy === "date" ? row.decideByDate : row.decideBy,
    snoozedUntil: row.snoozedUntil ?? null,
    setByType: row.setByType as DecisionTriage["setByType"],
    setByAgentId: row.setByAgentId ?? null,
    setByUserId: row.setByUserId ?? null,
    setByRunId: row.setByRunId ?? null,
    responsibleUserId: row.responsibleUserId ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type DecisionSourceRef = { sourceKind: AttentionSourceKind; sourceId: string };

type ResolvedDecisionSource = { issueId: string | null; ownerAgentId?: string | null; agentId?: string | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTHORIZATION_BATCH_SIZE = 16;

function decisionSourceKey(sourceKind: AttentionSourceKind, sourceId: string) {
  return `${sourceKind}:${sourceId}`;
}

function runIssueId(contextSnapshot: unknown) {
  const snapshot = contextSnapshot && typeof contextSnapshot === "object"
    ? contextSnapshot as Record<string, unknown>
    : {};
  if (typeof snapshot.issueId === "string") return snapshot.issueId;
  return typeof snapshot.taskId === "string" ? snapshot.taskId : null;
}

async function resolveDecisionSources(
  db: Db,
  companyId: string,
  sources: readonly DecisionSourceRef[],
): Promise<Map<string, ResolvedDecisionSource>> {
  const idsByKind = new Map<AttentionSourceKind, string[]>();
  for (const source of sources) {
    if (!UUID_PATTERN.test(source.sourceId)) continue;
    const ids = idsByKind.get(source.sourceKind) ?? [];
    ids.push(source.sourceId);
    idsByKind.set(source.sourceKind, ids);
  }
  const resolved = new Map<string, ResolvedDecisionSource>();
  const put = (kind: AttentionSourceKind, id: string, value: ResolvedDecisionSource) => {
    const key = decisionSourceKey(kind, id);
    if (!resolved.has(key)) resolved.set(key, value);
  };
  await Promise.all([...idsByKind].map(async ([kind, rawIds]) => {
    const ids = [...new Set(rawIds)];
    switch (kind) {
      case "approval": {
        const rows = await db.select({ id: approvals.id, issueId: issueApprovals.issueId }).from(approvals)
          .leftJoin(issueApprovals, and(eq(issueApprovals.companyId, companyId), eq(issueApprovals.approvalId, approvals.id)))
          .where(and(eq(approvals.companyId, companyId), inArray(approvals.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: row.issueId ?? null });
        return;
      }
      case "decision": {
        const rows = await db.select({ id: decisions.id, issueId: decisions.originIssueId }).from(decisions)
          .where(and(eq(decisions.companyId, companyId), inArray(decisions.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: row.issueId ?? null });
        return;
      }
      case "issue_thread_interaction": {
        const rows = await db.select({ id: issueThreadInteractions.id, issueId: issueThreadInteractions.issueId })
          .from(issueThreadInteractions)
          .where(and(eq(issueThreadInteractions.companyId, companyId), inArray(issueThreadInteractions.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: row.issueId ?? null });
        return;
      }
      case "recovery_action": {
        const rows = await db.select({ id: issueRecoveryActions.id, issueId: issueRecoveryActions.sourceIssueId })
          .from(issueRecoveryActions)
          .where(and(eq(issueRecoveryActions.companyId, companyId), inArray(issueRecoveryActions.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: row.issueId ?? null });
        return;
      }
      // Keep historical decision queue entries accessible after feature retirement.
      case "productivity_review":
      case "blocker_attention":
      case "review": {
        const rows = await db.select({ id: issues.id }).from(issues)
          .where(and(eq(issues.companyId, companyId), inArray(issues.id, ids), isNull(issues.hiddenAt)));
        for (const row of rows) put(kind, row.id, { issueId: row.id });
        return;
      }
      case "failed_run": {
        const rows = await db.select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, ids)));
        for (const row of rows) {
          put(kind, row.id, { issueId: runIssueId(row.contextSnapshot), ownerAgentId: row.agentId ?? null });
        }
        return;
      }
      case "agent_error_alert": {
        const rows = await db.select({ id: agents.id }).from(agents)
          .where(and(eq(agents.companyId, companyId), inArray(agents.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: null, agentId: row.id });
        return;
      }
      case "join_request": {
        const rows = await db.select({ id: joinRequests.id }).from(joinRequests)
          .where(and(eq(joinRequests.companyId, companyId), inArray(joinRequests.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: null });
        return;
      }
      case "budget_alert": {
        const rows = await db.select({ id: budgetIncidents.id }).from(budgetIncidents)
          .where(and(eq(budgetIncidents.companyId, companyId), inArray(budgetIncidents.id, ids)));
        for (const row of rows) put(kind, row.id, { issueId: null });
        return;
      }
    }
  }));
  return resolved;
}

async function loadIssueResources(db: Db, companyId: string, issueIds: string[]) {
  const resources = new Map<string, AuthorizationResource>();
  const ids = issueIds.filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 0) return resources;
  const rows = await db
    .select({
      issueId: issues.id,
      companyId: issues.companyId,
      projectId: issues.projectId,
      parentIssueId: issues.parentId,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
      originKind: issues.originKind,
      originId: issues.originId,
      status: issues.status,
    })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), inArray(issues.id, ids), isNull(issues.hiddenAt)));
  for (const row of rows) resources.set(row.issueId, { type: "issue", ...row } as const);
  return resources;
}

async function decideEach(keys: string[], decideOne: (key: string) => Promise<boolean>) {
  const result = new Map<string, boolean>();
  for (let index = 0; index < keys.length; index += AUTHORIZATION_BATCH_SIZE) {
    const chunk = keys.slice(index, index + AUTHORIZATION_BATCH_SIZE);
    const allowed = await Promise.all(chunk.map(decideOne));
    chunk.forEach((key, offset) => result.set(key, allowed[offset]!));
  }
  return result;
}

export async function readableDecisionSourceKeys(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  sources: readonly DecisionSourceRef[],
): Promise<Set<string>> {
  const readable = new Set<string>();
  if (sources.length === 0) return readable;
  const resolved = await resolveDecisionSources(db, companyId, sources);
  const authz = authorizationService(db);
  const issueIds = [...new Set([...resolved.values()].map((source) => source.issueId).filter((id): id is string => Boolean(id)))];
  const agentIds = [...new Set(sources.flatMap((source) => {
    const agentId = source.sourceKind === "agent_error_alert"
      ? resolved.get(decisionSourceKey(source.sourceKind, source.sourceId))?.agentId
      : null;
    return agentId ? [agentId] : [];
  }))];
  const issueResources = await loadIssueResources(db, companyId, issueIds);
  const [issueReadable, agentReadable] = await Promise.all([
    decideEach(issueIds, async (issueId) => {
      const resource = issueResources.get(issueId);
      if (!resource) return false;
      return (await authz.decide({ actor, action: "issue:read", resource })).allowed;
    }),
    decideEach(agentIds, async (agentId) =>
      (await authz.decide({ actor, action: "agent:read", resource: { type: "agent", companyId, agentId } })).allowed),
  ]);
  let companyScopeReadable: Promise<boolean> | null = null;
  const companyScope = () => {
    companyScopeReadable ??= authz.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId } })
      .then((decision) => decision.allowed);
    return companyScopeReadable;
  };
  for (const source of sources) {
    const key = decisionSourceKey(source.sourceKind, source.sourceId);
    const found = resolved.get(key);
    if (!found) continue;
    let allowed: boolean;
    if (found.issueId) {
      allowed = issueReadable.get(found.issueId) ?? false;
    } else if (source.sourceKind === "agent_error_alert" && found.agentId) {
      allowed = agentReadable.get(found.agentId) ?? false;
    } else if (source.sourceKind === "failed_run" && actor.type === "agent") {
      allowed = found.ownerAgentId === actor.agentId;
    } else if (actor.type !== "board") {
      // Join requests, unlinked approvals, and budget incidents are board-only
      // governance data. Same-company existence is deliberately not authority.
      allowed = false;
    } else {
      allowed = await companyScope();
    }
    if (allowed) readable.add(key);
  }
  return readable;
}

export async function canReadDecisionSource(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  sourceKind: AttentionSourceKind,
  sourceId: string,
) {
  const readable = await readableDecisionSourceKeys(db, actor, companyId, [{ sourceKind, sourceId }]);
  return readable.has(decisionSourceKey(sourceKind, sourceId));
}


async function requireSourceRead(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  sourceKind: AttentionSourceKind,
  sourceId: string,
) {
  if (!(await canReadDecisionSource(db, actor, companyId, sourceKind, sourceId))) {
    throw notFound("Attention source not found");
  }
}

async function recordActivity(
  db: Db,
  actor: DecisionMutationActor,
  input: { companyId: string; action: string; entityType: string; entityId: string; details?: Record<string, unknown> },
) {
  await logActivity(db, {
    companyId: input.companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    agentApiKeyId: actor.agentApiKeyId,
    responsibleUserIdOverride: actor.responsibleUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details ?? null,
  });
}

function itemIssueId(item: AttentionItem) {
  if (item.subject.kind === "issue") return item.subject.id;
  const related = item.relatedIssue?.kind === "issue" ? item.relatedIssue.id : null;
  if (related) return related;
  const metadataIssueId = item.subject.metadata?.issueId ?? item.subject.metadata?.originIssueId;
  return typeof metadataIssueId === "string" ? metadataIssueId : null;
}

export function decisionQueueService(db: Db) {
  async function getQueue(companyId: string, key: string) {
    return db.select().from(decisionQueues)
      .where(and(eq(decisionQueues.companyId, companyId), eq(decisionQueues.key, key)))
      .then((rows) => rows[0] ?? null);
  }

  async function visibleItems(companyId: string, queueId: string, authActor: AuthorizationActor) {
    const rows = await db.select().from(decisionQueueItems)
      .where(and(eq(decisionQueueItems.companyId, companyId), eq(decisionQueueItems.queueId, queueId)))
      .orderBy(desc(decisionQueueItems.createdAt), desc(decisionQueueItems.id));
    const readable = await readableDecisionSourceKeys(db, authActor, companyId, rows.map((row) => ({
      sourceKind: row.sourceKind as AttentionSourceKind,
      sourceId: row.sourceId,
    })));
    return rows
      .filter((row) => readable.has(decisionSourceKey(row.sourceKind as AttentionSourceKind, row.sourceId)))
      .map(toQueueItem);
  }

  return {
    create: async (input: {
      companyId: string;
      key: string;
      title: string;
      description?: string | null;
      retentionDays?: number | null;
      loadCounts: () => Promise<DecisionQueueCounts>;
      actor: DecisionMutationActor;
    }) => {
      const result = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const inserted = await txDb.insert(decisionQueues).values({
          companyId: input.companyId,
          key: input.key,
          title: input.title,
          description: input.description ?? null,
          retentionDays: input.retentionDays ?? null,
          ...creatorColumns(input.actor),
        }).onConflictDoNothing({ target: [decisionQueues.companyId, decisionQueues.key] }).returning();
        const row = inserted[0] ?? await txDb.select().from(decisionQueues)
          .where(and(eq(decisionQueues.companyId, input.companyId), eq(decisionQueues.key, input.key)))
          .then((rows) => rows[0] ?? null);
        if (!row) throw new Error("Decision queue create did not return a row");
        if (inserted[0]) {
          await txDb.insert(decisionTriageEvents).values({
            companyId: input.companyId,
            queueId: row.id,
            action: "queue.created",
            ...eventActorColumns(input.actor),
            details: { key: row.key },
          });
          await recordActivity(txDb, input.actor, {
            companyId: input.companyId,
            action: "decision_queue.created",
            entityType: "decision_queue",
            entityId: row.id,
            details: { key: row.key },
          });
        }
        return { row, created: Boolean(inserted[0]) };
      });
      const counts = result.created ? EMPTY_QUEUE_COUNTS : await input.loadCounts();
      return { queue: toQueue(result.row, counts), created: result.created };
    },

    list: async (companyId: string, counts: DecisionQueueCounts) => {
      const rows = await db.select().from(decisionQueues)
        .where(eq(decisionQueues.companyId, companyId))
        .orderBy(desc(decisionQueues.updatedAt), desc(decisionQueues.id));
      return rows.map((row) => toQueue(row, counts));
    },

    update: async (input: {
      companyId: string;
      key: string;
      patch: { title?: string; description?: string | null; retentionDays?: number | null; seedRulesEnabled?: boolean };
      loadCounts: () => Promise<DecisionQueueCounts>;
      actor: DecisionMutationActor;
    }) => {
      const row = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const updated = await txDb.update(decisionQueues).set({ ...input.patch, updatedAt: new Date() })
          .where(and(eq(decisionQueues.companyId, input.companyId), eq(decisionQueues.key, input.key)))
          .returning().then((rows) => rows[0] ?? null);
        if (!updated) throw notFound("Decision queue not found");
        await txDb.insert(decisionTriageEvents).values({
          companyId: input.companyId,
          queueId: updated.id,
          action: "queue.updated",
          ...eventActorColumns(input.actor),
          details: { fields: Object.keys(input.patch) },
        });
        await recordActivity(txDb, input.actor, {
          companyId: input.companyId,
          action: "decision_queue.updated",
          entityType: "decision_queue",
          entityId: updated.id,
          details: { key: updated.key, fields: Object.keys(input.patch) },
        });
        return updated;
      });
      return toQueue(row, await input.loadCounts());
    },

    listItems: async (companyId: string, key: string, authActor: AuthorizationActor) => {
      const queue = await getQueue(companyId, key);
      if (!queue) throw notFound("Decision queue not found");
      return visibleItems(companyId, queue.id, authActor);
    },

    addItem: async (input: {
      companyId: string;
      key: string;
      sourceKind: AttentionSourceKind;
      sourceId: string;
      authActor: AuthorizationActor;
      actor: DecisionMutationActor;
    }) => {
      const queue = await getQueue(input.companyId, input.key);
      if (!queue) throw notFound("Decision queue not found");
      await requireSourceRead(db, input.authActor, input.companyId, input.sourceKind, input.sourceId);
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const inserted = await txDb.insert(decisionQueueItems).values({
          companyId: input.companyId,
          queueId: queue.id,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          responsibleUserId: input.actor.responsibleUserId,
          ...addedByColumns(input.actor),
        }).onConflictDoNothing({
          target: [decisionQueueItems.queueId, decisionQueueItems.sourceKind, decisionQueueItems.sourceId],
        }).returning();
        const row = inserted[0] ?? await txDb.select().from(decisionQueueItems).where(and(
          eq(decisionQueueItems.queueId, queue.id),
          eq(decisionQueueItems.sourceKind, input.sourceKind),
          eq(decisionQueueItems.sourceId, input.sourceId),
        )).then((rows) => rows[0] ?? null);
        if (!row) throw new Error("Decision queue item create did not return a row");
        if (inserted[0]) {
          await txDb.update(decisionQueues).set({ updatedAt: new Date() })
            .where(and(eq(decisionQueues.id, queue.id), eq(decisionQueues.companyId, input.companyId)));
          await txDb.insert(decisionTriageEvents).values({
            companyId: input.companyId,
            queueId: queue.id,
            sourceKind: input.sourceKind,
            sourceId: input.sourceId,
            action: "queue_item.added",
            ...eventActorColumns(input.actor),
          });
          await recordActivity(txDb, input.actor, {
            companyId: input.companyId,
            action: "decision_queue_item.added",
            entityType: "decision_queue",
            entityId: queue.id,
            details: { sourceKind: input.sourceKind, sourceId: input.sourceId },
          });
        }
        return { item: toQueueItem(row), created: Boolean(inserted[0]) };
      });
    },

    removeItem: async (input: {
      companyId: string;
      key: string;
      sourceKind: AttentionSourceKind;
      sourceId: string;
      reason?: string;
      authActor: AuthorizationActor;
      actor: DecisionMutationActor;
    }) => {
      const queue = await getQueue(input.companyId, input.key);
      if (!queue) throw notFound("Decision queue not found");
      const sourceReadable = await canReadDecisionSource(
        db,
        input.authActor,
        input.companyId,
        input.sourceKind,
        input.sourceId,
      );
      // Board operators may clean up an existing sidecar after its source has
      // disappeared. Agents still need source-level read authority so removal
      // cannot be used to probe hidden membership.
      if (!sourceReadable && input.authActor.type !== "board") {
        throw notFound("Attention source not found");
      }
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const removed = await txDb.delete(decisionQueueItems).where(and(
          eq(decisionQueueItems.companyId, input.companyId),
          eq(decisionQueueItems.queueId, queue.id),
          eq(decisionQueueItems.sourceKind, input.sourceKind),
          eq(decisionQueueItems.sourceId, input.sourceId),
        )).returning().then((rows) => rows[0] ?? null);
        if (!removed) throw notFound("Decision queue item not found");
        await txDb.update(decisionQueues).set({ updatedAt: new Date() })
          .where(and(eq(decisionQueues.id, queue.id), eq(decisionQueues.companyId, input.companyId)));
        await txDb.insert(decisionTriageEvents).values({
          companyId: input.companyId,
          queueId: queue.id,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          action: "queue_item.removed",
          details: input.reason ? { reason: input.reason } : {},
          ...eventActorColumns(input.actor),
        });
        await recordActivity(txDb, input.actor, {
          companyId: input.companyId,
          action: "decision_queue_item.removed",
          entityType: "decision_queue",
          entityId: queue.id,
          details: {
            sourceKind: input.sourceKind,
            sourceId: input.sourceId,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        });
        return toQueueItem(removed);
      });
    },

    getTriage: async (
      companyId: string,
      sourceKind: AttentionSourceKind,
      sourceId: string,
      authActor: AuthorizationActor,
    ) => {
      await requireSourceRead(db, authActor, companyId, sourceKind, sourceId);
      const row = await db.select().from(decisionTriage).where(and(
        eq(decisionTriage.companyId, companyId),
        eq(decisionTriage.sourceKind, sourceKind),
        eq(decisionTriage.sourceId, sourceId),
      )).then((rows) => rows[0] ?? null);
      return row ? toTriage(row) : null;
    },

    updateTriage: async (input: {
      companyId: string;
      sourceKind: AttentionSourceKind;
      sourceId: string;
      decideBy?: string | null;
      snoozedUntil?: string | null;
      authActor: AuthorizationActor;
      actor: DecisionMutationActor;
    }) => {
      await requireSourceRead(db, input.authActor, input.companyId, input.sourceKind, input.sourceId);
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const lockKey = `decision-triage:${input.companyId}:${input.sourceKind}:${input.sourceId}`;
        await txDb.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const current = await txDb.select().from(decisionTriage).where(and(
          eq(decisionTriage.companyId, input.companyId),
          eq(decisionTriage.sourceKind, input.sourceKind),
          eq(decisionTriage.sourceId, input.sourceId),
        )).then((rows) => rows[0] ?? null);
        const decideByDate = input.decideBy && /^\d{4}-\d{2}-\d{2}$/.test(input.decideBy) ? input.decideBy : null;
        const decideBy = input.decideBy === undefined
          ? current?.decideBy ?? null
          : decideByDate ? "date" : input.decideBy;
        const finalDecideByDate = input.decideBy === undefined ? current?.decideByDate ?? null : decideByDate;
        const snoozedUntil = input.snoozedUntil === undefined
          ? current?.snoozedUntil ?? null
          : input.snoozedUntil === null ? null : new Date(input.snoozedUntil);
        if (snoozedUntil && snoozedUntil.getTime() > Date.now() + 5 * 366 * 24 * 60 * 60 * 1_000) {
          throw unprocessable("snoozedUntil must be within five years");
        }
        const now = new Date();
        const values = {
          decideBy,
          decideByDate: finalDecideByDate,
          snoozedUntil,
          setByType: input.actor.actorType as "agent" | "user",
          setByAgentId: input.actor.agentId,
          setByUserId: input.actor.userId,
          setByRunId: input.actor.runId,
          setByAgentApiKeyId: input.actor.agentApiKeyId,
          responsibleUserId: input.actor.responsibleUserId,
          version: (current?.version ?? 0) + 1,
          updatedAt: now,
        };
        const row = await txDb.insert(decisionTriage).values({
          companyId: input.companyId,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          ...values,
        }).onConflictDoUpdate({
          target: [decisionTriage.companyId, decisionTriage.sourceKind, decisionTriage.sourceId],
          set: values,
        }).returning().then((rows) => rows[0]!);
        await txDb.insert(decisionTriageEvents).values({
          companyId: input.companyId,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          action: "triage.updated",
          ...eventActorColumns(input.actor),
          details: {
            previousDecideBy: current ? toTriage(current).decideBy : null,
            decideBy: toTriage(row).decideBy,
            previousSnoozedUntil: current?.snoozedUntil?.toISOString() ?? null,
            snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
            version: row.version,
          },
        });
        await recordActivity(txDb, input.actor, {
          companyId: input.companyId,
          action: "decision_triage.updated",
          entityType: "attention_source",
          entityId: `${input.sourceKind}:${input.sourceId}`,
          details: { sourceKind: input.sourceKind, sourceId: input.sourceId, version: row.version },
        });
        return toTriage(row);
      });
    },

    materializeSeededQueues: async (companyId: string, items: AttentionItem[]) => {
      if (items.length === 0) return;
      const issueIds = [...new Set(items.map(itemIssueId).filter((id): id is string => Boolean(id)))];
      const prIssueIds = new Set(issueIds.length === 0 ? [] : await db
        .select({ issueId: issueWorkProducts.issueId })
        .from(issueWorkProducts)
        .where(and(
          eq(issueWorkProducts.companyId, companyId),
          eq(issueWorkProducts.type, "pull_request"),
          inArray(issueWorkProducts.issueId, issueIds),
        )).then((rows) => rows.map((row) => row.issueId)));

      const matches = new Map<string, AttentionItem[]>();
      for (const item of items) {
        if (prIssueIds.has(itemIssueId(item) ?? "")) {
          matches.set("prs", [...(matches.get("prs") ?? []), item]);
        }
        if (item.sourceKind === "issue_thread_interaction" && item.subject.metadata?.isPlanTarget === true) {
          matches.set("plans", [...(matches.get("plans") ?? []), item]);
        }
        if (item.sourceKind === "issue_thread_interaction" && item.subject.metadata?.kind === "ask_user_questions") {
          matches.set("questions", [...(matches.get("questions") ?? []), item]);
        }
      }

      const matchedSeeds = DECISION_QUEUE_SEEDS.filter((seed) => (matches.get(seed.key)?.length ?? 0) > 0);
      if (matchedSeeds.length === 0) return;
      const existingQueues = await db
        .select({ id: decisionQueues.id, key: decisionQueues.key, seedRulesEnabled: decisionQueues.seedRulesEnabled })
        .from(decisionQueues)
        .where(and(
          eq(decisionQueues.companyId, companyId),
          inArray(decisionQueues.key, matchedSeeds.map((seed) => seed.key)),
        ));
      const existingQueueByKey = new Map(existingQueues.map((queue) => [queue.key, queue]));
      const enabledQueueIds = existingQueues.filter((queue) => queue.seedRulesEnabled).map((queue) => queue.id);
      const matchedSourceIds = [...new Set(matchedSeeds.flatMap((seed) => matches.get(seed.key)!.map((item) => item.subject.id)))];
      const existingItemKeys = new Set(enabledQueueIds.length === 0 ? [] : await db
        .select({
          queueId: decisionQueueItems.queueId,
          sourceKind: decisionQueueItems.sourceKind,
          sourceId: decisionQueueItems.sourceId,
        })
        .from(decisionQueueItems)
        .where(and(
          eq(decisionQueueItems.companyId, companyId),
          inArray(decisionQueueItems.queueId, enabledQueueIds),
          inArray(decisionQueueItems.sourceId, matchedSourceIds),
        ))
        .then((rows) => rows.map((row) => `${row.queueId}:${row.sourceKind}:${row.sourceId}`)));

      for (const seed of matchedSeeds) {
        const matchingItems = matches.get(seed.key)!;
        const existingQueue = existingQueueByKey.get(seed.key);
        if (existingQueue && (!existingQueue.seedRulesEnabled || matchingItems.every((item) =>
          existingItemKeys.has(`${existingQueue.id}:${item.sourceKind}:${item.subject.id}`)))) continue;
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;
          const insertedQueue = await txDb.insert(decisionQueues).values({
            companyId,
            key: seed.key,
            title: seed.title,
            description: seed.description,
            createdByType: "system",
            seedRules: seed.rules,
            seedRulesEnabled: true,
          }).onConflictDoNothing({ target: [decisionQueues.companyId, decisionQueues.key] }).returning();
          const queue = insertedQueue[0] ?? await txDb.select().from(decisionQueues)
            .where(and(eq(decisionQueues.companyId, companyId), eq(decisionQueues.key, seed.key)))
            .then((rows) => rows[0] ?? null);
          if (!queue || !queue.seedRulesEnabled) return;
          if (insertedQueue[0]) {
            await txDb.insert(decisionTriageEvents).values({
              companyId,
              queueId: queue.id,
              action: "queue.seeded",
              ...eventActorColumns(SYSTEM_ACTOR),
              details: { key: seed.key, rules: seed.rules.map((rule) => rule.key) },
            });
            await recordActivity(txDb, SYSTEM_ACTOR, {
              companyId,
              action: "decision_queue.seeded",
              entityType: "decision_queue",
              entityId: queue.id,
              details: { key: seed.key },
            });
          }
          let insertedAnyItem = false;
          for (const item of matchingItems) {
            const inserted = await txDb.insert(decisionQueueItems).values({
              companyId,
              queueId: queue.id,
              sourceKind: item.sourceKind,
              sourceId: item.subject.id,
              addedByType: "system",
            }).onConflictDoNothing({
              target: [decisionQueueItems.queueId, decisionQueueItems.sourceKind, decisionQueueItems.sourceId],
            }).returning();
            if (!inserted[0]) continue;
            insertedAnyItem = true;
            await txDb.insert(decisionTriageEvents).values({
              companyId,
              queueId: queue.id,
              sourceKind: item.sourceKind,
              sourceId: item.subject.id,
              action: "queue_item.seeded",
              ...eventActorColumns(SYSTEM_ACTOR),
              details: { seedKey: seed.key },
            });
            await recordActivity(txDb, SYSTEM_ACTOR, {
              companyId,
              action: "decision_queue_item.seeded",
              entityType: "decision_queue",
              entityId: queue.id,
              details: { sourceKind: item.sourceKind, sourceId: item.subject.id, seedKey: seed.key },
            });
          }
          if (insertedAnyItem) {
            await txDb.update(decisionQueues).set({ updatedAt: new Date() })
              .where(and(eq(decisionQueues.companyId, companyId), eq(decisionQueues.id, queue.id)));
          }
        });
      }
    },
  };
}
