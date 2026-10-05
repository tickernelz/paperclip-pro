import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { chatActions, chatConversations, chatDeliveries, heartbeatRuns, issues, type Db } from "@tickernelz/paperclip-pro-db";
import { forbidden } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { createDurableChatWakeupRequest } from "../durable-chat-wakeup.js";
import type { IssueAssignmentWakeupDeps } from "../issue-assignment-wakeup.js";
import { issueService } from "../issues.js";
import { recordOpenwaAudit } from "./audit.js";
import { readOpenwaRunContext } from "./authority.js";
import { OPENWA_HANDOFF_ACTION_KIND } from "./tools.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const OPENWA_STEERED_OWNER_ACTION_KIND = "openwa_steered_owner";
export const OPENWA_FOLLOWUP_WAKE_ACTION_KIND = "openwa_followup_wakeup";
export const OPENWA_FOLLOWUP_WAKE_ACTOR_ID = "openwa:followup";
const WAKE_MAX_ATTEMPTS = 5;
const WAKE_STALE_PROCESSING_MS = 2 * 60_000;
const TERMINAL_RUN_STATUSES = ["succeeded", "interrupted", "failed", "cancelled", "timed_out"];
export const OPENWA_RUN_RETRY_WAKE_ACTION_KIND = "openwa_run_retry_wakeup";
export const OPENWA_RUN_RETRY_WAKE_ACTOR_ID = "openwa:run-retry";
export const OPENWA_RUN_RETRY_DELAY_MS = 45_000;
const RETRYABLE_RUN_STATUSES = ["failed", "timed_out"];
const ACTIVE_RETRY_RUN_STATUSES = ["scheduled_retry", "queued", "running"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OpenwaFollowupRuntime {
  wakeup: IssueAssignmentWakeupDeps["wakeup"];
}

const runtimes = new WeakMap<Db, OpenwaFollowupRuntime>();

export function registerOpenwaFollowupRuntime(db: Db, runtime: OpenwaFollowupRuntime): () => void {
  runtimes.set(db, runtime);
  return () => {
    if (runtimes.get(db) === runtime) runtimes.delete(db);
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function uuids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && UUID.test(id)))] : [];
}

function followupActionId(runId: string, conversationId: string): string {
  return "openwa-followup:" + runId + ":" + conversationId;
}

/** Records owner triggers steered into a read_only run so the run end can schedule a follow-up owner run for any still pending. */
export async function recordSteeredOwnerTriggers(
  db: Db,
  input: { companyId: string; endpointId: string; conversationId: string; issueId: string; runId: string; chatKey: string; deliveryIds: string[] },
): Promise<void> {
  const ids = uuids(input.deliveryIds);
  if (!ids.length) return;
  const payload = { version: 1, runId: input.runId, issueId: input.issueId, chatKey: input.chatKey, triggerIds: ids };
  await db
    .insert(chatActions)
    .values({
      companyId: input.companyId,
      endpointId: input.endpointId,
      conversationId: input.conversationId,
      kind: OPENWA_STEERED_OWNER_ACTION_KIND,
      providerActionId: "openwa-steered-owner:" + input.runId + ":" + input.conversationId,
      status: "received",
      payload,
    })
    .onConflictDoUpdate({
      target: [chatActions.endpointId, chatActions.providerActionId],
      set: {
        payload: sql`jsonb_set(${chatActions.payload}, '{triggerIds}', (select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements_text(coalesce(${chatActions.payload} -> 'triggerIds', '[]'::jsonb) || ${JSON.stringify(ids)}::jsonb)))`,
        updatedAt: new Date(),
      },
      setWhere: sql`${chatActions.companyId} = ${input.companyId} and ${chatActions.status} = 'received'`,
    });
}

