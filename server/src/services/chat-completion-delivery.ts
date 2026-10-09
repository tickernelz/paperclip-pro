import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { agents, agentWakeupRequests, authUsers, chatCompletionDeliveries as deliveries, chatTaskHandoffs as handoffs,
  heartbeatRuns, issueComments, issueDocuments, issueRelations, issues, type Db } from "@tickernelz/paperclip-pro-db";
import { instanceSettingsService } from "./instance-settings.js";
import { publicChatTaskUrl } from "./chat-task-url.js";

export const CHAT_COMPLETION_WAKE_REASON = "chat_task_completed";
const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;
type Issue = typeof issues.$inferSelect;
type Run = typeof heartbeatRuns.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Connection = Db | Tx;
const pending = ["pending", "queued"] as const;
const activeRuns = ["queued", "scheduled_retry", "running"];
export const OPENWA_COMPLETION_STATUSES = ["done", "cancelled", "blocked"] as const;
export const OPENWA_COMPLETION_COALESCE_MS = 60_000;
const OPENWA_TITLE_LIMIT = 200;
const OPENWA_COMMENT_LIMIT = 600;
const OPENWA_MAX_BLOCKERS = 10;
function ids(run: Run): string[] {
  const value = run.contextSnapshot?.chatCompletionDeliveryIds;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface OpenwaBinding { assignedAgentId: string | null; endpointId: string; externalConversationId: string;
  externalThreadId: string; state: string; sessionGeneration: number }

async function openwaBinding(tx: Connection, companyId: string, issueId: string): Promise<OpenwaBinding | null> {
  const rows = await tx.execute(sql`
    select e.assigned_agent_id, c.endpoint_id, c.external_conversation_id, c.external_thread_id, c.state, c.session_generation
    from chat_conversations c
    join chat_endpoints e on e.company_id = c.company_id and e.id = c.endpoint_id and e.provider = 'openwa'
    where c.company_id = ${companyId} and c.issue_id = ${issueId}
    order by c.created_at desc limit 1`) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  return row ? { assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null, endpointId: String(row.endpoint_id),
    externalConversationId: String(row.external_conversation_id), externalThreadId: String(row.external_thread_id),
    state: String(row.state), sessionGeneration: Number(row.session_generation) } : null;
}

async function handoffSource(tx: Connection, companyId: string, runId: string, agentId: string) {
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId),
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)));
  const sourceId = run?.nativeIssueId ?? run?.contextSnapshot?.issueId;
  if (!run || typeof sourceId !== "string") return null;
  const [source] = await tx.select().from(issues).where(and(eq(issues.id, sourceId), eq(issues.companyId, companyId)));
  return source ? { run, source } : null;
}

async function recordOpenwaHandoff(tx: Connection, task: Issue, source: Issue, agentId: string) {
  if (source.id === task.id || source.conversationAgentId) return;
  if ((await openwaBinding(tx, task.companyId, source.id))?.assignedAgentId !== agentId) return;
  await tx.insert(handoffs).values({ taskId: task.id, companyId: task.companyId, conversationId: source.id, agentId,
    sessionGeneration: source.conversationSessionGeneration, channel: "openwa" }).onConflictDoNothing();
}

export async function recordChatHandoff(tx: Connection, task: Issue, actorRunId: string | null | undefined) {
  if (!actorRunId || task.conversationAgentId || !task.createdByAgentId) return;
  const found = await handoffSource(tx, task.companyId, actorRunId, task.createdByAgentId);
  if (!found || found.source.id === task.id) return;
  const { run, source } = found;
  if (!source.conversationAgentId) {
    if (task.assigneeAgentId !== run.agentId) await recordOpenwaHandoff(tx, task, source, run.agentId);
    return;
  }
  if (source.conversationAgentId !== run.agentId ||
    source.conversationSessionGeneration !== run.contextSnapshot?.conversationSessionGeneration) return;
  await tx.insert(handoffs).values({ taskId: task.id, companyId: task.companyId,
    conversationId: source.id, agentId: source.conversationAgentId, sessionGeneration: source.conversationSessionGeneration }).onConflictDoNothing();
}

