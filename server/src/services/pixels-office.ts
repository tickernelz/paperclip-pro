import { and, asc, desc, eq, gte, inArray, isNotNull, like, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  activityLog,
  agents,
  heartbeatRuns,
  issues,
  issueThreadInteractions,
  pixelsOfficeSeats,
} from "@tickernelz/paperclip-pro-db";
import {
  AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
  AGENT_MAX_MAX_CONCURRENT_RUNS,
  AGENT_MIN_MAX_CONCURRENT_RUNS,
  deriveAgentUrlKey,
  PIXELS_OFFICE_TIMELINE_PAGE_LIMIT,
  type IssueStatus,
  type PixelsOfficeAgent,
  type PixelsOfficeAgentProgress,
  type PixelsOfficeCollaborationEdge,
  type PixelsOfficeRunStatus,
  type PixelsOfficeSeatAssignment,
  type PixelsOfficeSnapshot,
  type PixelsOfficeTask,
  type PixelsOfficeTimeline,
  type PixelsOfficeTimelineEvent,
  type PixelsOfficeTimelineQuery,
} from "@tickernelz/paperclip-pro-shared";
import { unprocessable } from "../errors.js";
import { evaluateAgentInvokability, type AgentOrgRow } from "./agent-invokability.js";
import { getHeartbeatRunRuntimeStatus } from "./heartbeat-run-runtime-status.js";
import { canonicalizeStoredResolverPolicy } from "./issue-thread-interaction-resolution.js";
import { visibleIssueCondition } from "./issue-visibility.js";

const OPEN_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;
const LIVE_RUN_STATUSES = ["queued", "running"] as const;
const COLLABORATION_EDGE_LIMIT = 100;
const DELEGATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const TIMELINE_INTERACTION_ACTIONS = [
  "issue.thread_interaction_created",
  "issue.thread_interaction_answered",
  "issue.thread_interaction_accepted",
] as const;
const TIMELINE_ACTIONS = [
  "issue.updated",
  ...TIMELINE_INTERACTION_ACTIONS,
  "routine.run_triggered",
  "budget.hard_threshold_crossed",
] as const;