async function stageFollowup(
  tx: DbTransaction,
  input: { companyId: string; endpointId: string; conversationId: string; runId: string },
): Promise<string | null> {
  const sources = await tx
    .select()
    .from(chatActions)
    .where(
      and(
        eq(chatActions.companyId, input.companyId),
        eq(chatActions.endpointId, input.endpointId),
        eq(chatActions.conversationId, input.conversationId),
        inArray(chatActions.kind, [OPENWA_HANDOFF_ACTION_KIND, OPENWA_STEERED_OWNER_ACTION_KIND]),
        eq(chatActions.status, "received"),
        sql`${chatActions.payload} ->> 'runId' = ${input.runId}`,
      ),
    )
    .orderBy(asc(chatActions.createdAt))
    .for("update");
  if (!sources.length) return null;
  const now = new Date();
  const markProcessed = (code: string, wakeActionId: string | null) =>
    tx
      .update(chatActions)
      .set({ status: "processed", result: { code, followupActionId: wakeActionId }, updatedAt: now })
      .where(and(eq(chatActions.companyId, input.companyId), inArray(chatActions.id, sources.map((row) => row.id))));
  const handoffs = sources.filter((row) => row.kind === OPENWA_HANDOFF_ACTION_KIND);
  const handedOff = uuids(handoffs.flatMap((row) => uuids(row.payload.triggerIds)));
  const steered = uuids(sources.filter((row) => row.kind === OPENWA_STEERED_OWNER_ACTION_KIND).flatMap((row) => uuids(row.payload.triggerIds)));
  const candidates = uuids([...handedOff, ...steered]);
  const live = candidates.length
    ? await tx
        .select({ id: chatDeliveries.id, answerState: chatDeliveries.answerState })
        .from(chatDeliveries)
        .where(
          and(
            eq(chatDeliveries.companyId, input.companyId),
            eq(chatDeliveries.endpointId, input.endpointId),
            eq(chatDeliveries.conversationId, input.conversationId),
            eq(chatDeliveries.triggerClass, "owner"),
            inArray(chatDeliveries.id, candidates),
          ),
        )
    : [];
  const deliveryIds = candidates.filter((id) => {
    const row = live.find((entry) => entry.id === id);
    if (!row) return false;
    return handedOff.includes(id) ? row.answerState === "handed_off" : row.answerState === "pending";
  });
  if (!deliveryIds.length) {
    await markProcessed("openwa_followup_not_needed", null);
    return null;
  }
  const [conversation] = await tx
    .select({ issueId: chatConversations.issueId })
    .from(chatConversations)
    .where(and(eq(chatConversations.companyId, input.companyId), eq(chatConversations.id, input.conversationId)))
    .limit(1);
  const [issue] = conversation
    ? await tx
        .select({ id: issues.id, assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(and(eq(issues.companyId, input.companyId), eq(issues.id, conversation.issueId)))
        .limit(1)
    : [];
  if (!issue?.assigneeAgentId) {
    await markProcessed("openwa_followup_target_missing", null);
    return null;
  }
  const notes = handoffs.map((row) => (typeof row.payload.note === "string" ? row.payload.note.trim() : "")).filter(Boolean);
  const body = [
    "Follow-up owner run for WhatsApp owner requests the previous run could not carry out.",
    notes.length ? "Handoff note" + (notes.length > 1 ? "s" : "") + ":\n" + notes.map((note) => "- " + note).join("\n") : null,
    "Owner trigger ids: " + deliveryIds.join(", ") + ".",
  ].filter(Boolean).join("\n\n");
  const comment = await issueService(tx as unknown as Db).addComment(issue.id, body, {}, { authorType: "system" }, tx);
  const providerActionId = followupActionId(input.runId, input.conversationId);
  const [action] = await tx
    .insert(chatActions)
    .values({
      companyId: input.companyId,
      endpointId: input.endpointId,
      conversationId: input.conversationId,
      kind: OPENWA_FOLLOWUP_WAKE_ACTION_KIND,
      providerActionId,
      status: "queued",
      payload: {
        version: 1,
        issueId: issue.id,
        agentId: issue.assigneeAgentId,
        commentId: comment.id,
        sourceRunId: input.runId,
        sourceActionIds: sources.map((row) => row.id),
        openwa: { event: "message", triggerClass: "owner", deliveryIds },
      },
    })
    .onConflictDoNothing()
    .returning({ id: chatActions.id });
  const actionId = action?.id ??
    (await tx
      .select({ id: chatActions.id })
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, input.endpointId), eq(chatActions.providerActionId, providerActionId)))
      .then((rows) => rows[0]?.id ?? null));
  await markProcessed("openwa_followup_staged", actionId);
  return actionId;
}

