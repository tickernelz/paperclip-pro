import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { agents, heartbeatRuns, issues, pixelsOfficeSeats } from "@tickernelz/paperclip-pro-db";
import {
  AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
  AGENT_MAX_MAX_CONCURRENT_RUNS,
  AGENT_MIN_MAX_CONCURRENT_RUNS,
  deriveAgentUrlKey,
  type IssueStatus,
  type PixelsOfficeAgent,
  type PixelsOfficeRunStatus,
  type PixelsOfficeSeatAssignment,
  type PixelsOfficeSnapshot,
  type PixelsOfficeTask,
} from "@tickernelz/paperclip-pro-shared";
import { unprocessable } from "../errors.js";
import { visibleIssueCondition } from "./issue-visibility.js";

const OPEN_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;
const LIVE_RUN_STATUSES = ["queued", "running"] as const;

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

export function pixelsOfficeService(db: Db) {
  async function snapshot(companyId: string): Promise<PixelsOfficeSnapshot> {
    const agentRows = await db
      .select({
        id: agents.id,
        name: agents.name,
        title: agents.title,
        role: agents.role,
        status: agents.status,
        runtimeConfig: agents.runtimeConfig,
      })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated")))
      .orderBy(agents.name);

    if (agentRows.length === 0) {
      return { companyId, agents: [], assignments: [], generatedAt: new Date().toISOString() };
    }

    const agentIds = agentRows.map((row) => row.id);

    const [liveRunRows, openIssueRows, assignments] = await Promise.all([
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

    const result: PixelsOfficeAgent[] = agentRows.map((row) => {
      const tasks = tasksByAgent.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        title: row.title,
        role: row.role,
        status: row.status as PixelsOfficeAgent["status"],
        urlKey: deriveAgentUrlKey(row.name, row.id),
        activeRunId: runningRunByAgent.get(row.id) ?? null,
        queuedRunId: queuedRunByAgent.get(row.id) ?? null,
        activeTaskCount: tasks.filter((task) => task.active).length,
        queuedTaskCount: tasks.filter((task) => task.runStatus === "queued").length,
        maxConcurrentRuns: readMaxConcurrentRuns(row.runtimeConfig),
        tasks,
      };
    });

    return { companyId, agents: result, assignments, generatedAt: new Date().toISOString() };
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

  return { snapshot, replaceSeatAssignments, listSeatAssignments };
}
