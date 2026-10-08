import { executionProjectionsForRunRows } from "./execution-projection.js";
import { jsonbRecordFields } from "./jsonb-projection.js";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  activityLog,
  agents,
  documentRevisions,
  documents,
  environmentLeases,
  environments,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
  issueWorkProducts,
  workspaceOperations,
} from "@tickernelz/paperclip-pro-db";
import { hasWorkspaceRestoreFailure, safeWorkspaceRestorePath, ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY } from "@tickernelz/paperclip-pro-shared";
import { logger } from "../middleware/logger.js";
import { visibleIssueCondition } from "./issue-visibility.js";
import { classifyRunLiveness } from "./run-liveness.js";

export interface ActivityFilters {
  companyId: string;
  agentId?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
}

export interface IssueActivityPage {
  limit?: number;
  beforeId?: string;
}

const DEFAULT_ACTIVITY_LIMIT = 100;
const MAX_ACTIVITY_LIMIT = 500;

export function normalizeActivityLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return DEFAULT_ACTIVITY_LIMIT;
  return Math.max(1, Math.min(MAX_ACTIVITY_LIMIT, Math.floor(limit ?? DEFAULT_ACTIVITY_LIMIT)));
}

function issueRunIdCondition(companyId: string, issueId: string) {
  return sql<boolean>`${heartbeatRuns.id} in (
    select issue_run.id
    from ${heartbeatRuns} issue_run
    where issue_run.company_id = ${companyId}
      and issue_run.context_snapshot ->> 'issueId' = ${issueId}
    union
    select ${activityLog.runId}
    from ${activityLog}
    where ${activityLog.companyId} = ${companyId}
      and ${activityLog.entityType} = 'issue'
      and ${activityLog.entityId} = ${issueId}
      and ${activityLog.runId} is not null
  )`;
}

const RUN_JSON_SUMMARY_CACHE_MAX_ENTRIES = 2_000;
const RUN_JSON_SUMMARY_PARALLEL_READS = 4;
const RUN_JSON_SUMMARY_MIN_CHUNK = 16;

type RunJsonSummary = {
  runId: string;
  rowVersion: string;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  context: {
    wakeCommentIds: string[] | null;
    wakeCommentId: string | null;
    commentId: string | null;
    issueId: string | null;
    failureRetriesBeforeAiConnectionWait: unknown;
    failureRetriesBeforeWorkspaceWait: unknown;
    failureRetriesBeforeProcessLoss: unknown;
  } | null;
};