/** True when every child of an OpenWA conversation issue already reports to its agent through a per-task completion. */
export async function openwaConversationCoversChildren(db: Connection, input: { companyId: string; issueId: string; agentId: string }) {
  if (!(await openwaBinding(db, input.companyId, input.issueId))) return false;
  const [row] = await db.execute(sql`
    select count(*)::int as total, count(h.task_id)::int as covered
    from issues i
    left join chat_task_handoffs h on h.task_id = i.id and h.company_id = i.company_id and h.channel = 'openwa' and h.agent_id = ${input.agentId}
    where i.company_id = ${input.companyId} and i.parent_id = ${input.issueId}`) as unknown as Array<{ total: number; covered: number }>;
  return Boolean(row && row.total > 0 && row.total === row.covered);
}

/** Records an OpenWA handoff when a conversation run hands an existing task to another agent. */
export async function recordChatReassignment(tx: Connection, before: Issue, after: Issue,
  actorAgentId: string | null | undefined, actorRunId: string | null | undefined) {
  if (!actorAgentId || !actorRunId || after.conversationAgentId || !after.assigneeAgentId ||
    after.assigneeAgentId === before.assigneeAgentId || after.assigneeAgentId === actorAgentId) return;
  const found = await handoffSource(tx, after.companyId, actorRunId, actorAgentId);
  if (found) await recordOpenwaHandoff(tx, after, found.source, actorAgentId);
}

/** Must run on the same transaction as status projection (including native arbitration). */
export async function recordChatCompletion(tx: Connection, before: Issue, after: Issue) {
  if (before.status === after.status) return;
  await tx.update(deliveries).set({ status: "superseded" }).where(and(eq(deliveries.taskId, after.id),
    eq(deliveries.companyId, after.companyId), inArray(deliveries.status, [...pending])));
  if (!(OPENWA_COMPLETION_STATUSES as readonly string[]).includes(after.status)) return;
  const [handoff] = await tx.select().from(handoffs).where(and(eq(handoffs.taskId, after.id), eq(handoffs.companyId, after.companyId)));
  if (!handoff) return;
  if (handoff.channel === "openwa") {
    await tx.insert(deliveries).values({ companyId: after.companyId, taskId: after.id, statusVersion: after.statusVersion,
      nextAttemptAt: new Date(Date.now() + OPENWA_COMPLETION_COALESCE_MS) }).onConflictDoNothing();
    return;
  }
  if (after.status === "done") await tx.insert(deliveries).values({ companyId: after.companyId, taskId: after.id, statusVersion: after.statusVersion }).onConflictDoNothing();
}

async function loadAudience(tx: Connection, deliveryId: string) {
  const [row] = await tx.select({ delivery: deliveries, handoff: handoffs, task: issues }).from(deliveries)
    .innerJoin(handoffs, and(eq(handoffs.taskId, deliveries.taskId), eq(handoffs.companyId, deliveries.companyId)))
    .innerJoin(issues, and(eq(issues.id, deliveries.taskId), eq(issues.companyId, deliveries.companyId)))
    .where(eq(deliveries.id, deliveryId));
  if (!row) return null;
  const [source] = await tx.select().from(issues).where(and(eq(issues.id, row.handoff.conversationId), eq(issues.companyId, row.handoff.companyId)));
  const openwa = row.handoff.channel === "openwa" ? await openwaBinding(tx, row.handoff.companyId, row.handoff.conversationId) : null;
  return { ...row, source, openwa };
}
function current(row: NonNullable<Awaited<ReturnType<typeof loadAudience>>>) {
  if (["superseded", "exhausted"].includes(row.delivery.status)) return false;
  if (row.handoff.channel === "openwa")
    return (OPENWA_COMPLETION_STATUSES as readonly string[]).includes(row.task.status) && row.openwa?.assignedAgentId === row.handoff.agentId;
  return row.task.status === "done" &&
    row.source?.conversationAgentId === row.handoff.agentId &&
    row.source.conversationSessionGeneration === row.handoff.sessionGeneration;
}

function clipText(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

async function assigneeName(tx: Connection, task: Issue) {
  if (task.assigneeAgentId) {
    const [agent] = await tx.select({ name: agents.name }).from(agents).where(and(eq(agents.id, task.assigneeAgentId), eq(agents.companyId, task.companyId)));
    return agent?.name ?? null;
  }
  if (task.assigneeUserId) {
    const [user] = await tx.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, task.assigneeUserId));
    return user?.name ?? null;
  }
  return null;
}

