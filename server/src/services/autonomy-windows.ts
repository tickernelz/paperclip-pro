import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { issueAutonomyWindows, issues } from "@tickernelz/paperclip-pro-db";
import {
  AUTONOMY_WINDOW_DEFAULT_HOURS,
  AUTONOMY_WINDOW_MAX_HOURS,
  type AutonomyWindowGrantChannel,
  type IssueAutonomyWindow,
} from "@tickernelz/paperclip-pro-shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";

const AUTONOMY_WINDOW_ANCESTRY_MAX_DEPTH = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WindowRow = typeof issueAutonomyWindows.$inferSelect;
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | DbTransaction;

export type AutonomyWindowActor = {
  userId: string;
  grantedVia: AutonomyWindowGrantChannel;
  agentId?: string | null;
  runId?: string | null;
};

function toWindow(row: WindowRow, root: { identifier: string | null; title: string | null } | null): IssueAutonomyWindow {
  return {
    ...row,
    rootIssueIdentifier: root?.identifier ?? null,
    rootIssueTitle: root?.title ?? null,
  };
}

function activityActor(actor: AutonomyWindowActor) {
  return { actorType: "user" as const, actorId: actor.userId, agentId: null, runId: null };
}

function viaRun(actor: AutonomyWindowActor) {
  return actor.agentId ? { viaAgentId: actor.agentId, viaRunId: actor.runId ?? null } : {};
}