/** Stages at most one follow-up owner wake per finished run and conversation, from its handoff rows and still-pending steered owner triggers. */
export async function scheduleOpenwaFollowupForRun(db: Db, input: { companyId: string; runId: string }): Promise<string[]> {
  const [run] = await db
    .select({ status: heartbeatRuns.status, openwa: sql<boolean>`coalesce(${heartbeatRuns.contextSnapshot} ? 'paperclipOpenwa', false)` })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId)))
    .limit(1);
  if (!run || !run.openwa || !TERMINAL_RUN_STATUSES.includes(run.status)) return [];
  const groups = await db
    .selectDistinct({ endpointId: chatActions.endpointId, conversationId: chatActions.conversationId })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.companyId, input.companyId),
        inArray(chatActions.kind, [OPENWA_HANDOFF_ACTION_KIND, OPENWA_STEERED_OWNER_ACTION_KIND]),
        eq(chatActions.status, "received"),
        sql`${chatActions.payload} ->> 'runId' = ${input.runId}`,
      ),
    );
  const staged: string[] = [];
  for (const group of groups) {
    if (!group.conversationId) continue;
    const actionId = await db.transaction((tx) =>
      stageFollowup(tx, { companyId: input.companyId, endpointId: group.endpointId, conversationId: group.conversationId!, runId: input.runId }));
    if (actionId) staged.push(actionId);
  }
  for (const actionId of staged) await dispatchOpenwaFollowupWake(db, actionId);
  return staged;
}

/** Dispatches a staged follow-up owner wake; the chat action id is the wake request id, so FixA resolves the owner class from it. */
export async function dispatchOpenwaFollowupWake(db: Db, actionId: string): Promise<boolean> {
  const runtime = runtimes.get(db);
  if (!runtime) return false;
  const now = new Date();
  const [claimed] = await db
    .update(chatActions)
    .set({ status: "processing", updatedAt: now })
    .where(
      and(
        eq(chatActions.id, actionId),
        eq(chatActions.kind, OPENWA_FOLLOWUP_WAKE_ACTION_KIND),
        or(
          eq(chatActions.status, "queued"),
          and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, new Date(now.getTime() - WAKE_STALE_PROCESSING_MS))),
        ),
      ),
    )
    .returning();
  if (!claimed) return false;
  const payload = claimed.payload;
  const attemptCount = Number(record(claimed.result).attemptCount ?? 0) + 1;
  const settle = (status: string, result: Record<string, unknown>) =>
    db
      .update(chatActions)
      .set({ status, result: { ...result, attemptCount }, updatedAt: new Date() })
      .where(and(eq(chatActions.id, claimed.id), eq(chatActions.status, "processing")));
  try {
    const issueId = String(payload.issueId);
    const agentId = String(payload.agentId);
    const commentId = String(payload.commentId);
    const openwa = record(payload.openwa);
    const deliveryIds = uuids(openwa.deliveryIds);
    const [issue] = await db
      .select({ identifier: issues.identifier, assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, claimed.companyId), eq(issues.id, issueId)))
      .limit(1);
    if (!issue || issue.assigneeAgentId !== agentId || issue.status === "backlog") {
      await settle("failed", { code: "openwa_followup_target_changed" });
      return false;
    }
    const request = createDurableChatWakeupRequest({
      id: claimed.id,
      companyId: claimed.companyId,
      agentId,
      issueId,
      commentId,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_FOLLOWUP_WAKE_ACTOR_ID,
      requestedAt: claimed.createdAt,
      authorize: async (tx) => {
        const rows = deliveryIds.length
          ? await tx
              .select({ id: chatDeliveries.id })
              .from(chatDeliveries)
              .where(
                and(
                  eq(chatDeliveries.companyId, claimed.companyId),
                  eq(chatDeliveries.endpointId, claimed.endpointId),
                  eq(chatDeliveries.triggerClass, "owner"),
                  inArray(chatDeliveries.id, deliveryIds),
                ),
              )
          : [];
        if (!rows.length || rows.length !== deliveryIds.length)
          throw forbidden("The follow-up owner triggers changed", { code: "chat_action_authorization_changed" });
      },
    });
    const context = { issueId, taskKey: issue.identifier, wakeCommentId: commentId, openwa };
    await runtime.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "OpenWA owner follow-up",
      payload: { ...context, mutation: "openwa_owner_followup" },
      contextSnapshot: { ...context, source: "chat:openwa" },
      requestedByActorType: "system",
      requestedByActorId: OPENWA_FOLLOWUP_WAKE_ACTOR_ID,
      durableChatRequest: request,
    });
    await settle("processed", { code: "openwa_followup_dispatched", wakeupRequestId: claimed.id });
    return true;
  } catch (error) {
    logger.warn({ err: error, actionId: claimed.id }, "failed to dispatch OpenWA follow-up owner wake");
    await settle(attemptCount >= WAKE_MAX_ATTEMPTS ? "failed" : "queued", {
      code: "openwa_followup_wake_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Restart recovery: stages follow-ups for finished runs whose handoff rows were never processed, then dispatches queued or stale follow-up wakes. */
export async function processPendingOpenwaFollowups(db: Db, limit = 25): Promise<number> {
  if (!runtimes.get(db)) return 0;
  const sources = await db
    .selectDistinct({ companyId: chatActions.companyId, runId: sql<string>`${chatActions.payload} ->> 'runId'` })
    .from(chatActions)
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.companyId, chatActions.companyId),
        sql`${heartbeatRuns.id}::text = ${chatActions.payload} ->> 'runId'`,
        inArray(heartbeatRuns.status, TERMINAL_RUN_STATUSES),
      ),
    )
    .where(and(inArray(chatActions.kind, [OPENWA_HANDOFF_ACTION_KIND, OPENWA_STEERED_OWNER_ACTION_KIND]), eq(chatActions.status, "received")))
    .limit(limit);
  for (const source of sources) await scheduleOpenwaFollowupForRun(db, { companyId: source.companyId, runId: source.runId });
  const staleBefore = new Date(Date.now() - WAKE_STALE_PROCESSING_MS);
  const wakes = await db
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.kind, OPENWA_FOLLOWUP_WAKE_ACTION_KIND),
        or(eq(chatActions.status, "queued"), and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, staleBefore))),
      ),
    )
    .orderBy(asc(chatActions.createdAt))
    .limit(limit);
  for (const wake of wakes) await dispatchOpenwaFollowupWake(db, wake.id);
  return sources.length + wakes.length;
}