/** Per-task facts for an OpenWA completion report; comment and title text is worker-authored data. */
export async function openwaTaskReport(tx: Connection, task: Issue) {
  const [comment] = await tx.select({ body: issueComments.body, createdAt: issueComments.createdAt }).from(issueComments)
    .where(and(eq(issueComments.companyId, task.companyId), eq(issueComments.issueId, task.id),
      task.assigneeAgentId ? eq(issueComments.authorAgentId, task.assigneeAgentId) : sql`${issueComments.authorAgentId} is not null`))
    .orderBy(desc(issueComments.createdAt)).limit(1);
  const blockers = task.status === "blocked"
    ? await tx.select({ identifier: issues.identifier, title: issues.title, status: issues.status }).from(issueRelations)
      .innerJoin(issues, and(eq(issues.id, issueRelations.issueId), eq(issues.companyId, issueRelations.companyId)))
      .where(and(eq(issueRelations.companyId, task.companyId), eq(issueRelations.relatedIssueId, task.id), eq(issueRelations.type, "blocks")))
      .orderBy(asc(issues.issueNumber)).limit(OPENWA_MAX_BLOCKERS)
    : [];
  const reference = task.identifier ?? task.id;
  return {
    identifier: task.identifier,
    title: clipText(task.title, OPENWA_TITLE_LIMIT),
    status: task.status,
    assignee: await assigneeName(tx, task),
    url: publicChatTaskUrl(reference) ?? `/issues/${reference}`,
    at: (task.status === "done" ? task.completedAt : task.status === "cancelled" ? task.cancelledAt : task.blockedTransitionAt)?.toISOString() ?? null,
    latestComment: comment ? clipText(comment.body, OPENWA_COMMENT_LIMIT) : null,
    ...(task.status === "blocked"
      ? { blockedBy: blockers.map(blocker => ({ identifier: blocker.identifier, title: clipText(blocker.title, OPENWA_TITLE_LIMIT), status: blocker.status })),
        unblock: task.unblockDescriptor ?? null }
      : {}),
  };
}
export type OpenwaTaskReport = Awaited<ReturnType<typeof openwaTaskReport>>;

/** Tasks a completion turn of this run reports to its OpenWA conversation; empty for any other run. */
export async function openwaCompletionTasks(db: Connection, input: { companyId: string; runId: string; issueId: string }): Promise<OpenwaTaskReport[]> {
  const rows = await db.select({ task: issues }).from(deliveries)
    .innerJoin(handoffs, and(eq(handoffs.taskId, deliveries.taskId), eq(handoffs.companyId, deliveries.companyId)))
    .innerJoin(issues, and(eq(issues.id, deliveries.taskId), eq(issues.companyId, deliveries.companyId)))
    .where(and(eq(deliveries.companyId, input.companyId), eq(deliveries.targetRunId, input.runId),
      inArray(deliveries.status, ["queued", "delivered"]), eq(handoffs.channel, "openwa"), eq(handoffs.conversationId, input.issueId)))
    .orderBy(asc(deliveries.createdAt), asc(deliveries.id));
  return Promise.all(rows.map(row => openwaTaskReport(db, row.task)));
}

/** True when the run holds server-recorded OpenWA completion deliveries for this conversation issue. */
export async function isOpenwaCompletionTurn(db: Connection, input: { companyId: string; runId: string; issueId: string }) {
  const [row] = await db.select({ id: deliveries.id }).from(deliveries)
    .innerJoin(handoffs, and(eq(handoffs.taskId, deliveries.taskId), eq(handoffs.companyId, deliveries.companyId)))
    .where(and(eq(deliveries.companyId, input.companyId), eq(deliveries.targetRunId, input.runId),
      inArray(deliveries.status, ["queued", "delivered"]), eq(handoffs.channel, "openwa"), eq(handoffs.conversationId, input.issueId)))
    .limit(1);
  return Boolean(row);
}