export function autonomyWindowService(db: Db) {
  async function expireStale(executor: Executor, companyId: string, at: Date) {
    await executor
      .update(issueAutonomyWindows)
      .set({ status: "expired", updatedAt: at })
      .where(and(
        eq(issueAutonomyWindows.companyId, companyId),
        eq(issueAutonomyWindows.status, "live"),
        lte(issueAutonomyWindows.expiresAt, at),
      ));
  }

  async function withRoots(rows: WindowRow[]) {
    if (rows.length === 0) return [];
    const roots = await db
      .select({ id: issues.id, identifier: issues.identifier, title: issues.title })
      .from(issues)
      .where(inArray(issues.id, [...new Set(rows.map((row) => row.rootIssueId))]));
    const byId = new Map(roots.map((root) => [root.id, root]));
    return rows.map((row) => toWindow(row, byId.get(row.rootIssueId) ?? null));
  }

  async function resolveIssues(companyId: string, refs: string[]) {
    const resolved: Array<{ id: string; identifier: string | null; title: string }> = [];
    for (const ref of [...new Set(refs.map((value) => value.trim()))]) {
      const [issue] = await db
        .select({ id: issues.id, identifier: issues.identifier, title: issues.title })
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          UUID_RE.test(ref) ? eq(issues.id, ref) : sql`upper(${issues.identifier}) = upper(${ref})`,
        ))
        .limit(1);
      if (!issue) throw notFound(`Issue not found: ${ref}`);
      if (!resolved.some((entry) => entry.id === issue.id)) resolved.push(issue);
    }
    return resolved;
  }

  async function ancestorIds(companyId: string, issueId: string) {
    const rows = await db.execute(sql`
      WITH RECURSIVE ancestors(id, parent_id, depth) AS (
        SELECT id, parent_id, 0
        FROM issues
        WHERE company_id = ${companyId}
          AND id = ${issueId}
        UNION ALL
        SELECT parent.id, parent.parent_id, ancestors.depth + 1
        FROM issues parent
        JOIN ancestors ON parent.id = ancestors.parent_id
        WHERE parent.company_id = ${companyId}
          AND ancestors.depth < ${AUTONOMY_WINDOW_ANCESTRY_MAX_DEPTH}
      )
      SELECT id FROM ancestors
    `);
    const list = Array.isArray(rows) ? rows : [];
    return list
      .map((row) => (row as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === "string");
  }

  return {
    resolveIssues,

    open: async (
      companyId: string,
      input: { issueIds: string[]; hours?: number; maxAccepts?: number | null; note?: string | null },
      actor: AutonomyWindowActor,
    ) => {
      const hours = input.hours ?? AUTONOMY_WINDOW_DEFAULT_HOURS;
      if (!Number.isInteger(hours) || hours < 1 || hours > AUTONOMY_WINDOW_MAX_HOURS) {
        throw unprocessable(`hours must be an integer from 1 to ${AUTONOMY_WINDOW_MAX_HOURS}`);
      }
      const roots = await resolveIssues(companyId, input.issueIds);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
      const rows = await db.transaction(async (tx) => {
        await expireStale(tx, companyId, now);
        const inserted = await tx
          .insert(issueAutonomyWindows)
          .values(roots.map((root) => ({
            companyId,
            rootIssueId: root.id,
            grantedByUserId: actor.userId,
            grantedVia: actor.grantedVia,
            expiresAt,
            maxAccepts: input.maxAccepts ?? null,
            note: input.note ?? null,
            createdAt: now,
            updatedAt: now,
          })))
          .returning();
        for (const row of inserted) {
          await logActivity(tx as unknown as Db, {
            companyId,
            ...activityActor(actor),
            action: "autonomy_window.opened",
            entityType: "issue",
            entityId: row.rootIssueId,
            issueId: row.rootIssueId,
            details: {
              windowId: row.id,
              rootIssueId: row.rootIssueId,
              grantedByUserId: row.grantedByUserId,
              grantedVia: row.grantedVia,
              expiresAt: row.expiresAt.toISOString(),
              maxAccepts: row.maxAccepts,
              ...viaRun(actor),
            },
          });
        }
        return inserted;
      });
      return withRoots(rows);
    },

    close: async (windowId: string, actor: AutonomyWindowActor, companyId?: string) => {
      const now = new Date();
      const [existing] = await db
        .select()
        .from(issueAutonomyWindows)
        .where(eq(issueAutonomyWindows.id, windowId));
      if (!existing || (companyId && existing.companyId !== companyId)) throw notFound("Autonomy window not found");
      const row = await db.transaction(async (tx) => {
        await expireStale(tx, existing.companyId, now);
        const [closed] = await tx
          .update(issueAutonomyWindows)
          .set({ status: "revoked", closedAt: now, closedByUserId: actor.userId, updatedAt: now })
          .where(and(eq(issueAutonomyWindows.id, windowId), eq(issueAutonomyWindows.status, "live")))
          .returning();
        if (!closed) throw conflict("Autonomy window is no longer live", { windowId });
        await logActivity(tx as unknown as Db, {
          companyId: closed.companyId,
          ...activityActor(actor),
          action: "autonomy_window.closed",
          entityType: "issue",
          entityId: closed.rootIssueId,
          issueId: closed.rootIssueId,
          details: {
            windowId: closed.id,
            rootIssueId: closed.rootIssueId,
            closedByUserId: actor.userId,
            closedVia: actor.grantedVia,
            acceptCount: closed.acceptCount,
            ...viaRun(actor),
          },
        });
        return closed;
      });
      return (await withRoots([row]))[0]!;
    },

    getById: async (windowId: string) => {
      const [row] = await db.select().from(issueAutonomyWindows).where(eq(issueAutonomyWindows.id, windowId));
      return row ? (await withRoots([row]))[0]! : null;
    },

    listLive: async (companyId: string) => {
      await expireStale(db, companyId, new Date());
      const rows = await db
        .select()
        .from(issueAutonomyWindows)
        .where(and(eq(issueAutonomyWindows.companyId, companyId), eq(issueAutonomyWindows.status, "live")))
        .orderBy(desc(issueAutonomyWindows.createdAt));
      return withRoots(rows);
    },

    findCovering: async (companyId: string, issueId: string) => {
      await expireStale(db, companyId, new Date());
      const ids = await ancestorIds(companyId, issueId);
      if (ids.length === 0) return null;
      const [row] = await db
        .select()
        .from(issueAutonomyWindows)
        .where(and(
          eq(issueAutonomyWindows.companyId, companyId),
          eq(issueAutonomyWindows.status, "live"),
          inArray(issueAutonomyWindows.rootIssueId, ids),
          sql`${issueAutonomyWindows.expiresAt} > now()`,
          sql`(${issueAutonomyWindows.maxAccepts} is null or ${issueAutonomyWindows.acceptCount} < ${issueAutonomyWindows.maxAccepts})`,
        ))
        .orderBy(desc(issueAutonomyWindows.expiresAt))
        .limit(1);
      return row ? (await withRoots([row]))[0]! : null;
    },

    /** Consumes one accept inside the caller's transaction; false when the window is no longer usable. */
    consumeAccept: async (tx: Executor, windowId: string) => {
      const [row] = await tx
        .update(issueAutonomyWindows)
        .set({ acceptCount: sql`${issueAutonomyWindows.acceptCount} + 1`, updatedAt: new Date() })
        .where(and(
          eq(issueAutonomyWindows.id, windowId),
          eq(issueAutonomyWindows.status, "live"),
          sql`${issueAutonomyWindows.expiresAt} > now()`,
          sql`(${issueAutonomyWindows.maxAccepts} is null or ${issueAutonomyWindows.acceptCount} < ${issueAutonomyWindows.maxAccepts})`,
        ))
        .returning({ id: issueAutonomyWindows.id });
      return Boolean(row);
    },
  };
}
