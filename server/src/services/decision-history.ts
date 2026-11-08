import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  agents,
  approvals,
  authUsers,
  decisionQueueItems,
  decisionQueues,
  decisions,
  issueApprovals,
  issueThreadInteractions,
  issues,
  joinRequests,
} from "@tickernelz/paperclip-pro-db";
import {
  DECISION_HISTORY_SOURCE_KINDS,
  DECISION_HISTORY_PAGE_MAX_LIMIT,
  type ResolvedDecisionActor,
  type ResolvedDecisionEntry,
  type ResolvedDecisionIssueRef,
  type ResolvedDecisionPage,
  type ResolvedDecisionQuery,
  type ResolvedDecisionSourceKind,
  type ResolvedDecisionStatus,
} from "@tickernelz/paperclip-pro-shared";
import { badRequest, notFound } from "../errors.js";
import { approvalTitle, attentionService, companyPrefix, interactionLabel, issueHref } from "./attention.js";
import { issueReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { readableDecisionSourceKeys, type DecisionQueueCounts } from "./decision-queues.js";

const TERMINAL_STATUSES: Record<ResolvedDecisionSourceKind, Record<ResolvedDecisionStatus, readonly string[]>> = {
  issue_thread_interaction: { decided: ["answered", "accepted", "rejected"], expired: ["expired", "cancelled"] },
  approval: { decided: ["approved", "rejected"], expired: ["cancelled"] },
  decision: { decided: ["decided"], expired: ["expired", "cancelled"] },
  join_request: { decided: ["approved", "rejected"], expired: [] },
};

const INTERACTION_KIND_LABELS: Record<string, string> = {
  ask_user_questions: "Questions",
  request_confirmation: "Confirmation",
  request_checkbox_confirmation: "Selection",
  suggest_tasks: "Suggested tasks",
  request_item_verdicts: "Item verdicts",
  connection_intent: "Connection request",
};

const DECISION_EXPIRED_REASONS: Record<string, string> = {
  ttl: "Time limit reached",
  target_gone: "Target task was removed",
  target_completed: "Target tasks were completed",
};

const RESULT_MAX_LENGTH = 280;
const TITLE_MAX_LENGTH = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

type HistoryCursor = { at: string; kind: ResolvedDecisionSourceKind; id: string };

type HistoryScope = {
  companyId: string;
  prefix: string;
  readCondition: SQL<boolean>;
  queueId: string | null;
  since: string | null;
  until: string | null;
  cursor: HistoryCursor | null;
};

type HistoryRow = ResolvedDecisionEntry & { cursorAt: string };

function terminalStatuses(statuses: Iterable<string>) {
  return sql.raw([...statuses].map((status) => `'${status}'`).join(", "));
}

function statusIn(column: AnyPgColumn, statuses: readonly string[]) {
  return sql`${column} in (${terminalStatuses(statuses)})`;
}

function cursorText(expression: SQL | AnyPgColumn) {
  return sql<string>`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function encodeCursor(row: HistoryRow) {
  return Buffer.from(JSON.stringify({ at: row.cursorAt, kind: row.sourceKind, id: row.sourceId })).toString("base64url");
}

function decodeCursor(value: string): HistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<HistoryCursor>;
    if (
      typeof parsed.at === "string" && CURSOR_AT_PATTERN.test(parsed.at)
      && typeof parsed.id === "string" && UUID_PATTERN.test(parsed.id)
      && (DECISION_HISTORY_SOURCE_KINDS as readonly string[]).includes(parsed.kind ?? "")
    ) {
      return { at: parsed.at, kind: parsed.kind as ResolvedDecisionSourceKind, id: parsed.id };
    }
  } catch {
    throw badRequest("Invalid decision history cursor");
  }
  throw badRequest("Invalid decision history cursor");
}

function compareRows(left: HistoryRow, right: HistoryRow) {
  if (left.cursorAt !== right.cursorAt) return left.cursorAt < right.cursorAt ? 1 : -1;
  if (left.sourceKind !== right.sourceKind) return left.sourceKind < right.sourceKind ? 1 : -1;
  if (left.sourceId === right.sourceId) return 0;
  return left.sourceId < right.sourceId ? 1 : -1;
}

function scopeConditions(
  scope: HistoryScope,
  kind: ResolvedDecisionSourceKind,
  at: SQL | AnyPgColumn,
  id: AnyPgColumn,
  withCursor: boolean,
) {
  const conditions: SQL[] = [];
  if (scope.since) conditions.push(sql`${at} >= ${scope.since}::timestamptz`);
  if (scope.until) conditions.push(sql`${at} <= ${scope.until}::timestamptz`);
  if (scope.queueId) {
    conditions.push(sql`exists (select 1 from ${decisionQueueItems}
      where ${decisionQueueItems.queueId} = ${scope.queueId}
        and ${decisionQueueItems.sourceKind} = ${kind}
        and ${decisionQueueItems.sourceId} = ${id}::text)`);
  }
  const cursor = withCursor ? scope.cursor : null;
  if (cursor) {
    const cursorAt = sql`${cursor.at}::timestamptz`;
    if (kind < cursor.kind) conditions.push(sql`${at} <= ${cursorAt}`);
    else if (kind > cursor.kind) conditions.push(sql`${at} < ${cursorAt}`);
    else conditions.push(sql`(${at}, ${id}) < (${cursorAt}, ${cursor.id}::uuid)`);
  }
  return conditions;
}

function clip(value: string, max: number) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function humanize(value: string) {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinParts(parts: Array<string | null | undefined>) {
  const text = parts.filter((part): part is string => Boolean(part)).join(" · ");
  return text ? clip(text, RESULT_MAX_LENGTH) : null;
}

function decider(userId: string | null, userName: string | null, agentId: string | null, agentName: string | null): ResolvedDecisionActor {
  if (userId) return { type: "user", userId, agentId: null, name: userName };
  if (agentId) return { type: "agent", userId: null, agentId, name: agentName };
  return { type: "system", userId: null, agentId: null, name: null };
}

function issueRef(prefix: string, issue: { id: string | null; identifier: string | null; title: string | null }): ResolvedDecisionIssueRef | null {
  if (!issue.id) return null;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title ?? "",
    href: issueHref(prefix, { id: issue.id, identifier: issue.identifier }),
  };
}

function optionLabels(options: unknown, ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const labels = new Map<string, string>();
  for (const option of Array.isArray(options) ? options : []) {
    const record = readRecord(option);
    const id = readString(record.id);
    const label = readString(record.label);
    if (id && label) labels.set(id, label);
  }
  return ids.filter((id): id is string => typeof id === "string").map((id) => labels.get(id) ?? id);
}

function interactionTitle(kind: string, title: string | null, payload: Record<string, unknown>) {
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const firstPrompt = readString(readRecord(questions[0]).prompt);
  const text = readString(title) ?? readString(payload.title) ?? readString(payload.prompt) ?? firstPrompt;
  return clip(text ?? interactionLabel(kind), TITLE_MAX_LENGTH);
}

function closedReason(result: Record<string, unknown>) {
  const reason = readString(result.expirationReason)
    ?? readString(result.cancellationReason)
    ?? readString(result.outcome)
    ?? readString(result.reason);
  return reason ? humanize(reason) : null;
}

export function interactionResultSummary(
  kind: string,
  status: string,
  rawPayload: unknown,
  rawResult: unknown,
): string | null {
  const payload = readRecord(rawPayload);
  const result = readRecord(rawResult);
  if (status === "expired" || status === "cancelled") {
    return joinParts([status === "expired" ? "Expired" : "Cancelled", closedReason(result)]);
  }
  switch (kind) {
    case "ask_user_questions": {
      const questions = new Map<string, Record<string, unknown>>();
      for (const question of Array.isArray(payload.questions) ? payload.questions : []) {
        const record = readRecord(question);
        const id = readString(record.id);
        if (id) questions.set(id, record);
      }
      const answers = Array.isArray(result.answers) ? result.answers : [];
      return joinParts(answers.map((answer) => {
        const record = readRecord(answer);
        const question = questions.get(readString(record.questionId) ?? "") ?? {};
        const labels = optionLabels(question.options, record.optionIds);
        const other = readString(record.otherText);
        return [...labels, ...(other ? [other] : [])].join(", ") || null;
      }));
    }
    case "request_checkbox_confirmation":
      return joinParts([
        humanize(status),
        optionLabels(payload.options, result.selectedOptionIds).join(", ") || null,
        readString(result.reason) ?? readString(result.note),
      ]);
    case "suggest_tasks": {
      const created = Array.isArray(result.createdTasks) ? result.createdTasks.length : 0;
      return joinParts([
        status === "accepted" ? `Created ${created} task${created === 1 ? "" : "s"}` : humanize(status),
        readString(result.rejectionReason) ?? readString(result.reason),
      ]);
    }
    case "request_item_verdicts": {
      const counts = new Map<string, number>();
      for (const item of Array.isArray(result.items) ? result.items : []) {
        const verdict = readString(readRecord(item).verdict);
        if (verdict) counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
      }
      return joinParts([...counts].map(([verdict, count]) => `${count} ${verdict}`));
    }
    case "connection_intent":
      return joinParts([humanize(readString(result.outcome) ?? status), readString(result.reason)]);
    default:
      return joinParts([humanize(status), readString(result.reason) ?? readString(result.note)]);
  }
}

async function interactionRows(db: Db, scope: HistoryScope, statuses: readonly string[], limit: number): Promise<HistoryRow[]> {
  const at = issueThreadInteractions.resolvedAt;
  const rows = await db
    .select({
      id: issueThreadInteractions.id,
      kind: issueThreadInteractions.kind,
      status: issueThreadInteractions.status,
      title: issueThreadInteractions.title,
      payload: issueThreadInteractions.payload,
      result: issueThreadInteractions.result,
      resolvedByUserId: issueThreadInteractions.resolvedByUserId,
      resolvedByAgentId: issueThreadInteractions.resolvedByAgentId,
      cursorAt: cursorText(at),
      decidedAt: at,
      issueId: issues.id,
      issueIdentifier: issues.identifier,
      issueTitle: issues.title,
      userName: authUsers.name,
      agentName: agents.name,
    })
    .from(issueThreadInteractions)
    .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
    .leftJoin(authUsers, eq(authUsers.id, issueThreadInteractions.resolvedByUserId))
    .leftJoin(agents, eq(agents.id, issueThreadInteractions.resolvedByAgentId))
    .where(and(...interactionConditions(scope, statuses, true)))
    .orderBy(desc(at), desc(issueThreadInteractions.id))
    .limit(limit);
  return rows.map((row) => {
    const issue = issueRef(scope.prefix, { id: row.issueId, identifier: row.issueIdentifier, title: row.issueTitle });
    return {
      id: `issue_thread_interaction:${row.id}`,
      sourceKind: "issue_thread_interaction",
      sourceId: row.id,
      kind: row.kind,
      kindLabel: INTERACTION_KIND_LABELS[row.kind] ?? humanize(row.kind),
      status: row.status,
      outcome: TERMINAL_STATUSES.issue_thread_interaction.decided.includes(row.status) ? "decided" : "expired",
      title: interactionTitle(row.kind, row.title, readRecord(row.payload)),
      result: interactionResultSummary(row.kind, row.status, row.payload, row.result),
      decidedBy: decider(row.resolvedByUserId, row.userName, row.resolvedByAgentId, row.agentName),
      decidedAt: row.decidedAt!.toISOString(),
      issue,
      href: issue?.href ?? null,
      cursorAt: row.cursorAt,
    };
  });
}

function interactionConditions(scope: HistoryScope, statuses: readonly string[], withCursor: boolean) {
  return [
    eq(issueThreadInteractions.companyId, scope.companyId),
    isNotNull(issueThreadInteractions.resolvedAt),
    statusIn(issueThreadInteractions.status, statuses),
    isNull(issues.hiddenAt),
    scope.readCondition,
    ...scopeConditions(scope, "issue_thread_interaction", issueThreadInteractions.resolvedAt, issueThreadInteractions.id, withCursor),
  ];
}

const approvalAt = sql`coalesce(${approvals.decidedAt}, ${approvals.updatedAt})`;

function approvalConditions(scope: HistoryScope, statuses: readonly string[], withCursor: boolean) {
  return [
    eq(approvals.companyId, scope.companyId),
    statusIn(approvals.status, statuses),
    sql`not exists (select 1 from ${issueApprovals}
      inner join ${issues} on ${issues.id} = ${issueApprovals.issueId}
      where ${issueApprovals.approvalId} = ${approvals.id}
        and (${issues.hiddenAt} is not null or not (${scope.readCondition})))`,
    ...scopeConditions(scope, "approval", approvalAt, approvals.id, withCursor),
  ];
}

async function approvalRows(db: Db, scope: HistoryScope, statuses: readonly string[], limit: number): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      id: approvals.id,
      type: approvals.type,
      status: approvals.status,
      payload: approvals.payload,
      decisionNote: approvals.decisionNote,
      decidedByUserId: approvals.decidedByUserId,
      decidedAt: sql<Date>`${approvalAt}`.mapWith(approvals.decidedAt),
      cursorAt: cursorText(approvalAt),
      userName: authUsers.name,
    })
    .from(approvals)
    .leftJoin(authUsers, eq(authUsers.id, approvals.decidedByUserId))
    .where(and(...approvalConditions(scope, statuses, true)))
    .orderBy(desc(approvalAt), desc(approvals.id))
    .limit(limit);
  const issueByApproval = new Map<string, ResolvedDecisionIssueRef>();
  if (rows.length > 0) {
    const links = await db
      .select({
        approvalId: issueApprovals.approvalId,
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
      })
      .from(issueApprovals)
      .innerJoin(issues, eq(issues.id, issueApprovals.issueId))
      .where(and(eq(issueApprovals.companyId, scope.companyId), inArray(issueApprovals.approvalId, rows.map((row) => row.id))))
      .orderBy(issueApprovals.createdAt);
    for (const link of links) {
      if (issueByApproval.has(link.approvalId)) continue;
      const ref = issueRef(scope.prefix, link);
      if (ref) issueByApproval.set(link.approvalId, ref);
    }
  }
  return rows.map((row) => {
    const issue = issueByApproval.get(row.id) ?? null;
    return {
      id: `approval:${row.id}`,
      sourceKind: "approval",
      sourceId: row.id,
      kind: row.type,
      kindLabel: "Approval",
      status: row.status,
      outcome: TERMINAL_STATUSES.approval.decided.includes(row.status) ? "decided" : "expired",
      title: clip(approvalTitle(row.type, readRecord(row.payload)), TITLE_MAX_LENGTH),
      result: joinParts([humanize(row.status), readString(row.decisionNote)]),
      decidedBy: decider(row.decidedByUserId, row.userName, null, null),
      decidedAt: new Date(row.decidedAt).toISOString(),
      issue,
      href: issue?.href ?? null,
      cursorAt: row.cursorAt,
    };
  });
}

const decisionAt = sql`coalesce(${decisions.decidedAt}, ${decisions.updatedAt})`;

function decisionConditions(scope: HistoryScope, statuses: readonly string[], withCursor: boolean) {
  return [
    eq(decisions.companyId, scope.companyId),
    statusIn(decisions.status, statuses),
    isNull(issues.hiddenAt),
    scope.readCondition,
    ...scopeConditions(scope, "decision", decisionAt, decisions.id, withCursor),
  ];
}

function expiredReason(reason: string | null) {
  return reason ? DECISION_EXPIRED_REASONS[reason] ?? humanize(reason) : null;
}

async function decisionRows(db: Db, scope: HistoryScope, statuses: readonly string[], limit: number): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      id: decisions.id,
      title: decisions.title,
      status: decisions.status,
      options: decisions.options,
      chosenOptionId: decisions.chosenOptionId,
      metadata: decisions.metadata,
      decidedByUserId: decisions.decidedByUserId,
      decidedAt: sql<Date>`${decisionAt}`.mapWith(decisions.decidedAt),
      cursorAt: cursorText(decisionAt),
      issueId: issues.id,
      issueIdentifier: issues.identifier,
      issueTitle: issues.title,
      userName: authUsers.name,
    })
    .from(decisions)
    .innerJoin(issues, eq(issues.id, decisions.originIssueId))
    .leftJoin(authUsers, eq(authUsers.id, decisions.decidedByUserId))
    .where(and(...decisionConditions(scope, statuses, true)))
    .orderBy(desc(decisionAt), desc(decisions.id))
    .limit(limit);
  return rows.map((row) => {
    const metadata = readRecord(row.metadata);
    const chosen = optionLabels(row.options, row.chosenOptionId ? [row.chosenOptionId] : [])[0] ?? null;
    const result = row.status === "decided"
      ? metadata.dismissed === true
        ? joinParts(["Dismissed", readString(metadata.dismissReason)])
        : joinParts([chosen])
      : joinParts([humanize(row.status), expiredReason(readString(metadata.expiredReason))]);
    const issue = issueRef(scope.prefix, { id: row.issueId, identifier: row.issueIdentifier, title: row.issueTitle });
    return {
      id: `decision:${row.id}`,
      sourceKind: "decision",
      sourceId: row.id,
      kind: "decision",
      kindLabel: "Decision",
      status: row.status,
      outcome: row.status === "decided" ? "decided" : "expired",
      title: clip(row.title, TITLE_MAX_LENGTH),
      result,
      decidedBy: decider(row.decidedByUserId, row.userName, null, null),
      decidedAt: new Date(row.decidedAt).toISOString(),
      issue,
      href: issue?.href ?? null,
      cursorAt: row.cursorAt,
    };
  });
}

const joinRequestAt = sql`coalesce(${joinRequests.approvedAt}, ${joinRequests.rejectedAt}, ${joinRequests.updatedAt})`;
const joinRequestDecider = sql`coalesce(${joinRequests.approvedByUserId}, ${joinRequests.rejectedByUserId})`;

function joinRequestConditions(scope: HistoryScope, statuses: readonly string[], withCursor: boolean) {
  return [
    eq(joinRequests.companyId, scope.companyId),
    statusIn(joinRequests.status, statuses),
    ...scopeConditions(scope, "join_request", joinRequestAt, joinRequests.id, withCursor),
  ];
}

async function joinRequestRows(db: Db, scope: HistoryScope, statuses: readonly string[], limit: number): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      id: joinRequests.id,
      status: joinRequests.status,
      requestType: joinRequests.requestType,
      agentName: joinRequests.agentName,
      email: joinRequests.requestEmailSnapshot,
      deciderUserId: sql<string | null>`${joinRequestDecider}`,
      decidedAt: sql<Date>`${joinRequestAt}`.mapWith(joinRequests.updatedAt),
      cursorAt: cursorText(joinRequestAt),
      userName: authUsers.name,
    })
    .from(joinRequests)
    .leftJoin(authUsers, sql`${authUsers.id} = ${joinRequestDecider}`)
    .where(and(...joinRequestConditions(scope, statuses, true)))
    .orderBy(desc(joinRequestAt), desc(joinRequests.id))
    .limit(limit);
  return rows.map((row) => ({
    id: `join_request:${row.id}`,
    sourceKind: "join_request",
    sourceId: row.id,
    kind: row.requestType,
    kindLabel: "Join request",
    status: row.status,
    outcome: "decided",
    title: clip(
      row.requestType === "agent"
        ? `Agent join request: ${row.agentName ?? "unnamed agent"}`
        : `Join request from ${row.email ?? "a person"}`,
      TITLE_MAX_LENGTH,
    ),
    result: humanize(row.status),
    decidedBy: decider(row.deciderUserId, row.userName, null, null),
    decidedAt: new Date(row.decidedAt).toISOString(),
    issue: null,
    href: null,
    cursorAt: row.cursorAt,
  }));
}

const BRANCHES: Record<ResolvedDecisionSourceKind, {
  rows: (db: Db, scope: HistoryScope, statuses: readonly string[], limit: number) => Promise<HistoryRow[]>;
  count: (db: Db, scope: HistoryScope, statuses: readonly string[]) => Promise<number>;
}> = {
  issue_thread_interaction: {
    rows: interactionRows,
    count: (db, scope, statuses) => db.select({ count: sql<number>`count(*)::int` })
      .from(issueThreadInteractions)
      .innerJoin(issues, eq(issues.id, issueThreadInteractions.issueId))
      .where(and(...interactionConditions(scope, statuses, false)))
      .then((rows) => rows[0]?.count ?? 0),
  },
  approval: {
    rows: approvalRows,
    count: (db, scope, statuses) => db.select({ count: sql<number>`count(*)::int` })
      .from(approvals)
      .where(and(...approvalConditions(scope, statuses, false)))
      .then((rows) => rows[0]?.count ?? 0),
  },
  decision: {
    rows: decisionRows,
    count: (db, scope, statuses) => db.select({ count: sql<number>`count(*)::int` })
      .from(decisions)
      .innerJoin(issues, eq(issues.id, decisions.originIssueId))
      .where(and(...decisionConditions(scope, statuses, false)))
      .then((rows) => rows[0]?.count ?? 0),
  },
  join_request: {
    rows: joinRequestRows,
    count: (db, scope, statuses) => db.select({ count: sql<number>`count(*)::int` })
      .from(joinRequests)
      .where(and(...joinRequestConditions(scope, statuses, false)))
      .then((rows) => rows[0]?.count ?? 0),
  },
};

export function decisionHistoryService(db: Db) {
  return {
    list: async (companyId: string, actor: AuthorizationActor, query: ResolvedDecisionQuery): Promise<ResolvedDecisionPage> => {
      const limit = query.limit ?? DECISION_HISTORY_PAGE_MAX_LIMIT;
      const since = query.activitySince ?? null;
      const until = query.activityUntil ?? null;
      if (since && until && new Date(since).getTime() > new Date(until).getTime()) {
        throw badRequest("activitySince must be before or equal to activityUntil");
      }
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      let queueId: string | null = null;
      if (query.queue) {
        const queue = await db.select({ id: decisionQueues.id }).from(decisionQueues)
          .where(and(eq(decisionQueues.companyId, companyId), eq(decisionQueues.key, query.queue)))
          .then((rows) => rows[0] ?? null);
        if (!queue) throw notFound("Decision queue not found");
        queueId = queue.id;
      }
      const [prefix, readCondition] = await Promise.all([
        companyPrefix(db, companyId),
        issueReadSqlCondition(db, actor),
      ]);
      const scope: HistoryScope = { companyId, prefix, readCondition, queueId, since, until, cursor };
      const kinds = (query.sourceKinds ?? DECISION_HISTORY_SOURCE_KINDS)
        .filter((kind) => TERMINAL_STATUSES[kind][query.status].length > 0);
      const [pages, counts] = await Promise.all([
        Promise.all(kinds.map((kind) => BRANCHES[kind].rows(db, scope, TERMINAL_STATUSES[kind][query.status], limit + 1))),
        cursor
          ? null
          : Promise.all(kinds.map((kind) => BRANCHES[kind].count(db, scope, TERMINAL_STATUSES[kind][query.status]))),
      ]);
      const merged = pages.flat().sort(compareRows);
      const page = merged.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(({ cursorAt: _cursorAt, ...entry }) => entry),
        nextCursor: merged.length > limit && last ? encodeCursor(last) : null,
        totalCount: counts ? counts.reduce((sum, count) => sum + count, 0) : null,
      };
    },
  };
}

async function resolvedDecisionCountsByQueue(db: Db, companyId: string, actor: AuthorizationActor) {
  const readCondition = await issueReadSqlCondition(db, actor);
  const terminal = (kind: ResolvedDecisionSourceKind) => terminalStatuses([
    ...TERMINAL_STATUSES[kind].decided,
    ...TERMINAL_STATUSES[kind].expired,
  ]);
  const member = (kind: ResolvedDecisionSourceKind) => sql`${decisionQueueItems.companyId} = ${companyId}
    and ${decisionQueueItems.sourceKind} = ${kind}`;
  const rows = await db.execute<{ queue_id: string; count: number }>(sql`
    select queue_id, count(*)::int as count from (
      select ${decisionQueueItems.queueId} as queue_id
        from ${decisionQueueItems}
        inner join ${issueThreadInteractions}
          on ${issueThreadInteractions.id}::text = ${decisionQueueItems.sourceId}
         and ${issueThreadInteractions.companyId} = ${companyId}
        inner join ${issues} on ${issues.id} = ${issueThreadInteractions.issueId}
       where ${member("issue_thread_interaction")}
         and ${issueThreadInteractions.status} in (${terminal("issue_thread_interaction")})
         and ${issueThreadInteractions.resolvedAt} is not null
         and ${issues.hiddenAt} is null
         and ${readCondition}
      union all
      select ${decisionQueueItems.queueId}
        from ${decisionQueueItems}
        inner join ${approvals}
          on ${approvals.id}::text = ${decisionQueueItems.sourceId}
         and ${approvals.companyId} = ${companyId}
       where ${member("approval")}
         and ${approvals.status} in (${terminal("approval")})
         and not exists (select 1 from ${issueApprovals}
           inner join ${issues} on ${issues.id} = ${issueApprovals.issueId}
           where ${issueApprovals.approvalId} = ${approvals.id}
             and (${issues.hiddenAt} is not null or not (${readCondition})))
      union all
      select ${decisionQueueItems.queueId}
        from ${decisionQueueItems}
        inner join ${decisions}
          on ${decisions.id}::text = ${decisionQueueItems.sourceId}
         and ${decisions.companyId} = ${companyId}
        inner join ${issues} on ${issues.id} = ${decisions.originIssueId}
       where ${member("decision")}
         and ${decisions.status} in (${terminal("decision")})
         and ${issues.hiddenAt} is null
         and ${readCondition}
      union all
      select ${decisionQueueItems.queueId}
        from ${decisionQueueItems}
        inner join ${joinRequests}
          on ${joinRequests.id}::text = ${decisionQueueItems.sourceId}
         and ${joinRequests.companyId} = ${companyId}
       where ${member("join_request")}
         and ${joinRequests.status} in (${terminal("join_request")})
    ) resolved
    group by queue_id`);
  return new Map([...rows].map((row) => [row.queue_id, Number(row.count)]));
}

async function openDecisionCountsByQueue(db: Db, companyId: string, actor: AuthorizationActor) {
  const feed = await attentionService(db).list(companyId, {
    actor,
    userId: actor.type === "board" ? actor.userId ?? null : null,
    all: true,
    allowUnscopedAll: true,
  }, false);
  let items = feed.items.filter((item) => !item.shelf);
  if (actor.type !== "board") {
    const readable = await readableDecisionSourceKeys(db, actor, companyId, items.map((item) => ({
      sourceKind: item.sourceKind,
      sourceId: item.subject.id,
    })));
    items = items.filter((item) => readable.has(`${item.sourceKind}:${item.subject.id}`));
  }
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const queue of item.queues) counts.set(queue.key, (counts.get(queue.key) ?? 0) + 1);
  }
  return counts;
}

export async function decisionQueueCounts(db: Db, companyId: string, actor: AuthorizationActor): Promise<DecisionQueueCounts> {
  const [openByKey, resolvedByQueueId] = await Promise.all([
    openDecisionCountsByQueue(db, companyId, actor),
    actor.type === "board" ? resolvedDecisionCountsByQueue(db, companyId, actor) : null,
  ]);
  return { openByKey, resolvedByQueueId };
}