/** Reserves the run's one origin-chat report for a send action; "reported" when another send already owns it. */
export async function claimOpenwaCompletionReport(db: Db, input: { companyId: string; runId: string; actionId: string }): Promise<"claimed" | "reported" | "none"> {
  return db.transaction(async tx => {
    const rows = await tx.select().from(deliveries)
      .where(and(eq(deliveries.companyId, input.companyId), eq(deliveries.targetRunId, input.runId), inArray(deliveries.status, ["queued", "delivered"])))
      .for("update");
    if (rows.length === 0) return "none";
    if (rows.some(row => row.status === "delivered" || (row.responseActionId && row.responseActionId !== input.actionId))) return "reported";
    await tx.update(deliveries).set({ responseActionId: input.actionId })
      .where(inArray(deliveries.id, rows.map(row => row.id)));
    return "claimed";
  });
}

/** Settles a claimed report: delivered after a confirmed send, released after a send that delivered nothing. */
export async function settleOpenwaCompletionReport(db: Db, input: { companyId: string; actionId: string; delivered: boolean }) {
  const scope = and(eq(deliveries.companyId, input.companyId), eq(deliveries.responseActionId, input.actionId), eq(deliveries.status, "queued"));
  if (input.delivered) await db.update(deliveries).set({ status: "delivered", error: null }).where(scope);
  else await db.update(deliveries).set({ responseActionId: null }).where(scope);
}

async function taskResult(tx: Connection, task: Issue) {
  // Never copy worker-authored titles, comments or document bodies into the
  // source agent's instructions. These links and lifecycle facts are generated
  // by the server; the saved work remains on its normal access-controlled task.
  const documents = await tx.select({ id: issueDocuments.documentId }).from(issueDocuments)
    .where(and(eq(issueDocuments.companyId, task.companyId), eq(issueDocuments.issueId, task.id))).limit(1);
  return { id: task.id, identifier: task.identifier, status: task.status,
    completedAt: task.completedAt, url: `/issues/${task.identifier ?? task.id}`,
    hasSavedDocuments: documents.length > 0 };
}

/** A completed onboarding parent still owes the result of its own child handoff.
 * This permits a reporting turn without reopening Done or reviving cancellation. */
export async function isCompletedOnboardingHandoffWake(db: Connection, input: {
  companyId: string; issueId: string; agentId: string; reason: string | null;
  contextSnapshot: Record<string, unknown>;
}) {
  if (input.reason !== "issue_children_completed" || typeof input.contextSnapshot.completedChildIssueId !== "string") return false;
  const [source] = await db.select().from(issues).where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
  if (source?.originKind !== "onboarding_first_task" || source.status !== "done" || source.assigneeAgentId !== input.agentId) return false;
  const children = await db.select({ id: issues.id, status: issues.status }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.parentId, source.id)));
  return children.some(child => child.id === input.contextSnapshot.completedChildIssueId && child.status === "done") &&
    children.every(child => ["done", "cancelled"].includes(child.status));
}

/** Freeze the input at turn start. New completions cannot be consumed by an already-running turn. */
export async function prepareChatCompletionTurn(db: Db, run: Run): Promise<Run> {
  const issueId = run.contextSnapshot?.issueId;
  if (typeof issueId !== "string") return run;
  return db.transaction(async tx => {
    const [source] = await tx.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId))).for("update");
    if (!source) return run;
    if (source.originKind === "onboarding_first_task" && run.contextSnapshot?.wakeReason === "issue_children_completed") {
      const children = await tx.select().from(issues).where(and(eq(issues.companyId, run.companyId), eq(issues.parentId, source.id), eq(issues.status, "done"))).orderBy(issues.createdAt).limit(20);
      const contextSnapshot = { ...run.contextSnapshot, onboardingCompletion: true,
        chatCompletionUpdates: await Promise.all(children.map(child => taskResult(tx, child))) };
      await tx.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, run.id));
      return { ...run, contextSnapshot };
    }
    const initialIds = ids(run);
    // Only completion wakes absorb pending events; ordinary user turns retain their existing input.
    if (initialIds.length === 0 && run.contextSnapshot?.wakeReason !== CHAT_COMPLETION_WAKE_REASON) return run;
    const channel = source.conversationAgentId ? "board" : "openwa";
    if (channel === "board" && run.contextSnapshot?.conversationSessionGeneration !== source.conversationSessionGeneration) throw new Error("chat_completion_superseded");
    const rows = await tx.select({ delivery: deliveries }).from(deliveries).innerJoin(handoffs, eq(handoffs.taskId, deliveries.taskId))
      .where(and(eq(deliveries.companyId, run.companyId), eq(handoffs.conversationId, issueId),
        eq(handoffs.agentId, run.agentId), eq(handoffs.channel, channel),
        ...(channel === "board" ? [eq(handoffs.sessionGeneration, source.conversationSessionGeneration)] : []),
        inArray(deliveries.status, [...pending]),
        sql`(${deliveries.targetRunId} is null or ${deliveries.targetRunId} = ${run.id})`))
      .orderBy(asc(deliveries.createdAt)).limit(20);
    const updates: Awaited<ReturnType<typeof taskResult>>[] = [];
    const accepted: string[] = [];
    for (const { delivery } of rows) {
      const row = await loadAudience(tx, delivery.id);
      if (!row || !current(row)) {
        await tx.update(deliveries).set({ status: "superseded" }).where(eq(deliveries.id, delivery.id));
        continue;
      }
      accepted.push(delivery.id); updates.push(await taskResult(tx, row.task));
      await tx.update(deliveries).set({ status: "queued", targetRunId: run.id }).where(eq(deliveries.id, delivery.id));
    }
    if (accepted.length === 0) throw new Error("chat_completion_superseded");
    const contextSnapshot = { ...run.contextSnapshot, chatCompletionDeliveryIds: accepted, chatCompletionUpdates: updates,
      ...(channel === "openwa" ? { chatCompletionChannel: channel } : {}) };
    await tx.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, run.id));
    return { ...run, contextSnapshot };
  });
}