export function activityService(db: Db) {
  const scheduledLivenessBackfills = new Set<string>();
  const runJsonSummaryCache = new Map<string, RunJsonSummary>();
  const issueIdAsText = sql<string>`${issues.id}::text`;
  const usageFields = {
    inputTokens: "jsonb",
    input_tokens: "jsonb",
    outputTokens: "jsonb",
    output_tokens: "jsonb",
    cachedInputTokens: "jsonb",
    cached_input_tokens: "jsonb",
    cache_read_input_tokens: "jsonb",
    billingType: "jsonb",
    billing_type: "jsonb",
    costUsd: "jsonb",
    cost_usd: "jsonb",
    total_cost_usd: "jsonb",
  } as const;
  const summarizedUsageJson = sql<Record<string, unknown> | null>`
    case
      when ${heartbeatRuns.usageJson} is null then null
      else ${jsonbRecordFields(heartbeatRuns.usageJson, usageFields, (usage) => sql`jsonb_strip_nulls(jsonb_build_object(
        'inputTokens', coalesce(${usage("inputTokens")}, ${usage("input_tokens")}),
        'input_tokens', coalesce(${usage("input_tokens")}, ${usage("inputTokens")}),
        'outputTokens', coalesce(${usage("outputTokens")}, ${usage("output_tokens")}),
        'output_tokens', coalesce(${usage("output_tokens")}, ${usage("outputTokens")}),
        'cachedInputTokens', coalesce(${usage("cachedInputTokens")}, ${usage("cached_input_tokens")}, ${usage("cache_read_input_tokens")}),
        'cached_input_tokens', coalesce(${usage("cached_input_tokens")}, ${usage("cachedInputTokens")}, ${usage("cache_read_input_tokens")}),
        'cache_read_input_tokens', coalesce(${usage("cache_read_input_tokens")}, ${usage("cached_input_tokens")}, ${usage("cachedInputTokens")}),
        'billingType', coalesce(${usage("billingType")}, ${usage("billing_type")}),
        'billing_type', coalesce(${usage("billing_type")}, ${usage("billingType")}),
        'costUsd', coalesce(${usage("costUsd")}, ${usage("cost_usd")}, ${usage("total_cost_usd")}),
        'cost_usd', coalesce(${usage("cost_usd")}, ${usage("costUsd")}, ${usage("total_cost_usd")}),
        'total_cost_usd', coalesce(${usage("total_cost_usd")}, ${usage("cost_usd")}, ${usage("costUsd")})
      ))`)}
    end
  `.as("usageJson");
  const resultFields = {
    conversationReset: "jsonb",
    workspaceRestoreFailure: "jsonb",
    workspaceRestorePath: "jsonb",
    finalResponseRecorded: "jsonb",
    billingType: "jsonb",
    billing_type: "jsonb",
    costUsd: "jsonb",
    cost_usd: "jsonb",
    total_cost_usd: "jsonb",
    stopReason: "jsonb",
    effectiveTimeoutSec: "jsonb",
    effectiveTimeoutMs: "jsonb",
    timeoutConfigured: "jsonb",
    timeoutSource: "jsonb",
    timeoutFired: "jsonb",
  } as const;
  const summarizedResultJson = sql<Record<string, unknown> | null>`
    case
      when ${heartbeatRuns.resultJson} is null then null
      else ${jsonbRecordFields(heartbeatRuns.resultJson, resultFields, (result) => sql`jsonb_strip_nulls(jsonb_build_object(
        'conversationReset', ${result("conversationReset")},
        'workspaceRestoreFailure', case when ${result("workspaceRestoreFailure")} #>> '{}'
          in ('restore_permission_denied', 'restore_lock_timeout', 'restore_unsafe_archive', 'restore_failed')
          then ${result("workspaceRestoreFailure")} end,
        'workspaceRestorePath', case when length(${result("workspaceRestorePath")} #>> '{}') <= 180
          then ${result("workspaceRestorePath")} end,
        'finalResponseRecorded', case when jsonb_typeof(${result("finalResponseRecorded")}) = 'boolean'
          then ${result("finalResponseRecorded")} end,
        'billingType', coalesce(${result("billingType")}, ${result("billing_type")}),
        'billing_type', coalesce(${result("billing_type")}, ${result("billingType")}),
        'costUsd', coalesce(${result("costUsd")}, ${result("cost_usd")}, ${result("total_cost_usd")}),
        'cost_usd', coalesce(${result("cost_usd")}, ${result("costUsd")}, ${result("total_cost_usd")}),
        'total_cost_usd', coalesce(${result("total_cost_usd")}, ${result("cost_usd")}, ${result("costUsd")}),
        'stopReason', ${result("stopReason")},
        'effectiveTimeoutSec', ${result("effectiveTimeoutSec")},
        'effectiveTimeoutMs', ${result("effectiveTimeoutMs")},
        'timeoutConfigured', ${result("timeoutConfigured")},
        'timeoutSource', ${result("timeoutSource")},
        'timeoutFired', ${result("timeoutFired")}
      ))`)}
    end
  `.as("resultJson");

  function countValue(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  function dateValue(value: unknown) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  function latestDate(...values: unknown[]) {
    let latest: Date | null = null;
    for (const value of values) {
      const parsed = dateValue(value);
      if (!parsed) continue;
      if (!latest || parsed.getTime() > latest.getTime()) latest = parsed;
    }
    return latest;
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  function readNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  async function backfillMissingRunLivenessForIssue(companyId: string, issueId: string) {
    const runs = await db
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        status: heartbeatRuns.status,
        contextSnapshot: heartbeatRuns.contextSnapshot,
        resultJson: heartbeatRuns.resultJson,
        stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
        stderrExcerpt: heartbeatRuns.stderrExcerpt,
        error: heartbeatRuns.error,
        errorCode: heartbeatRuns.errorCode,
        continuationAttempt: heartbeatRuns.continuationAttempt,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          isNull(heartbeatRuns.livenessState),
          sql`${heartbeatRuns.status} not in ('queued', 'running')`,
          issueRunIdCondition(companyId, issueId),
        ),
      )
      .limit(20);

    if (runs.length === 0) return;

    const issue = await db
      .select({
        status: issues.status,
        title: issues.title,
        description: issues.description,
        workMode: issues.workMode,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)))
      .then((rows) => rows[0] ?? null);

    for (const run of runs) {
      const context = asRecord(run.contextSnapshot);
      const continuationAttempt =
        readNumber(context?.continuationAttempt) ??
        readNumber(context?.livenessContinuationAttempt) ??
        run.continuationAttempt ??
        0;

      const [commentStats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          latestAt: sql<Date | null>`max(${issueComments.createdAt})`,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, companyId),
            eq(issueComments.issueId, issueId),
            eq(issueComments.createdByRunId, run.id),
          ),
        );

      const [documentStats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          planCount: sql<number>`count(*) filter (where ${issueDocuments.key} = 'plan')::int`,
          latestAt: sql<Date | null>`max(${documentRevisions.createdAt})`,
        })
        .from(documentRevisions)
        .innerJoin(issueDocuments, eq(documentRevisions.documentId, issueDocuments.documentId))
        .where(
          and(
            eq(documentRevisions.companyId, companyId),
            eq(documentRevisions.createdByRunId, run.id),
            eq(issueDocuments.companyId, companyId),
            eq(issueDocuments.issueId, issueId),
            sql`${issueDocuments.key} != ${ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY}`,
          ),
        );

      const [workProductStats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          latestAt: sql<Date | null>`max(${issueWorkProducts.createdAt})`,
        })
        .from(issueWorkProducts)
        .where(
          and(
            eq(issueWorkProducts.companyId, companyId),
            eq(issueWorkProducts.issueId, issueId),
            eq(issueWorkProducts.createdByRunId, run.id),
          ),
        );

      const [workspaceOperationStats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          latestAt: sql<Date | null>`max(${workspaceOperations.startedAt})`,
        })
        .from(workspaceOperations)
        .where(and(eq(workspaceOperations.companyId, companyId), eq(workspaceOperations.heartbeatRunId, run.id)));

      const [activityStats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          latestAt: sql<Date | null>`max(${activityLog.createdAt})`,
        })
        .from(activityLog)
        .where(and(eq(activityLog.companyId, companyId), eq(activityLog.runId, run.id)));

      const [eventStats] = await db
        .select({
          count: sql<number>`count(*) filter (where ${heartbeatRunEvents.eventType} not in ('lifecycle', 'adapter.invoke', 'error'))::int`,
          latestAt: sql<Date | null>`max(${heartbeatRunEvents.createdAt}) filter (where ${heartbeatRunEvents.eventType} not in ('lifecycle', 'adapter.invoke', 'error'))`,
        })
        .from(heartbeatRunEvents)
        .where(and(eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, run.id)));

      const classification = classifyRunLiveness({
        runStatus: run.status,
        issue,
        resultJson: asRecord(run.resultJson),
        stdoutExcerpt: run.stdoutExcerpt,
        stderrExcerpt: run.stderrExcerpt,
        error: run.error,
        errorCode: run.errorCode,
        continuationAttempt,
        evidence: {
          issueCommentsCreated: countValue(commentStats?.count),
          documentRevisionsCreated: countValue(documentStats?.count),
          planDocumentRevisionsCreated: countValue(documentStats?.planCount),
          workProductsCreated: countValue(workProductStats?.count),
          workspaceOperationsCreated: countValue(workspaceOperationStats?.count),
          activityEventsCreated: countValue(activityStats?.count),
          toolOrActionEventsCreated: countValue(eventStats?.count),
          latestEvidenceAt: latestDate(
            commentStats?.latestAt,
            documentStats?.latestAt,
            workProductStats?.latestAt,
            workspaceOperationStats?.latestAt,
            activityStats?.latestAt,
            eventStats?.latestAt,
          ),
        },
      });

      await db
        .update(heartbeatRuns)
        .set({
          livenessState: classification.livenessState,
          livenessReason: classification.livenessReason,
          continuationAttempt: classification.continuationAttempt,
          lastUsefulActionAt: classification.lastUsefulActionAt,
          nextAction: classification.nextAction,
          updatedAt: new Date(),
        })
        .where(and(eq(heartbeatRuns.id, run.id), isNull(heartbeatRuns.livenessState)));
    }
  }

  async function runJsonSummaries(
    companyId: string,
    runs: ReadonlyArray<{ runId: string; rowVersion: string }>,
  ) {
    const summaries = new Map<string, RunJsonSummary>();
    const misses: string[] = [];
    for (const run of runs) {
      const cached = runJsonSummaryCache.get(run.runId);
      if (cached?.rowVersion === run.rowVersion) {
        runJsonSummaryCache.delete(run.runId);
        runJsonSummaryCache.set(run.runId, cached);
        summaries.set(run.runId, cached);
      } else {
        misses.push(run.runId);
      }
    }
    if (misses.length === 0) return summaries;
    const chunkSize = Math.ceil(misses.length / Math.min(RUN_JSON_SUMMARY_PARALLEL_READS, Math.ceil(misses.length / RUN_JSON_SUMMARY_MIN_CHUNK)));
    const chunks = Array.from({ length: Math.ceil(misses.length / chunkSize) }, (_, index) =>
      misses.slice(index * chunkSize, (index + 1) * chunkSize));
    const rows = (await Promise.all(chunks.map((chunk) => db
      .select({
        runId: heartbeatRuns.id,
        rowVersion: sql<string>`${heartbeatRuns}.xmin::text`,
        usageJson: summarizedUsageJson,
        resultJson: summarizedResultJson,
        context: jsonbRecordFields<RunJsonSummary["context"]>(heartbeatRuns.contextSnapshot, {
          wakeCommentIds: "jsonb",
          wakeCommentId: "text",
          commentId: "text",
          issueId: "text",
          failureRetriesBeforeAiConnectionWait: "jsonb",
          failureRetriesBeforeWorkspaceWait: "jsonb",
          failureRetriesBeforeProcessLoss: "jsonb",
        }),
      })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, chunk)))))).flat();
    for (const row of rows) {
      summaries.set(row.runId, row);
      runJsonSummaryCache.delete(row.runId);
      runJsonSummaryCache.set(row.runId, row);
    }
    for (const runId of runJsonSummaryCache.keys()) {
      if (runJsonSummaryCache.size <= RUN_JSON_SUMMARY_CACHE_MAX_ENTRIES) break;
      runJsonSummaryCache.delete(runId);
    }
    return summaries;
  }

  function scheduleRunLivenessBackfill(companyId: string, issueId: string) {
    const key = `${companyId}:${issueId}`;
    if (scheduledLivenessBackfills.has(key)) return;
    scheduledLivenessBackfills.add(key);
    void backfillMissingRunLivenessForIssue(companyId, issueId)
      .catch((err: unknown) => {
        logger.warn({ err, companyId, issueId }, "run liveness backfill failed");
      })
      .finally(() => {
        scheduledLivenessBackfills.delete(key);
      });
  }

  return {
    list: (filters: ActivityFilters) => {
      const conditions = [eq(activityLog.companyId, filters.companyId)];
      const limit = normalizeActivityLimit(filters.limit);

      if (filters.agentId) {
        conditions.push(eq(activityLog.agentId, filters.agentId));
      }
      if (filters.entityType) {
        conditions.push(eq(activityLog.entityType, filters.entityType));
      }
      if (filters.entityId) {
        conditions.push(eq(activityLog.entityId, filters.entityId));
      }

      return db
        .select({ activityLog })
        .from(activityLog)
        .leftJoin(
          issues,
          and(
            eq(activityLog.entityType, sql`'issue'`),
            eq(activityLog.entityId, issueIdAsText),
          ),
        )
        .where(
          and(
            ...conditions,
            or(
              sql`${activityLog.entityType} != 'issue'`,
              visibleIssueCondition(),
            ),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(limit)
        .then((rows) => rows.map((r) => r.activityLog));
    },

    forIssue: (issueId: string, page: IssueActivityPage = {}) => {
      const query = db
        .select({
          ...getTableColumns(activityLog),
          details: sql<Record<string, unknown> | null>`${activityLog.details} - 'currentReferencedIssues'`,
        })
        .from(activityLog)
        .where(
          and(
            or(
              and(eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId)),
              and(or(eq(activityLog.action, "project.created"), eq(activityLog.action, "company.skill_created")), sql`${activityLog.details}->>'sourceIssueId' = ${issueId}`,
                sql`${activityLog.companyId} = (select company_id from issues where id = ${issueId})`),
            ),
            page.beforeId
              ? sql`(${activityLog.createdAt}, ${activityLog.id}) < (select cursor.created_at, cursor.id from ${activityLog} cursor where cursor.id = ${page.beforeId})`
              : undefined,
          ),
        )
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id));
      return page.limit === undefined ? query : query.limit(page.limit);
    },

    runsForIssue: async (companyId: string, issueId: string) => {
      scheduleRunLivenessBackfill(companyId, issueId);
      const runRows = await db
        .select({
          runId: heartbeatRuns.id,
          rowVersion: sql<string>`${heartbeatRuns}.xmin::text`,
          runtimeMode: heartbeatRuns.runtimeMode,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          adapterType: agents.adapterType,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          createdAt: heartbeatRuns.createdAt,
          invocationSource: heartbeatRuns.invocationSource,
          responsibleUserId: heartbeatRuns.responsibleUserId,
          errorCode: heartbeatRuns.errorCode,
          logBytes: heartbeatRuns.logBytes,
          retryOfRunId: heartbeatRuns.retryOfRunId,
          scheduledRetryAt: heartbeatRuns.scheduledRetryAt,
          scheduledRetryAttempt: heartbeatRuns.scheduledRetryAttempt,
          scheduledRetryReason: heartbeatRuns.scheduledRetryReason,
          livenessState: heartbeatRuns.livenessState,
          livenessReason: heartbeatRuns.livenessReason,
          continuationAttempt: heartbeatRuns.continuationAttempt,
          lastUsefulActionAt: heartbeatRuns.lastUsefulActionAt,
          nextAction: heartbeatRuns.nextAction,
          executionControlDeadlineAt: heartbeatRuns.executionControlDeadlineAt,
          lastOutputAt: heartbeatRuns.lastOutputAt,
          nativeIssueId: heartbeatRuns.nativeIssueId,
          processPid: heartbeatRuns.processPid,
        })
        .from(heartbeatRuns)
        .innerJoin(
          agents,
          and(
            eq(agents.id, heartbeatRuns.agentId),
            eq(agents.companyId, heartbeatRuns.companyId),
          ),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            issueRunIdCondition(companyId, issueId),
          ),
        )
        .orderBy(desc(heartbeatRuns.createdAt));
      const jsonByRunId = await runJsonSummaries(companyId, runRows);
      const executionRuns = runRows.map((row) => {
        const json = jsonByRunId.get(row.runId);
        return {
          id: row.runId,
          errorCode: row.errorCode,
          executionControlDeadlineAt: row.executionControlDeadlineAt,
          finishedAt: row.finishedAt,
          lastOutputAt: row.lastOutputAt,
          lastUsefulActionAt: row.lastUsefulActionAt,
          nativeIssueId: row.nativeIssueId,
          nextAction: row.nextAction,
          processPid: row.processPid,
          retryOfRunId: row.retryOfRunId,
          runtimeMode: row.runtimeMode,
          scheduledRetryAt: row.scheduledRetryAt,
          scheduledRetryAttempt: row.scheduledRetryAttempt,
          scheduledRetryReason: row.scheduledRetryReason,
          startedAt: row.startedAt,
          status: row.status,
          contextSnapshot: {
            issueId: json?.context?.issueId ?? null,
            failureRetriesBeforeAiConnectionWait: json?.context?.failureRetriesBeforeAiConnectionWait ?? null,
            failureRetriesBeforeWorkspaceWait: json?.context?.failureRetriesBeforeWorkspaceWait ?? null,
            failureRetriesBeforeProcessLoss: json?.context?.failureRetriesBeforeProcessLoss ?? null,
          },
        };
      });
      const runs = runRows.map((row) => {
        const json = jsonByRunId.get(row.runId);
        return {
          runId: row.runId,
          runtimeMode: row.runtimeMode,
          status: row.status,
          agentId: row.agentId,
          adapterType: row.adapterType,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          createdAt: row.createdAt,
          invocationSource: row.invocationSource,
          responsibleUserId: row.responsibleUserId,
          errorCode: row.errorCode,
          usageJson: json?.usageJson ?? null,
          resultJson: json?.resultJson ?? null,
          logBytes: row.logBytes,
          retryOfRunId: row.retryOfRunId,
          scheduledRetryAt: row.scheduledRetryAt,
          scheduledRetryAttempt: row.scheduledRetryAttempt,
          scheduledRetryReason: row.scheduledRetryReason,
          livenessState: row.livenessState,
          livenessReason: row.livenessReason,
          continuationAttempt: row.continuationAttempt,
          lastUsefulActionAt: row.lastUsefulActionAt,
          nextAction: row.nextAction,
          wakeCommentIds: json?.context?.wakeCommentIds ?? null,
          wakeCommentId: json?.context?.wakeCommentId ?? null,
          contextCommentId: json?.context?.commentId ?? null,
          contextIssueId: json?.context?.issueId ?? null,
        };
      });

      if (runs.length === 0) return runs;
      const runIds = runs.map((run) => run.runId);
      if (runIds.length === 0) return runs;

      const exhaustionRowsQuery = db
        .select({
          runId: heartbeatRunEvents.runId,
          message: heartbeatRunEvents.message,
        })
        .from(heartbeatRunEvents)
        .where(
          and(
            inArray(heartbeatRunEvents.runId, runIds),
            eq(heartbeatRunEvents.eventType, "lifecycle"),
            sql`${heartbeatRunEvents.message} like 'Bounded retry exhausted%'`,
          ),
        )
        .orderBy(asc(heartbeatRunEvents.runId), desc(heartbeatRunEvents.id));

      const leaseRowsQuery = db
        .select({
          lease: environmentLeases,
          environment: {
            id: environments.id,
            name: environments.name,
            driver: environments.driver,
          },
        })
        .from(environmentLeases)
        .innerJoin(environments, eq(environmentLeases.environmentId, environments.id))
        .where(
          and(
            eq(environmentLeases.companyId, companyId),
            inArray(environmentLeases.heartbeatRunId, runIds),
          ),
        )
        .orderBy(desc(environmentLeases.lastUsedAt), desc(environmentLeases.createdAt));

      // Only stored, current plan revisions can support a saved-plan link.
      // Do not trust an adapter's claim that it wrote a document.
      const savedPlanQuery = runs.some((run) => hasWorkspaceRestoreFailure(run.resultJson))
        ? db.select({ revisionId: documentRevisions.id, runId: documentRevisions.createdByRunId })
          .from(issueDocuments)
          .innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, companyId)))
          .innerJoin(documentRevisions, and(eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id), eq(documentRevisions.companyId, companyId)))
          .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, "plan")))
          .limit(1)
        : Promise.resolve([]);
      const [exhaustionRows, leaseRows, executionByRunId, [savedPlan]] = await Promise.all([
        exhaustionRowsQuery,
        leaseRowsQuery,
        executionProjectionsForRunRows(db, companyId, executionRuns),
        savedPlanQuery,
      ]);
      const retryExhaustedReasonByRunId = new Map<string, string>();
      for (const row of exhaustionRows) {
        if (!row.message || retryExhaustedReasonByRunId.has(row.runId)) continue;
        retryExhaustedReasonByRunId.set(row.runId, row.message);
      }

      const leaseByRunId = new Map<string, (typeof leaseRows)[number]>();
      for (const row of leaseRows) {
        if (row.lease.heartbeatRunId && !leaseByRunId.has(row.lease.heartbeatRunId)) {
          leaseByRunId.set(row.lease.heartbeatRunId, row);
        }
      }

      return runs.map((run) => {
        const leaseRow = leaseByRunId.get(run.runId);
        const leaseMetadata = leaseRow?.lease.metadata ?? null;
        const workspacePath =
          typeof leaseMetadata?.remoteCwd === "string" && leaseMetadata.remoteCwd.trim().length > 0
            ? leaseMetadata.remoteCwd
            : typeof leaseMetadata?.remoteWorkspacePath === "string" && leaseMetadata.remoteWorkspacePath.trim().length > 0
              ? leaseMetadata.remoteWorkspacePath
              : null;
        return {
          ...run,
          resultJson: run.resultJson ? {
            ...run.resultJson,
            ...(Object.hasOwn(run.resultJson, "workspaceRestorePath") ? {
              workspaceRestorePath: safeWorkspaceRestorePath(run.resultJson.workspaceRestorePath),
            } : {}),
            ...(hasWorkspaceRestoreFailure(run.resultJson) ? {
              ...(savedPlan?.runId === run.runId ? { savedPlanRevisionId: savedPlan.revisionId } : {}),
            } : {}),
          } : null,
          execution: executionByRunId.get(run.runId) ?? null,
          environment: leaseRow
            ? {
                id: leaseRow.environment.id,
                name: leaseRow.environment.name,
                driver: leaseRow.environment.driver,
              }
            : null,
          environmentLease: leaseRow
            ? {
                id: leaseRow.lease.id,
                status: leaseRow.lease.status,
                leasePolicy: leaseRow.lease.leasePolicy,
                provider: leaseRow.lease.provider,
                providerLeaseId: leaseRow.lease.providerLeaseId,
                executionWorkspaceId: leaseRow.lease.executionWorkspaceId,
                workspacePath,
                failureReason: leaseRow.lease.failureReason,
                cleanupStatus: leaseRow.lease.cleanupStatus,
                acquiredAt: leaseRow.lease.acquiredAt,
                releasedAt: leaseRow.lease.releasedAt,
              }
            : null,
          retryExhaustedReason: retryExhaustedReasonByRunId.get(run.runId) ?? null,
        };
      });
    },

    issuesForRun: async (runId: string) => {
      const run = await db
        .select({
          companyId: heartbeatRuns.companyId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      if (!run) return [];

      const fromActivity = await db
        .selectDistinctOn([issueIdAsText], {
          issueId: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(activityLog)
        .innerJoin(issues, eq(activityLog.entityId, issueIdAsText))
        .where(
          and(
            eq(activityLog.companyId, run.companyId),
            eq(activityLog.runId, runId),
            eq(activityLog.entityType, "issue"),
            visibleIssueCondition(),
          ),
        )
        .orderBy(issueIdAsText);

      const context = run.contextSnapshot;
      const contextIssueId =
        context && typeof context === "object" && typeof (context as Record<string, unknown>).issueId === "string"
          ? ((context as Record<string, unknown>).issueId as string)
          : null;
      if (!contextIssueId) return fromActivity;
      if (fromActivity.some((issue) => issue.issueId === contextIssueId)) return fromActivity;

      const fromContext = await db
        .select({
          issueId: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, run.companyId),
            eq(issues.id, contextIssueId),
            visibleIssueCondition(),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!fromContext) return fromActivity;
      return [fromContext, ...fromActivity];
    },

    create: (data: typeof activityLog.$inferInsert) =>
      db
        .insert(activityLog)
        .values(data)
        .returning()
        .then((rows) => rows[0]),
  };
}
