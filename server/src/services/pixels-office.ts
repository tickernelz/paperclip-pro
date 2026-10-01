import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { agents, heartbeatRuns, issues, pixelsOfficeSeats } from "@tickernelz/paperclip-pro-db";
import {
  AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
  deriveAgentUrlKey,
  type IssueStatus,
  type PixelsOfficeAgent,
  type PixelsOfficeSeatAssignment,
  type PixelsOfficeSnapshot,
  type PixelsOfficeTask,
} from "@tickernelz/paperclip-pro-shared";

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
  return Math.max(1, Math.min(50, parsed));
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
      .where(eq(agents.companyId, companyId))
      .orderBy(agents.name);

    if (agentRows.length === 0) {
      return { companyId, agents: [], generatedAt: new Date().toISOString() };
    }

    const agentIds = agentRows.map((row) => row.id);

    const [liveRunRows, openIssueRows] = await Promise.all([
      db
        .select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
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
          ),
        )
        .orderBy(desc(issues.updatedAt)),
    ]);

    const runByAgent = new Map<string, string>();
    const runByIssue = new Map<string, string>();
    for (const run of liveRunRows) {
      if (!runByAgent.has(run.agentId)) runByAgent.set(run.agentId, run.id);
      if (run.issueId && !runByIssue.has(run.issueId)) runByIssue.set(run.issueId, run.id);
    }

    const tasksByAgent = new Map<string, PixelsOfficeTask[]>();
    for (const issue of openIssueRows) {
      const agentId = issue.assigneeAgentId;
      if (!agentId) continue;
      const runId = runByIssue.get(issue.id) ?? null;
      const list = tasksByAgent.get(agentId) ?? [];
      list.push({
        issueId: issue.id,
        identifier: issue.identifier ?? issue.id,
        title: issue.title,
        status: issue.status as IssueStatus,
        runId,
        active: runId !== null,
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
        activeRunId: runByAgent.get(row.id) ?? null,
        activeTaskCount: tasks.filter((task) => task.active).length,
        maxConcurrentRuns: readMaxConcurrentRuns(row.runtimeConfig),
        tasks,
      };
    });

    return { companyId, agents: result, generatedAt: new Date().toISOString() };
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

    const rows = assignments
      .filter((assignment) => knownAgentIds.has(assignment.agentId))
      .map((assignment) => ({
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