export function chatCompletionInstruction(context: Record<string, unknown>) {
  if (!Array.isArray(context.chatCompletionUpdates) || !context.chatCompletionUpdates.length) return "";
  if (context.chatCompletionChannel === "openwa")
    return "\n\nDelegated tasks from this WhatsApp conversation changed state. Report them once in the origin chat exactly as the OpenWA guidance for the `task_completion` wake below says; do nothing else.";
  return `\n\nDelegated work has completed. Tell the user in this conversation what finished and provide access using the supplied task links. Report completion only for the tasks listed in this update; other tasks receive their own completion updates. Use the recorded status and result locations; do not repeat a promise to do work that is already Done. Do not start more work or change these tasks. The following JSON contains server-recorded lifecycle facts and result locations:\n${JSON.stringify(context.chatCompletionUpdates)}`;
}

/** Called under the comment transaction, before insertion. An event can publish only once. */
export async function existingChatCompletionReply(tx: Connection, runId: string, issueId: string) {
  const [run] = await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
  if (!run || ids(run).length === 0) return null;
  const rows = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, run.companyId), inArray(deliveries.id, ids(run))));
  for (const delivery of rows) {
    // Match the status writer's task-first lock order, then reload the outbox
    // row so a concurrent reopen cannot leave us with its pre-commit snapshot.
    await tx.select({ id: issues.id }).from(issues).where(and(eq(issues.id, delivery.taskId), eq(issues.companyId, run.companyId))).for("update");
    const row = await loadAudience(tx, delivery.id);
    if (row?.handoff.channel === "openwa") return null;
    if (!row || row.source?.id !== issueId || row.handoff.agentId !== run.agentId || !current(row)) throw new Error("chat_completion_superseded");
    if (delivery.responseCommentId) {
      const [comment] = await tx.select().from(issueComments).where(and(eq(issueComments.id, delivery.responseCommentId), eq(issueComments.issueId, issueId)));
      if (comment) return comment;
    }
    if (delivery.status !== "queued" || delivery.targetRunId !== runId) throw new Error("chat_completion_superseded");
  }
  if (rows.length !== ids(run).length) throw new Error("chat_completion_superseded");
  return null;
}
export async function acknowledgeChatCompletionReply(tx: Connection, runId: string, commentId: string) {
  await tx.update(deliveries).set({ status: "delivered", responseCommentId: commentId, error: null })
    .where(and(eq(deliveries.targetRunId, runId), eq(deliveries.status, "queued"),
      sql`exists (select 1 from chat_task_handoffs h where h.task_id = ${deliveries.taskId} and h.channel = 'board')`));
}