function readMaxConcurrentRuns(runtimeConfig: unknown): number {
  if (typeof runtimeConfig !== "object" || runtimeConfig === null) {
    return AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
  }
  const heartbeat = (runtimeConfig as Record<string, unknown>).heartbeat;
  if (typeof heartbeat !== "object" || heartbeat === null) {
    return AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
  }
  const raw = (heartbeat as Record<string, unknown>).maxConcurrentRuns;
  const parsed = typeof raw === "number" ? Math.floor(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
  return Math.max(
    AGENT_MIN_MAX_CONCURRENT_RUNS,
    Math.min(AGENT_MAX_MAX_CONCURRENT_RUNS, parsed),
  );
}

function awaitsHumanResolver(
  interaction: {
    addresseeAgentId: string | null;
    addresseeUserId: string | null;
    effectiveResolverPolicy: string;
    resolverPolicyProvenance: string | null;
  },
  invokableAgentIds: Set<string>,
): boolean {
  const policy = canonicalizeStoredResolverPolicy(
    interaction.effectiveResolverPolicy,
    interaction.resolverPolicyProvenance,
  );
  if (policy === "human_only") return true;
  if (interaction.addresseeUserId !== null) return true;
  if (interaction.addresseeAgentId === null) return true;
  return !invokableAgentIds.has(interaction.addresseeAgentId);
}

function runtimeProgress(
  companyId: string,
  agentId: string,
  runId: string | null,
): PixelsOfficeAgentProgress | null {
  if (!runId) return null;
  const status = getHeartbeatRunRuntimeStatus(runId, { companyId, agentId });
  if (!status) return null;
  return {
    runId: status.runId,
    message: status.message.length > 0 ? status.message : null,
    toolName: status.currentToolName,
    updatedAt: status.updatedAt.toISOString(),
  };
}

type OrderedTimelineEvent = { key: string; event: PixelsOfficeTimelineEvent };

function decodeTimelineCursor(cursor: string | undefined): { at: Date; key: string } | null {
  if (!cursor) return null;
  const key = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = key.indexOf("|");
  const at = separator > 0 ? new Date(key.slice(0, separator)) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw unprocessable("Timeline cursor is not readable");
  return { at, key };
}

function readDetailString(details: Record<string, unknown> | null, key: string): string | null {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timelineEventFromActivity(row: {
  id: string;
  action: string;
  entityId: string;
  agentId: string | null;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}): PixelsOfficeTimelineEvent | null {
  const base = {
    at: row.createdAt.toISOString(),
    agentId: row.agentId,
    ...(row.runId ? { runId: row.runId } : {}),
  };
  if (row.action === "issue.updated") {
    const status = readDetailString(row.details, "status");
    if (!status) return null;
    return { ...base, kind: "issue_status", issueId: row.entityId, status };
  }
  if (row.action.startsWith("issue.thread_interaction_")) {
    const addressee = readDetailString(row.details, "addresseeAgentId");
    return {
      ...base,
      kind: "interaction",
      issueId: row.entityId,
      ...(addressee ? { otherAgentId: addressee } : {}),
    };
  }
  if (row.action.startsWith("approval.")) {
    const status = readDetailString(row.details, "status");
    return { ...base, kind: "approval", ...(status ? { status } : {}) };
  }
  if (row.action === "routine.run_triggered") {
    const status = readDetailString(row.details, "status");
    return { ...base, kind: "routine", ...(status ? { status } : {}) };
  }
  if (row.action === "budget.hard_threshold_crossed") return { ...base, kind: "budget" };
  return null;
}

export function pixelsOfficeService(db: Db) {
  async function snapshot(companyId: string): Promise<PixelsOfficeSnapshot> {
    const agentRows = await db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        name: agents.name,
        title: agents.title,
        role: agents.role,
        status: agents.status,
        reportsTo: agents.reportsTo,
        pauseReason: agents.pauseReason,
        runtimeConfig: agents.runtimeConfig,
      })
      .from(agents)
      .where(eq(agents.companyId, companyId))
      .orderBy(agents.name);

    const liveAgentRows = agentRows.filter((row) => row.status !== "terminated");
    if (liveAgentRows.length === 0) {
      return {
        companyId,
        agents: [],
        assignments: [],
        collaboration: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const agentIds = liveAgentRows.map((row) => row.id);
    const agentIdSet = new Set(agentIds);
    const orgRows: AgentOrgRow[] = agentRows;
    const invokableAgentIds = new Set(
      agentRows
        .filter((row) => evaluateAgentInvokability(row, orgRows).invokable)
        .map((row) => row.id),
    );
    const parentIssues = alias(issues, "pixels_office_parent_issues");
    const delegationSince = new Date(Date.now() - DELEGATION_WINDOW_MS);

    const [liveRunRows, openIssueRows, assignments, interactionRows, delegationRows] = await Promise.all([
      db
        .select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          status: heartbeatRuns.status,
          issueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`.as("issueId"),
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.agentId, agentIds),
            inArray(heartbeatRuns.status, [...LIVE_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(heartbeatRuns.createdAt)),
      db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(issues.assigneeAgentId, agentIds),
            inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
            visibleIssueCondition(),
          ),
        )
        .orderBy(desc(issues.updatedAt)),
      listSeatAssignments(companyId),
      db
        .select({
          issueAssigneeAgentId: issues.assigneeAgentId,
          issueId: issueThreadInteractions.issueId,
          createdByAgentId: issueThreadInteractions.createdByAgentId,
          addresseeAgentId: issueThreadInteractions.addresseeAgentId,
          addresseeUserId: issueThreadInteractions.addresseeUserId,
          effectiveResolverPolicy: issueThreadInteractions.effectiveResolverPolicy,
          resolverPolicyProvenance: issueThreadInteractions.resolverPolicyProvenance,
          createdAt: issueThreadInteractions.createdAt,
        })
        .from(issueThreadInteractions)
        .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
        .where(
          and(
            eq(issueThreadInteractions.companyId, companyId),
            eq(issueThreadInteractions.status, "pending"),
            visibleIssueCondition(),
          ),
        )
        .orderBy(desc(issueThreadInteractions.createdAt)),
      db
        .select({
          issueId: issues.id,
          toAgentId: issues.assigneeAgentId,
          fromAgentId: parentIssues.assigneeAgentId,
          createdAt: issues.createdAt,
        })
        .from(issues)
        .innerJoin(parentIssues, eq(parentIssues.id, issues.parentId))
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(parentIssues.companyId, companyId),
            inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
            gte(issues.createdAt, delegationSince),
            isNotNull(issues.assigneeAgentId),
            isNotNull(parentIssues.assigneeAgentId),
            ne(issues.assigneeAgentId, parentIssues.assigneeAgentId),
            visibleIssueCondition(),
          ),
        )
        .orderBy(desc(issues.createdAt))
        .limit(COLLABORATION_EDGE_LIMIT),
    ]);

    const runningRunByAgent = new Map<string, string>();
    const queuedRunByAgent = new Map<string, string>();
    const runByIssue = new Map<string, { id: string; status: PixelsOfficeRunStatus }>();
    for (const run of liveRunRows) {
      const status = run.status as PixelsOfficeRunStatus;
      const byAgent = status === "running" ? runningRunByAgent : queuedRunByAgent;
      if (!byAgent.has(run.agentId)) byAgent.set(run.agentId, run.id);
      if (run.issueId && !runByIssue.has(run.issueId)) {
        runByIssue.set(run.issueId, { id: run.id, status });
      }
    }

    const tasksByAgent = new Map<string, PixelsOfficeTask[]>();
    for (const issue of openIssueRows) {
      const agentId = issue.assigneeAgentId;
      if (!agentId) continue;
      const run = runByIssue.get(issue.id) ?? null;
      const list = tasksByAgent.get(agentId) ?? [];
      list.push({
        issueId: issue.id,
        identifier: issue.identifier ?? issue.id,
        title: issue.title,
        status: issue.status as IssueStatus,
        runId: run?.id ?? null,
        runStatus: run?.status ?? null,
        active: run?.status === "running",
      });
      tasksByAgent.set(agentId, list);
    }

    const pendingInteractionCounts = new Map<string, number>();
    const awaitingBoardCounts = new Map<string, number>();
    const collaboration: PixelsOfficeCollaborationEdge[] = [];
    const waitingAgentIds = new Set<string>();
    for (const interaction of interactionRows) {
      waitingAgentIds.clear();
      if (interaction.issueAssigneeAgentId && agentIdSet.has(interaction.issueAssigneeAgentId)) {
        waitingAgentIds.add(interaction.issueAssigneeAgentId);
      }
      if (interaction.addresseeAgentId && agentIdSet.has(interaction.addresseeAgentId)) {
        waitingAgentIds.add(interaction.addresseeAgentId);
      }
      for (const agentId of waitingAgentIds) {
        pendingInteractionCounts.set(agentId, (pendingInteractionCounts.get(agentId) ?? 0) + 1);
      }

      const creatorId = interaction.createdByAgentId;
      if (creatorId && agentIdSet.has(creatorId) && awaitsHumanResolver(interaction, invokableAgentIds)) {
        awaitingBoardCounts.set(creatorId, (awaitingBoardCounts.get(creatorId) ?? 0) + 1);
      }

      if (
        creatorId
        && interaction.addresseeAgentId
        && creatorId !== interaction.addresseeAgentId
        && agentIdSet.has(creatorId)
        && agentIdSet.has(interaction.addresseeAgentId)
      ) {
        collaboration.push({
          fromAgentId: creatorId,
          toAgentId: interaction.addresseeAgentId,
          kind: "interaction",
          issueId: interaction.issueId,
          since: interaction.createdAt.toISOString(),
        });
      }
    }

    for (const row of delegationRows) {
      if (!row.fromAgentId || !row.toAgentId) continue;
      if (!agentIdSet.has(row.fromAgentId) || !agentIdSet.has(row.toAgentId)) continue;
      collaboration.push({
        fromAgentId: row.fromAgentId,
        toAgentId: row.toAgentId,
        kind: "delegation",
        issueId: row.issueId,
        since: row.createdAt.toISOString(),
      });
    }
    collaboration.sort((left, right) => right.since.localeCompare(left.since));
    collaboration.length = Math.min(collaboration.length, COLLABORATION_EDGE_LIMIT);

    const result: PixelsOfficeAgent[] = liveAgentRows.map((row) => {
      const tasks = tasksByAgent.get(row.id) ?? [];
      const activeRunId = runningRunByAgent.get(row.id) ?? null;
      const queuedRunId = queuedRunByAgent.get(row.id) ?? null;
      return {
        id: row.id,
        name: row.name,
        title: row.title,
        role: row.role,
        status: row.status as PixelsOfficeAgent["status"],
        urlKey: deriveAgentUrlKey(row.name, row.id),
        activeRunId,
        queuedRunId,
        activeTaskCount: tasks.filter((task) => task.active).length,
        queuedTaskCount: tasks.filter((task) => task.runStatus === "queued").length,
        maxConcurrentRuns: readMaxConcurrentRuns(row.runtimeConfig),
        pendingInteractionCount: pendingInteractionCounts.get(row.id) ?? 0,
        awaitingBoardCount: awaitingBoardCounts.get(row.id) ?? 0,
        budgetPaused: row.status === "paused" && row.pauseReason === "budget",
        progress: runtimeProgress(companyId, row.id, activeRunId ?? queuedRunId),
        tasks,
      };
    });

    return {
      companyId,
      agents: result,
      assignments,
      collaboration,
      generatedAt: new Date().toISOString(),
    };
  }

  async function replaceSeatAssignments(
    companyId: string,
    assignments: PixelsOfficeSeatAssignment[],
  ): Promise<PixelsOfficeSeatAssignment[]> {
    const knownAgentIds = new Set(
      (
        await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.companyId, companyId))
      ).map((row) => row.id),
    );

    const unknown = assignments
      .filter((assignment) => !knownAgentIds.has(assignment.agentId))
      .map((assignment) => assignment.agentId);
    if (unknown.length > 0) {
      throw unprocessable("Seat assignments reference agents outside this company", {
        agentIds: unknown,
      });
    }

    const rows = assignments.map((assignment) => ({
      companyId,
      agentId: assignment.agentId,
      characterIndex: assignment.characterIndex,
      seatId: assignment.seatId,
    }));

    await db.transaction(async (tx) => {
      await tx.delete(pixelsOfficeSeats).where(eq(pixelsOfficeSeats.companyId, companyId));
      if (rows.length > 0) {
        await tx.insert(pixelsOfficeSeats).values(rows);
      }
    });

    return rows.map((row) => ({
      agentId: row.agentId,
      characterIndex: row.characterIndex,
      seatId: row.seatId,
    }));
  }

  async function listSeatAssignments(companyId: string): Promise<PixelsOfficeSeatAssignment[]> {
    const rows = await db
      .select({
        agentId: pixelsOfficeSeats.agentId,
        characterIndex: pixelsOfficeSeats.characterIndex,
        seatId: pixelsOfficeSeats.seatId,
      })
      .from(pixelsOfficeSeats)
      .where(eq(pixelsOfficeSeats.companyId, companyId));
    return rows;
  }

  async function timeline(
    companyId: string,
    query: PixelsOfficeTimelineQuery,
  ): Promise<PixelsOfficeTimeline> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const cursor = decodeTimelineCursor(query.cursor);
    const lowerBound = cursor && cursor.at > from ? cursor.at : from;
    const fetchLimit = PIXELS_OFFICE_TIMELINE_PAGE_LIMIT + 1;
    const runOrder = sql`coalesce(${heartbeatRuns.startedAt}, ${heartbeatRuns.finishedAt})`;

    const [runRows, activityRows] = await Promise.all([
      db
        .select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          status: heartbeatRuns.status,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          issueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`.as("issueId"),
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            or(
              and(gte(heartbeatRuns.startedAt, lowerBound), lt(heartbeatRuns.startedAt, to)),
              and(gte(heartbeatRuns.finishedAt, lowerBound), lt(heartbeatRuns.finishedAt, to)),
            ),
          ),
        )
        .orderBy(asc(runOrder), asc(heartbeatRuns.id))
        .limit(fetchLimit),
      db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          entityId: activityLog.entityId,
          agentId: activityLog.agentId,
          runId: activityLog.runId,
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            gte(activityLog.createdAt, lowerBound),
            lt(activityLog.createdAt, to),
            or(
              inArray(activityLog.action, [...TIMELINE_ACTIONS]),
              like(activityLog.action, "approval.%"),
            ),
          ),
        )
        .orderBy(asc(activityLog.createdAt), asc(activityLog.id))
        .limit(fetchLimit),
    ]);

    const ordered: OrderedTimelineEvent[] = [];
    for (const run of runRows) {
      if (run.startedAt && run.startedAt >= from && run.startedAt < to) {
        const at = run.startedAt.toISOString();
        ordered.push({
          key: `${at}|r${run.id}s`,
          event: {
            at,
            agentId: run.agentId,
            kind: "run_started",
            runId: run.id,
            ...(run.issueId ? { issueId: run.issueId } : {}),
          },
        });
      }
      if (run.finishedAt && run.finishedAt >= from && run.finishedAt < to) {
        const at = run.finishedAt.toISOString();
        ordered.push({
          key: `${at}|r${run.id}f`,
          event: {
            at,
            agentId: run.agentId,
            kind: "run_finished",
            runId: run.id,
            status: run.status,
            ...(run.issueId ? { issueId: run.issueId } : {}),
          },
        });
      }
    }
    for (const row of activityRows) {
      const event = timelineEventFromActivity(row);
      if (event) ordered.push({ key: `${event.at}|a${row.id}`, event });
    }

    ordered.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    const cursorKey = cursor?.key ?? null;
    const remaining = cursorKey === null
      ? ordered
      : ordered.filter((entry) => entry.key > cursorKey);
    const page = remaining.slice(0, PIXELS_OFFICE_TIMELINE_PAGE_LIMIT);
    const nextCursor = remaining.length > page.length && page.length > 0
      ? Buffer.from(page[page.length - 1]!.key, "utf8").toString("base64url")
      : null;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      events: page.map((entry) => entry.event),
      nextCursor,
    };
  }

  return { snapshot, replaceSeatAssignments, listSeatAssignments, timeline };
}