function runRetryActionId(deliveryIds: string[]): string {
  return "openwa-run-retry:" + createHash("sha256").update([...deliveryIds].sort().join(",")).digest("hex");
}

/** Stages at most one delayed retry wake per pending trigger set of a failed or timed-out OpenWA run; a failed retry leaves a run_failed audit entry instead. */
export async function scheduleOpenwaRunRetryForRun(db: Db, input: { companyId: string; runId: string; now?: Date }): Promise<string | null> {
  const [run] = await db
    .select({
      status: heartbeatRuns.status,
      errorCode: heartbeatRuns.errorCode,
      agentId: heartbeatRuns.agentId,
      wakeupRequestId: heartbeatRuns.wakeupRequestId,
      contextSnapshot: heartbeatRuns.contextSnapshot,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId)))
    .limit(1);
  if (!run || !RETRYABLE_RUN_STATUSES.includes(run.status)) return null;
  const openwa = readOpenwaRunContext(run.contextSnapshot);
  const issueId = typeof run.contextSnapshot?.issueId === "string" ? run.contextSnapshot.issueId : null;
  if (!openwa || !issueId || !openwa.deliveryIds.length) return null;
  const [nativeRetry] = await db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.retryOfRunId, input.runId), inArray(heartbeatRuns.status, ACTIVE_RETRY_RUN_STATUSES)))
    .limit(1);
  if (nativeRetry) return null;
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(and(eq(chatConversations.companyId, input.companyId), eq(chatConversations.endpointId, openwa.endpointId), eq(chatConversations.issueId, issueId)))
      .limit(1);
    if (!conversation) return null;
    const steered = await tx
      .select({ payload: chatActions.payload })
      .from(chatActions)
      .where(
        and(
          eq(chatActions.companyId, input.companyId),
          eq(chatActions.endpointId, openwa.endpointId),
          eq(chatActions.conversationId, conversation.id),
          inArray(chatActions.kind, [OPENWA_HANDOFF_ACTION_KIND, OPENWA_STEERED_OWNER_ACTION_KIND]),
          sql`${chatActions.payload} ->> 'runId' = ${input.runId}`,
        ),
      );
    const followedUp = new Set(steered.flatMap((row) => uuids(row.payload.triggerIds)));
    const pending = await tx
      .select({ id: chatDeliveries.id, principalId: chatDeliveries.principalId })
      .from(chatDeliveries)
      .where(
        and(
          eq(chatDeliveries.companyId, input.companyId),
          eq(chatDeliveries.endpointId, openwa.endpointId),
          eq(chatDeliveries.conversationId, conversation.id),
          eq(chatDeliveries.answerState, "pending"),
          inArray(chatDeliveries.id, openwa.deliveryIds),
        ),
      );
    const deliveryIds = openwa.deliveryIds.filter((id) => !followedUp.has(id) && pending.some((row) => row.id === id));
    if (!deliveryIds.length) return null;
    const exhaust = async (retry: typeof chatActions.$inferSelect) => {
      const [marked] = await tx
        .update(chatActions)
        .set({ result: sql`coalesce(${chatActions.result}, '{}'::jsonb) || ${JSON.stringify({ exhaustedByRunId: input.runId })}::jsonb`, updatedAt: new Date() })
        .where(and(eq(chatActions.id, retry.id), isNull(sql`${chatActions.result} ->> 'exhaustedByRunId'`)))
        .returning({ id: chatActions.id });
      if (!marked) return null;
      await recordOpenwaAudit(tx as unknown as Db, {
        companyId: input.companyId,
        endpointId: openwa.endpointId,
        conversationId: conversation.id,
        chatKey: openwa.chatKey,
        kind: "run_failed",
        actorKind: "system",
        actorRef: OPENWA_RUN_RETRY_WAKE_ACTOR_ID,
        runId: input.runId,
        metadata: {
          reason: "retry_failed",
          status: run.status,
          errorCode: run.errorCode,
          triggerIds: deliveryIds,
          retryActionId: retry.id,
          firstFailedRunId: typeof retry.payload.sourceRunId === "string" ? retry.payload.sourceRunId : null,
        },
      });
      return null;
    };
    if (run.wakeupRequestId) {
      const [retryWake] = await tx
        .select()
        .from(chatActions)
        .where(and(eq(chatActions.companyId, input.companyId), eq(chatActions.id, run.wakeupRequestId), eq(chatActions.kind, OPENWA_RUN_RETRY_WAKE_ACTION_KIND)))
        .limit(1);
      if (retryWake) return exhaust(retryWake);
    }
    const providerActionId = runRetryActionId(deliveryIds);
    const [existing] = await tx
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, openwa.endpointId), eq(chatActions.providerActionId, providerActionId)))
      .limit(1);
    if (existing) return existing.payload.sourceRunId === input.runId || existing.status === "queued" ? null : exhaust(existing);
    const [issue] = await tx
      .select({ assigneeAgentId: issues.assigneeAgentId })
      .from(issues)
      .where(and(eq(issues.companyId, input.companyId), eq(issues.id, issueId)))
      .limit(1);
    if (!issue?.assigneeAgentId) return null;
    const now = input.now ?? new Date();
    const body = [
      "Retrying the WhatsApp reply after run " + input.runId + " ended " + run.status + (run.errorCode ? " (" + run.errorCode + ")" : "") + ".",
      "Trigger ids: " + deliveryIds.join(", ") + ".",
    ].join("\n\n");
    const comment = await issueService(tx as unknown as Db).addComment(issueId, body, {}, { authorType: "system" }, tx);
    const [action] = await tx
      .insert(chatActions)
      .values({
        companyId: input.companyId,
        endpointId: openwa.endpointId,
        conversationId: conversation.id,
        principalId: pending.find((row) => row.id === deliveryIds.at(-1))?.principalId ?? null,
        kind: OPENWA_RUN_RETRY_WAKE_ACTION_KIND,
        providerActionId,
        status: "queued",
        payload: {
          version: 1,
          issueId,
          agentId: issue.assigneeAgentId,
          commentId: comment.id,
          sourceRunId: input.runId,
          notBefore: new Date(now.getTime() + OPENWA_RUN_RETRY_DELAY_MS).toISOString(),
          openwa: { event: openwa.event === "owner_absent" ? "owner_absent" : "message", triggerClass: openwa.triggerClass, deliveryIds },
        },
      })
      .onConflictDoNothing()
      .returning({ id: chatActions.id });
    return action?.id ?? null;
  });
}