async function retargetOpenwaHandoffs(db: Db, companyId: string, conversationIssueId: string, binding: OpenwaBinding) {
  const rows = await db.execute(sql`
    select c.issue_id from chat_conversations c
    join issues i on i.id = c.issue_id and i.company_id = c.company_id
    where c.company_id = ${companyId} and c.endpoint_id = ${binding.endpointId}
      and c.external_conversation_id = ${binding.externalConversationId} and c.external_thread_id = ${binding.externalThreadId}
      and c.state <> 'completed' and c.issue_id <> ${conversationIssueId} and i.status not in ('done', 'cancelled')
      and not exists (select 1 from chat_completion_deliveries d join chat_task_handoffs h on h.task_id = d.task_id
        where h.company_id = ${companyId} and h.conversation_id = ${conversationIssueId} and d.status = 'queued')
    order by c.session_generation desc, c.created_at desc limit 1`) as unknown as Array<{ issue_id: string }>;
  const next = rows[0]?.issue_id;
  if (!next) return false;
  await db.update(handoffs).set({ conversationId: next })
    .where(and(eq(handoffs.companyId, companyId), eq(handoffs.conversationId, conversationIssueId), eq(handoffs.channel, "openwa")));
  return true;
}

export function chatCompletionDeliveryService(db: Db, heartbeat: { wakeup(agentId: string, options: {
  source: "automation"; triggerDetail: "system"; reason: string; idempotencyKey: string; allowRunCoalescing: boolean;
  requestedByActorType: "system"; requestedByActorId: string; payload: Record<string, unknown>; contextSnapshot: Record<string, unknown>;
}): Promise<{ id: string } | null> }) {
  async function deliver(id: string): Promise<void> {
    // Lease outbox work before leaving the transaction; recovery reuses the same wake key.
    const claimed = await db.update(deliveries).set({ nextAttemptAt: new Date(Date.now() + LEASE_MS) })
      .where(and(eq(deliveries.id, id), inArray(deliveries.status, [...pending]), lte(deliveries.nextAttemptAt, new Date())))
      .returning().then(rows => rows[0]);
    if (!claimed) return;
    try {
      const row = await loadAudience(db, id);
      if (row?.handoff.channel === "openwa" && row.openwa?.state === "completed" &&
        await retargetOpenwaHandoffs(db, row.handoff.companyId, row.handoff.conversationId, row.openwa)) {
        await db.update(deliveries).set({ nextAttemptAt: new Date() }).where(eq(deliveries.id, id));
        return deliver(id);
      }
      if (!row || !current(row)) {
        await db.update(deliveries).set({ status: "superseded" }).where(eq(deliveries.id, id)); return;
      }
      const experimental = await instanceSettingsService(db).getExperimental();
      if (!(row.handoff.channel === "openwa" ? experimental.enableChatConnectors : experimental.enableAgentChat)) return;
      const [agent] = await db.select().from(agents).where(and(eq(agents.id, row.handoff.agentId), eq(agents.companyId, claimed.companyId)));
      if (!agent || ["paused", "terminated"].includes(agent.status)) return;
      const key = `chat-completion:${id}:${claimed.attempts}`;
      const wakes = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, claimed.companyId), eq(agentWakeupRequests.idempotencyKey, key)));
      const runId = claimed.targetRunId ?? wakes.find(w => w.runId)?.runId;
      if (runId) {
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
        if (run && activeRuns.includes(run.status)) return;
        // A published reply is acknowledged in its own transaction, independent of run outcome.
        const [latest] = await db.select().from(deliveries).where(eq(deliveries.id, id));
        if (!latest || !pending.includes(latest.status as typeof pending[number])) return;
        if (latest.responseActionId) {
          await db.update(deliveries).set({ status: "delivered", error: null })
            .where(and(eq(deliveries.id, id), inArray(deliveries.status, [...pending])));
          return;
        }
        await db.update(deliveries).set({ status: claimed.attempts + 1 >= MAX_ATTEMPTS ? "exhausted" : "pending",
          attempts: claimed.attempts + 1, targetRunId: null, nextAttemptAt: new Date(),
          error: run?.error ?? "Completion turn ended without a reply" })
          .where(and(eq(deliveries.id, id), inArray(deliveries.status, [...pending])));
        // The failed run is already terminal. Reclaim the advanced attempt now;
        // a second lease interval would only delay restart recovery. The atomic
        // claim and fresh wake key still serialize competing sweepers.
        if (claimed.attempts + 1 < MAX_ATTEMPTS) await deliver(id);
        return;
      }
      if (wakes.some(w => ["queued", "claimed", "deferred_issue_execution", "coalesced"].includes(w.status))) return;
      if (wakes.length) {
        // Terminal receipts must advance the key; reusing them collides forever.
        const dailyCap = wakes.some(w => w.reason?.startsWith("heartbeat.daily_"));
        const next = new Date(Date.now() + LEASE_MS);
        if (dailyCap) next.setUTCHours(24, 0, 0, 0);
        await db.update(deliveries).set({ attempts: claimed.attempts + 1, targetRunId: null,
          status: !dailyCap && claimed.attempts + 1 >= MAX_ATTEMPTS ? "exhausted" : "pending",
          nextAttemptAt: next, error: wakes[0].reason ?? "Completion wake did not start" })
          .where(and(eq(deliveries.id, id), inArray(deliveries.status, [...pending])));
        return;
      }
      // One undispatched head per conversation. Its turn absorbs the remaining
      // events at admission; events arriving after admission need a later turn.
      const siblings = await db.select({ delivery: deliveries, run: heartbeatRuns }).from(deliveries)
        .innerJoin(handoffs, eq(handoffs.taskId, deliveries.taskId))
        .leftJoin(heartbeatRuns, eq(heartbeatRuns.id, deliveries.targetRunId))
        .where(and(eq(deliveries.companyId, claimed.companyId), eq(handoffs.conversationId, row.handoff.conversationId),
          eq(handoffs.sessionGeneration, row.handoff.sessionGeneration), inArray(deliveries.status, [...pending])))
        .orderBy(asc(deliveries.createdAt), asc(deliveries.id));
      if (siblings.some(s => s.run && activeRuns.includes(s.run.status) &&
        !Array.isArray(s.run.contextSnapshot?.chatCompletionUpdates))) return;
      if (siblings.find(s => !s.delivery.targetRunId)?.delivery.id !== id) return;
      const run = await heartbeat.wakeup(row.handoff.agentId, {
        source: "automation", triggerDetail: "system", reason: CHAT_COMPLETION_WAKE_REASON, idempotencyKey: key, allowRunCoalescing: false,
        requestedByActorType: "system", requestedByActorId: "chat_completion_delivery",
        payload: { issueId: row.handoff.conversationId, chatCompletionDeliveryIds: [id] },
        contextSnapshot: { issueId: row.handoff.conversationId, taskId: row.handoff.conversationId,
          wakeReason: CHAT_COMPLETION_WAKE_REASON, chatCompletionDeliveryIds: [id],
          ...(row.handoff.channel === "openwa" ? {} : { conversationSessionGeneration: row.handoff.sessionGeneration }) },
      });
      if (!run) {
        const receipts = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests)
          .where(and(eq(agentWakeupRequests.companyId, claimed.companyId), eq(agentWakeupRequests.idempotencyKey, key)));
        if (!receipts.length) throw new Error("Completion wake returned no run or durable receipt");
      }
      if (run) await db.update(deliveries).set({ targetRunId: run.id, status: "queued" })
        .where(and(eq(deliveries.id, id), inArray(deliveries.status, [...pending]), sql`${deliveries.targetRunId} is null`));
    } catch (error) {
      const receipts = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, claimed.companyId), eq(agentWakeupRequests.idempotencyKey, `chat-completion:${id}:${claimed.attempts}`)));
      await db.update(deliveries).set({ error: error instanceof Error ? error.message : String(error),
        ...(receipts.length ? {} : { attempts: claimed.attempts + 1,
          status: claimed.attempts + 1 >= MAX_ATTEMPTS ? "exhausted" as const : "pending" as const }) })
        .where(and(eq(deliveries.id, id), inArray(deliveries.status, [...pending])));
    }
  }
  async function sweepPending(scope?: { companyId: string; taskId: string }) {
    const due = await db.select({ id: deliveries.id }).from(deliveries)
      .where(and(inArray(deliveries.status, [...pending]), lte(deliveries.nextAttemptAt, new Date()),
        ...(scope ? [eq(deliveries.companyId, scope.companyId), eq(deliveries.taskId, scope.taskId)] : [])))
      .orderBy(asc(deliveries.nextAttemptAt)).limit(100);
    for (const row of due) await deliver(row.id);
  }
  return { deliver, sweepPending };
}
