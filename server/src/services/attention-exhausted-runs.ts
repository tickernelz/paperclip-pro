import { and, asc, desc, eq, gt, inArray, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { agents, heartbeatRunEvents, heartbeatRuns, type Db } from "@tickernelz/paperclip-pro-db";

export function listAttentionExhaustedRuns(db: Db, companyId: string) {
  // Recovery can revisit an exhausted run. Deduplicate its historical events
  // before joining run data so duplicate events never multiply the wire payload.
  const latestExhaustion = db
    .selectDistinctOn([heartbeatRunEvents.runId], {
      runId: heartbeatRunEvents.runId,
      eventId: heartbeatRunEvents.id,
      message: heartbeatRunEvents.message,
    })
    .from(heartbeatRunEvents)
    .where(and(
      eq(heartbeatRunEvents.companyId, companyId),
      eq(heartbeatRunEvents.eventType, "lifecycle"),
      sql`${heartbeatRunEvents.message} like 'Bounded retry exhausted%'`,
    ))
    .orderBy(asc(heartbeatRunEvents.runId), desc(heartbeatRunEvents.id))
    .as("latest_exhaustion");

  return db
    .select({
      id: heartbeatRuns.id,
      companyId: heartbeatRuns.companyId,
      agentId: heartbeatRuns.agentId,
      agentName: agents.name,
      status: heartbeatRuns.status,
      error: heartbeatRuns.error,
      errorCode: heartbeatRuns.errorCode,
      // Preserve JSON types and issueId/taskId fallback semantics without
      // transferring prompts, transcripts, or the rest of the run context.
      contextSnapshot: sql<Record<string, unknown>>`jsonb_build_object(
        'issueId', ${heartbeatRuns.contextSnapshot} -> 'issueId',
        'taskId', ${heartbeatRuns.contextSnapshot} -> 'taskId'
      )`,
      createdAt: heartbeatRuns.createdAt,
      updatedAt: heartbeatRuns.updatedAt,
      finishedAt: heartbeatRuns.finishedAt,
      exhaustionMessage: latestExhaustion.message,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
    .innerJoin(latestExhaustion, eq(latestExhaustion.runId, heartbeatRuns.id))
    .where(and(
      eq(heartbeatRuns.companyId, companyId),
      eq(agents.companyId, companyId),
      notInArray(agents.status, ["terminated"]),
      inArray(heartbeatRuns.status, ["failed", "timed_out"]),
    ))
    .orderBy(desc(heartbeatRuns.createdAt), desc(latestExhaustion.eventId));
}

/** Runs whose model fallback chain was exhausted and whose agent has not succeeded since. */
export function listAttentionModelFallbackExhaustedRuns(db: Db, companyId: string) {
  const laterRuns = alias(heartbeatRuns, "later_runs");
  const latestExhaustion = db
    .selectDistinctOn([heartbeatRunEvents.runId], {
      runId: heartbeatRunEvents.runId,
      eventId: heartbeatRunEvents.id,
      message: heartbeatRunEvents.message,
    })
    .from(heartbeatRunEvents)
    .where(and(
      eq(heartbeatRunEvents.companyId, companyId),
      eq(heartbeatRunEvents.eventType, "model.fallback_exhausted"),
    ))
    .orderBy(asc(heartbeatRunEvents.runId), desc(heartbeatRunEvents.id))
    .as("latest_fallback_exhaustion");

  return db
    .select({
      id: heartbeatRuns.id,
      companyId: heartbeatRuns.companyId,
      agentId: heartbeatRuns.agentId,
      agentName: agents.name,
      status: heartbeatRuns.status,
      error: heartbeatRuns.error,
      errorCode: heartbeatRuns.errorCode,
      contextSnapshot: sql<Record<string, unknown>>`jsonb_build_object(
        'issueId', ${heartbeatRuns.contextSnapshot} -> 'issueId',
        'taskId', ${heartbeatRuns.contextSnapshot} -> 'taskId'
      )`,
      createdAt: heartbeatRuns.createdAt,
      updatedAt: heartbeatRuns.updatedAt,
      finishedAt: heartbeatRuns.finishedAt,
      exhaustionMessage: latestExhaustion.message,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
    .innerJoin(latestExhaustion, eq(latestExhaustion.runId, heartbeatRuns.id))
    .where(and(
      eq(heartbeatRuns.companyId, companyId),
      eq(agents.companyId, companyId),
      notInArray(agents.status, ["terminated"]),
      notExists(
        db
          .select({ id: laterRuns.id })
          .from(laterRuns)
          .where(and(
            eq(laterRuns.companyId, companyId),
            eq(laterRuns.agentId, heartbeatRuns.agentId),
            eq(laterRuns.status, "succeeded"),
            gt(laterRuns.createdAt, heartbeatRuns.createdAt),
          )),
      ),
    ))
    .orderBy(desc(heartbeatRuns.createdAt), desc(latestExhaustion.eventId));
}