/** Dispatches a due retry wake when its triggers are still pending; the chat action id is the wake request id. */
export async function dispatchOpenwaRunRetryWake(db: Db, actionId: string, now = new Date()): Promise<boolean> {
  const runtime = runtimes.get(db);
  if (!runtime) return false;
  const [claimed] = await db
    .update(chatActions)
    .set({ status: "processing", updatedAt: now })
    .where(
      and(
        eq(chatActions.id, actionId),
        eq(chatActions.kind, OPENWA_RUN_RETRY_WAKE_ACTION_KIND),
        sql`(${chatActions.payload} ->> 'notBefore')::timestamptz <= ${now.toISOString()}::timestamptz`,
        or(
          eq(chatActions.status, "queued"),
          and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, new Date(now.getTime() - WAKE_STALE_PROCESSING_MS))),
        ),
      ),
    )
    .returning();
  if (!claimed) return false;
  const payload = claimed.payload;
  const attemptCount = Number(record(claimed.result).attemptCount ?? 0) + 1;
  const settle = (status: string, result: Record<string, unknown>) =>
    db
      .update(chatActions)
      .set({ status, result: { ...record(claimed.result), ...result, attemptCount }, updatedAt: new Date() })
      .where(and(eq(chatActions.id, claimed.id), eq(chatActions.status, "processing")));
  try {
    const issueId = String(payload.issueId);
    const agentId = String(payload.agentId);
    const commentId = String(payload.commentId);
    const openwa = record(payload.openwa);
    const deliveryIds = uuids(openwa.deliveryIds);
    const live = deliveryIds.length
      ? await db
          .select({ id: chatDeliveries.id })
          .from(chatDeliveries)
          .where(
            and(
              eq(chatDeliveries.companyId, claimed.companyId),
              eq(chatDeliveries.endpointId, claimed.endpointId),
              eq(chatDeliveries.answerState, "pending"),
              inArray(chatDeliveries.id, deliveryIds),
            ),
          )
      : [];
    if (!live.length) {
      await settle("processed", { code: "openwa_run_retry_not_needed" });
      return false;
    }
    const [nativeRetry] = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, claimed.companyId), sql`${heartbeatRuns.retryOfRunId}::text = ${String(payload.sourceRunId)}`, inArray(heartbeatRuns.status, ACTIVE_RETRY_RUN_STATUSES)))
      .limit(1);
    if (nativeRetry) {
      await settle("processed", { code: "openwa_run_retry_native", nativeRetryRunId: nativeRetry.id });
      return false;
    }
    const [issue] = await db
      .select({ identifier: issues.identifier, assigneeAgentId: issues.assigneeAgentId, status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, claimed.companyId), eq(issues.id, issueId)))
      .limit(1);
    if (!issue || issue.assigneeAgentId !== agentId || issue.status === "backlog") {
      await settle("failed", { code: "openwa_run_retry_target_changed" });
      return false;
    }
    const request = createDurableChatWakeupRequest({
      id: claimed.id,
      companyId: claimed.companyId,
      agentId,
      issueId,
      commentId,
      requestedByActorType: "system",
      requestedByActorId: OPENWA_RUN_RETRY_WAKE_ACTOR_ID,
      requestedAt: claimed.createdAt,
      authorize: async (tx) => {
        const rows = await tx
          .select({ id: chatDeliveries.id })
          .from(chatDeliveries)
          .where(and(eq(chatDeliveries.companyId, claimed.companyId), eq(chatDeliveries.endpointId, claimed.endpointId), inArray(chatDeliveries.id, deliveryIds)));
        if (rows.length !== deliveryIds.length)
          throw forbidden("The retried triggers changed", { code: "chat_action_authorization_changed" });
      },
    });
    const context = { issueId, taskKey: issue.identifier, wakeCommentId: commentId, openwa };
    await runtime.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "OpenWA retry after failed run",
      payload: { ...context, mutation: "openwa_run_retry" },
      contextSnapshot: { ...context, source: "chat:openwa" },
      requestedByActorType: "system",
      requestedByActorId: OPENWA_RUN_RETRY_WAKE_ACTOR_ID,
      durableChatRequest: request,
    });
    await settle("processed", { code: "openwa_run_retry_dispatched", wakeupRequestId: claimed.id });
    return true;
  } catch (error) {
    logger.warn({ err: error, actionId: claimed.id }, "failed to dispatch OpenWA run retry wake");
    await settle(attemptCount >= WAKE_MAX_ATTEMPTS ? "failed" : "queued", {
      code: "openwa_run_retry_wake_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Dispatches due or stale retry wakes. */
export async function processPendingOpenwaRunRetries(db: Db, limit = 25, now = new Date()): Promise<number> {
  if (!runtimes.get(db)) return 0;
  const staleBefore = new Date(now.getTime() - WAKE_STALE_PROCESSING_MS);
  const wakes = await db
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.kind, OPENWA_RUN_RETRY_WAKE_ACTION_KIND),
        or(
          and(eq(chatActions.status, "queued"), sql`(${chatActions.payload} ->> 'notBefore')::timestamptz <= ${now.toISOString()}::timestamptz`),
          and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, staleBefore)),
        ),
      ),
    )
    .orderBy(asc(chatActions.createdAt))
    .limit(limit);
  for (const wake of wakes) await dispatchOpenwaRunRetryWake(db, wake.id, now);
  return wakes.length;
}

