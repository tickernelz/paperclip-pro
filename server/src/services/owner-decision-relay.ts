import { and, eq, inArray, sql } from "drizzle-orm";
import type { Request, RequestHandler, Response } from "express";
import {
  activityLog,
  agents,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issueThreadInteractionOwnerRelays,
  issueThreadInteractions,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type {
  AnswerDecisionForOwner,
  AttentionItem,
  AttentionSourceKind,
  IssueThreadInteractionOwnerRelay,
  IssueThreadInteractionOwnerRelayChannel,
  PendingDecision,
  PendingDecisionOption,
  PendingDecisionQuestion,
} from "@tickernelz/paperclip-pro-shared";
import { conflict, HttpError, unprocessable } from "../errors.js";
import { attentionService } from "./attention.js";
import { boardAuthService } from "./board-auth.js";
import { executionBlockerPredicate, getExecutionBlocker } from "./execution-blocker.js";
import { openwaOwnerPrincipalOfDeliveries } from "./openwa/approvals.js";
import { readOpenwaRunContext } from "./openwa/authority.js";
import { openwaChatKey } from "./openwa/outbound.js";
import { openwaCurrentOwnerUserId } from "./openwa/owners.js";

export const OWNER_CONFIRMATION_REQUIRED_CODE = "owner_confirmation_required";

const OWNER_RELAY_REMEDIATION =
  "Relay a card answer only from a run the owner's own message started (an owner WhatsApp message, or their board comment), quoting that message's id as ownerMessageRef. Otherwise ask the owner to answer the card in Paperclip.";

type OwnerRelayDenial =
  | "run_not_active"
  | "not_owner_triggered"
  | "owner_message_not_in_run"
  | "owner_not_linked"
  | "owner_not_member"
  | "message_predates_card"
  | "card_not_named"
  | "owner_message_consumed"
  | "message_predates_stop"
  | "issue_not_named";

function ownerConfirmationRequired(reason: OwnerRelayDenial, message: string) {
  return new HttpError(403, message, { code: OWNER_CONFIRMATION_REQUIRED_CODE, reason, remediation: OWNER_RELAY_REMEDIATION });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

export interface OwnerRelayAuthority {
  channel: IssueThreadInteractionOwnerRelayChannel;
  ownerUserId: string;
  ownerMessageRef: string;
  ownerText: string;
  messageAt: Date;
}

interface RelayRun {
  id: string;
  companyId: string;
  contextSnapshot: Record<string, unknown> | null;
}

async function whatsappAuthority(db: Db, run: RelayRun, ownerMessageRef: string): Promise<Omit<OwnerRelayAuthority, "channel"> | null> {
  const openwa = readOpenwaRunContext(run.contextSnapshot);
  if (!openwa) return null;
  const notOwner = () =>
    ownerConfirmationRequired("not_owner_triggered", "Only a run started by an endpoint owner's own WhatsApp messages can relay their answer to a card");
  if (openwa.triggerClass !== "owner") throw notOwner();
  const [endpoint] = await db
    .select({ id: chatEndpoints.id, companyId: chatEndpoints.companyId })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.id, openwa.endpointId), eq(chatEndpoints.companyId, run.companyId), eq(chatEndpoints.provider, "openwa")))
    .limit(1);
  const runIssueId = str(run.contextSnapshot?.issueId) ?? str(run.contextSnapshot?.taskId);
  if (!endpoint || !runIssueId) throw notOwner();
  const [conversation] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(eq(chatConversations.companyId, run.companyId), eq(chatConversations.endpointId, endpoint.id), eq(chatConversations.issueId, runIssueId)))
    .limit(1);
  if (!conversation) throw notOwner();
  const principalId = await openwaOwnerPrincipalOfDeliveries(db, {
    companyId: run.companyId,
    endpointId: endpoint.id,
    conversationId: conversation.id,
    chatKey: openwaChatKey(openwa.chatKey),
    deliveryIds: openwa.deliveryIds,
  });
  if (!principalId) throw notOwner();
  const deliveries = await db
    .select({ id: chatDeliveries.id, normalizedEvent: chatDeliveries.normalizedEvent, receivedAt: chatDeliveries.receivedAt })
    .from(chatDeliveries)
    .where(and(eq(chatDeliveries.companyId, run.companyId), eq(chatDeliveries.endpointId, endpoint.id), inArray(chatDeliveries.id, openwa.deliveryIds.slice(0, 50))));
  const message = deliveries.find(
    (row) => row.id === ownerMessageRef || str(record(row.normalizedEvent.openwa).waMessageId) === ownerMessageRef,
  );
  if (!message) {
    throw ownerConfirmationRequired("owner_message_not_in_run", "ownerMessageRef must be the id of one of the owner's messages that started this run");
  }
  const owner = await openwaCurrentOwnerUserId(db, endpoint, principalId);
  if (!owner.userId) {
    throw ownerConfirmationRequired("owner_not_linked", "This WhatsApp owner is not linked to a Paperclip user, so their answer cannot be recorded for them");
  }
  return {
    ownerUserId: owner.userId,
    ownerMessageRef,
    ownerText: typeof record(message.normalizedEvent.message).text === "string" ? String(record(message.normalizedEvent.message).text) : "",
    messageAt: message.receivedAt,
  };
}

async function commentAuthority(db: Db, run: RelayRun, ownerMessageRef: string): Promise<Omit<OwnerRelayAuthority, "channel">> {
  const wakeCommentIds = new Set([...strings(run.contextSnapshot?.wakeCommentIds), ...strings([run.contextSnapshot?.wakeCommentId])]);
  if (wakeCommentIds.size === 0) {
    throw ownerConfirmationRequired("not_owner_triggered", "Only a run started by a board user's own message can relay their answer to a card");
  }
  if (!wakeCommentIds.has(ownerMessageRef)) {
    throw ownerConfirmationRequired("owner_message_not_in_run", "ownerMessageRef must be the id of the board comment that woke this run");
  }
  const [comment] = await db
    .select({
      authorType: issueComments.authorType,
      authorUserId: issueComments.authorUserId,
      authorAgentId: issueComments.authorAgentId,
      createdByRunId: issueComments.createdByRunId,
      deletedAt: issueComments.deletedAt,
      sourceTrust: issueComments.sourceTrust,
      body: issueComments.body,
      createdAt: issueComments.createdAt,
    })
    .from(issueComments)
    .where(and(eq(issueComments.id, ownerMessageRef), eq(issueComments.companyId, run.companyId)))
    .limit(1);
  if (
    !comment ||
    comment.deletedAt ||
    comment.authorType !== "user" ||
    !comment.authorUserId ||
    comment.authorAgentId ||
    comment.createdByRunId ||
    comment.sourceTrust?.disposition === "quarantined"
  ) {
    throw ownerConfirmationRequired("not_owner_triggered", "The message that woke this run is not a board user's own message");
  }
  return { ownerUserId: comment.authorUserId, ownerMessageRef, ownerText: comment.body, messageAt: comment.createdAt };
}

export async function resolveOwnerRelayAuthority(
  db: Db,
  input: { companyId: string; agentId: string; runId: string; ownerMessageRef: string },
): Promise<OwnerRelayAuthority> {
  const [run] = await db
    .select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId, status: heartbeatRuns.status, contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId)))
    .limit(1);
  if (!run || run.agentId !== input.agentId || run.status !== "running") {
    throw ownerConfirmationRequired("run_not_active", "Only the agent's own active run can relay an owner's answer");
  }
  const relayRun = { id: run.id, companyId: run.companyId, contextSnapshot: run.contextSnapshot as Record<string, unknown> | null };
  const whatsapp = await whatsappAuthority(db, relayRun, input.ownerMessageRef);
  const authority = whatsapp ? { channel: "whatsapp" as const, ...whatsapp } : { channel: "paperclip" as const, ...(await commentAuthority(db, relayRun, input.ownerMessageRef)) };
  const access = await boardAuthService(db).resolveBoardAccess(authority.ownerUserId);
  if (!access.user || (!access.isInstanceAdmin && !access.companyIds.includes(input.companyId))) {
    throw ownerConfirmationRequired("owner_not_member", "The owner is not an active board member of this company");
  }
  return authority;
}

export function ownerRelayClaimKey(ownerText: string, card: { interactionId: string; issueIdentifier: string | null }): string {
  const text = ownerText.toLowerCase();
  if (text.includes(card.interactionId.toLowerCase())) return "interaction:" + card.interactionId.toLowerCase();
  const named = new Set<string>();
  const uuids = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g) ?? [];
  for (const id of uuids) named.add("interaction:" + id);
  const prefix = card.issueIdentifier?.split("-")[0]?.toLowerCase() ?? null;
  if (prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of text.matchAll(new RegExp("\\b" + escaped + "-(\\d+)\\b", "g"))) named.add("issue:" + prefix + "-" + match[1]);
  }
  const issueKey = card.issueIdentifier ? "issue:" + card.issueIdentifier.toLowerCase() : null;
  if (issueKey && named.has(issueKey)) return issueKey;
  if (named.size > 0) {
    throw ownerConfirmationRequired("card_not_named", "The owner's message names other cards, not this one; relay only the cards it names");
  }
  return "*";
}

export async function claimOwnerRelay(
  db: Db,
  input: {
    companyId: string;
    issueId: string;
    interactionId: string;
    issueIdentifier: string | null;
    cardCreatedAt: Date;
    authority: OwnerRelayAuthority;
    agentId: string;
    runId: string;
  },
): Promise<string> {
  if (input.authority.messageAt.getTime() < input.cardCreatedAt.getTime()) {
    throw ownerConfirmationRequired("message_predates_card", "The owner's message was sent before this card existed, so it cannot answer it");
  }
  const claimKey = ownerRelayClaimKey(input.authority.ownerText, { interactionId: input.interactionId, issueIdentifier: input.issueIdentifier });
  const [claim] = await db
    .insert(issueThreadInteractionOwnerRelays)
    .values({
      companyId: input.companyId,
      issueId: input.issueId,
      interactionId: input.interactionId,
      channel: input.authority.channel,
      ownerMessageRef: input.authority.ownerMessageRef,
      claimKey,
      ownerUserId: input.authority.ownerUserId,
      relayedByAgentId: input.agentId,
      runId: input.runId,
    })
    .onConflictDoNothing()
    .returning({ id: issueThreadInteractionOwnerRelays.id });
  if (!claim) {
    throw ownerConfirmationRequired(
      "owner_message_consumed",
      claimKey === "*"
        ? "This owner message already answered a card; one message answers one card unless it names each card"
        : "This owner message already answered the card it names",
    );
  }
  return claim.id;
}

export const OWNER_CONTINUATION_RELAYED_ACTION = "issue.execution_recovery_owner_relayed";

export async function assertOwnerContinuationAllowed(
  db: Db,
  input: { companyId: string; issueId: string; issueIdentifier: string | null; authority: OwnerRelayAuthority },
) {
  const blocker = await getExecutionBlocker(db, input.companyId, input.issueId);
  if (!blocker?.recoveryActionId) {
    throw conflict("This issue is not held by execution recovery; send the owner's message as a normal comment", {
      code: "execution_recovery_not_held",
    });
  }
  const holds = await db
    .select({ evidence: issueRecoveryActions.evidence })
    .from(issueRecoveryActions)
    .where(and(eq(issueRecoveryActions.companyId, input.companyId), eq(issueRecoveryActions.sourceIssueId, input.issueId), executionBlockerPredicate()));
  const sourceRunIds = holds.flatMap((hold) => {
    const runId = str(hold.evidence.runId) ?? str(hold.evidence.sourceRunId);
    return runId ? [runId] : [];
  });
  const stopped = sourceRunIds.length
    ? await db
        .select({ finishedAt: heartbeatRuns.finishedAt })
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), sql`${heartbeatRuns.id}::text in (${sql.join(sourceRunIds.map((id) => sql`${id}`), sql`, `)})`))
    : [];
  const stoppedAt = Math.max(0, ...stopped.map((run) => run.finishedAt?.getTime() ?? 0));
  if (input.authority.messageAt.getTime() <= stoppedAt) {
    throw ownerConfirmationRequired("message_predates_stop", "The owner's message was sent before the run stopped, so it cannot ask to continue after it");
  }
  const text = input.authority.ownerText.toLowerCase();
  const identifier = input.issueIdentifier?.toLowerCase() ?? null;
  const prefix = identifier?.split("-")[0];
  if (identifier && prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = new Set([...text.matchAll(new RegExp("\\b" + escaped + "-(\\d+)\\b", "g"))].map((match) => prefix + "-" + match[1]));
    if (named.size > 0 && !named.has(identifier)) {
      throw ownerConfirmationRequired("issue_not_named", "The owner's message names other issues, not this one");
    }
  }
  if (!input.authority.ownerText.trim()) {
    throw unprocessable("The owner's message has no text to continue the issue with", { code: "owner_message_empty" });
  }
  const [used] = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, input.companyId),
        eq(activityLog.action, OWNER_CONTINUATION_RELAYED_ACTION),
        sql`${activityLog.details}->>'channel' = ${input.authority.channel}`,
        sql`${activityLog.details}->>'ownerMessageRef' = ${input.authority.ownerMessageRef}`,
      ),
    )
    .limit(1);
  if (used) {
    throw ownerConfirmationRequired("owner_message_consumed", "This owner message already continued a held issue");
  }
}

export async function releaseOwnerRelay(db: Db, claimId: string) {
  await db.delete(issueThreadInteractionOwnerRelays).where(eq(issueThreadInteractionOwnerRelays.id, claimId));
}

export async function markOwnerRelayApplied(
  db: Db,
  input: { companyId: string; interactionId: string; relay: IssueThreadInteractionOwnerRelay },
) {
  await db
    .update(issueThreadInteractions)
    .set({ resolutionRelay: input.relay })
    .where(
      and(
        eq(issueThreadInteractions.id, input.interactionId),
        eq(issueThreadInteractions.companyId, input.companyId),
        eq(issueThreadInteractions.resolvedByUserId, input.relay.ownerUserId),
      ),
    );
}

interface RelayableCard {
  id: string;
  kind: string;
  payload: unknown;
}

export function ownerRelayBlockedReason(card: RelayableCard): string | null {
  if (card.kind === "connection_intent") return "Connection requests are completed by the connecting user in Paperclip";
  const payload = record(card.payload);
  if (payload.toolAction || payload.secretProposal || payload.connectionAuthorization) {
    return "Governed actions (tool runs, secret bindings, connection authorizations) use their own approval control in Paperclip";
  }
  if (str(payload.openwaApprovalRequestId)) return "OpenWA approval requests are resolved with openwa_approval_resolve in the owner's chat";
  return null;
}

export function ownerRelayTarget(card: RelayableCard, answer: AnswerDecisionForOwner): { action: "accept" | "reject" | "respond" | "verdicts"; body: Record<string, unknown> } {
  const blocked = ownerRelayBlockedReason(card);
  if (blocked) throw unprocessable(blocked, { code: "owner_relay_unsupported" });
  const note = answer.note === undefined ? {} : { note: answer.note };
  const mismatch = (shape: string) => unprocessable("A " + card.kind + " card takes " + shape, { code: "owner_relay_answer_mismatch" });
  switch (card.kind) {
    case "request_confirmation":
    case "request_checkbox_confirmation":
    case "suggest_tasks": {
      if (!answer.decision) throw mismatch("decision approve or reject");
      if (answer.decision === "reject") return { action: "reject", body: { ...(answer.reason ? { reason: answer.reason } : {}), ...note } };
      if (card.kind === "request_confirmation" && answer.optionIds) throw mismatch("no optionIds");
      if (card.kind === "request_checkbox_confirmation" && !answer.optionIds) throw mismatch("the optionIds the owner chose");
      const selection =
        card.kind === "request_checkbox_confirmation"
          ? { selectedOptionIds: answer.optionIds }
          : card.kind === "suggest_tasks" && answer.optionIds
            ? { selectedClientKeys: answer.optionIds }
            : {};
      return { action: "accept", body: { ...selection, ...note } };
    }
    case "ask_user_questions":
      if (!answer.answers) throw mismatch("answers");
      return { action: "respond", body: { answers: answer.answers } };
    case "request_item_verdicts":
      if (!answer.verdicts) throw mismatch("verdicts");
      return { action: "verdicts", body: { verdicts: answer.verdicts } };
    default:
      throw unprocessable("This card kind cannot be relayed", { code: "owner_relay_unsupported" });
  }
}

export function dispatchAsOwner(
  handle: RequestHandler,
  req: Request,
  input: { url: string; body: unknown; actor: Request["actor"] },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (status: number, body: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    const inner = Object.create(req) as Request;
    Object.assign(inner, { url: input.url, body: input.body, actor: input.actor, params: {} });
    const headers = new Map<string, unknown>();
    const res = {
      statusCode: 200,
      headersSent: false,
      locals: {} as Record<string, unknown>,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      sendStatus(code: number) {
        res.statusCode = code;
        finish(code, null);
        return res;
      },
      json(body: unknown) {
        finish(res.statusCode, body);
        return res;
      },
      send(body: unknown) {
        finish(res.statusCode, body);
        return res;
      },
      end() {
        finish(res.statusCode, null);
        return res;
      },
      setHeader(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value);
        return res;
      },
      set(name: string | Record<string, unknown>, value?: unknown) {
        if (typeof name === "string") headers.set(name.toLowerCase(), value);
        else for (const [key, entry] of Object.entries(name)) headers.set(key.toLowerCase(), entry);
        return res;
      },
      header(name: string, value?: unknown) {
        return res.set(name, value);
      },
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      get: (name: string) => headers.get(name.toLowerCase()),
      append: () => res,
      type: () => res,
      vary: () => res,
      on: () => res,
      once: () => res,
    };
    handle(inner, res as unknown as Response, (error?: unknown) => {
      if (settled) return;
      settled = true;
      reject(error ?? new HttpError(500, "Owner relay matched no board answer route"));
    });
  });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionList(entries: unknown, idKey: string, labelKey: string): PendingDecisionOption[] {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const item = record(entry);
    const id = str(item[idKey]);
    const label = text(item[labelKey]);
    return id && label ? [{ id, label, description: text(item.description) }] : [];
  });
}

/** Prompt, options and questions of a card as the owner sees them. */
export function pendingDecisionCardShape(kind: string, payload: Record<string, unknown>): Pick<PendingDecision, "prompt" | "options" | "questions"> {
  switch (kind) {
    case "request_confirmation":
      return {
        prompt: text(payload.prompt),
        options: [
          { id: "approve", label: text(payload.acceptLabel) ?? "Approve", description: null },
          { id: "reject", label: text(payload.rejectLabel) ?? "Reject", description: null },
        ],
        questions: [],
      };
    case "request_checkbox_confirmation":
    case "request_item_verdicts":
      return { prompt: text(payload.prompt), options: optionList(kind === "request_item_verdicts" ? payload.items : payload.options, "id", "label"), questions: [] };
    case "suggest_tasks": {
      const options = optionList(payload.tasks, "clientKey", "title");
      return { prompt: "Create " + options.length + " suggested task" + (options.length === 1 ? "" : "s"), options, questions: [] };
    }
    case "ask_user_questions": {
      const questions: PendingDecisionQuestion[] = (Array.isArray(payload.questions) ? payload.questions : []).flatMap((entry) => {
        const question = record(entry);
        const id = str(question.id);
        const prompt = text(question.prompt);
        if (!id || !prompt) return [];
        return [{ id, prompt, selectionMode: question.selectionMode === "multi" ? "multi" as const : "single" as const, options: optionList(question.options, "id", "label") }];
      });
      return { prompt: text(payload.title) ?? questions[0]?.prompt ?? null, options: [], questions };
    }
    default:
      return { prompt: text(payload.prompt), options: [], questions: [] };
  }
}

const GOVERNED_APPROVAL_REASON =
  "Board approvals (hires, budgets, governed actions) carry company-level effects and budget stops; the owner decides them in Paperclip, or an agent holding company:approvals authority uses paperclipApprovalDecision";
const AGENT_DECISION_REASON = "Agent decision bundles are decided on the Paperclip Decisions desk";

const RELAY_SOURCE_KINDS: AttentionSourceKind[] = ["issue_thread_interaction", "approval", "decision"];

export function isOpenAttentionItem(item: AttentionItem, now: number) {
  if (item.archivedAt) return false;
  if (item.dismissal?.isActive) return false;
  return !(item.snoozedUntil && Date.parse(item.snoozedUntil) > now);
}

const DESK_ONLY_REASONS: Partial<Record<AttentionSourceKind, string>> = {
  recovery_action:
    "A recovery action is resolved on the Paperclip Decisions desk; when the owner explicitly asks to continue the issue, paperclipContinueIssueForOwner relays that",
  review: "A review verdict is given on the issue by its reviewer, not relayed",
  productivity_review: "A productivity review is closed on the Paperclip Decisions desk",
  blocker_attention: "A blocked dependency clears when the blocking issue finishes or the dependency changes; there is no card to answer",
  failed_run: "A failed run is handled on the Paperclip Decisions desk",
  budget_alert: "A budget incident is decided by the owner on the Paperclip Decisions desk",
  agent_error_alert: "An agent error is inspected or dismissed on the Paperclip Decisions desk",
  join_request: "A join request is approved or denied by a board member on the Paperclip Decisions desk",
};

async function loadRelayCards(db: Db, companyId: string, items: AttentionItem[]) {
  const interactionIds = items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id);
  if (interactionIds.length === 0) return new Map<string, RelayableCard & { title: string | null; createdByUserId: string | null }>();
  const cards = await db
    .select({
      id: issueThreadInteractions.id,
      kind: issueThreadInteractions.kind,
      payload: issueThreadInteractions.payload,
      title: issueThreadInteractions.title,
      createdByUserId: issueThreadInteractions.createdByUserId,
    })
    .from(issueThreadInteractions)
    .where(and(eq(issueThreadInteractions.companyId, companyId), inArray(issueThreadInteractions.id, interactionIds)));
  return new Map(cards.map((card) => [card.id, card]));
}

export async function relayStateByItem(
  db: Db,
  companyId: string,
  items: AttentionItem[],
): Promise<Map<string, { relayable: boolean; relayBlockedReason: string | null }>> {
  const cardById = await loadRelayCards(db, companyId, items);
  return new Map(
    items.map((item) => {
      if (item.sourceKind === "issue_thread_interaction") {
        const card = cardById.get(item.subject.id);
        const blocked = card ? ownerRelayBlockedReason(card) : "The card is no longer pending";
        return [item.id, { relayable: blocked === null, relayBlockedReason: blocked }] as const;
      }
      const reason =
        item.sourceKind === "approval" ? GOVERNED_APPROVAL_REASON
        : item.sourceKind === "decision" ? AGENT_DECISION_REASON
        : (DESK_ONLY_REASONS[item.sourceKind] ?? "Resolved on the Paperclip Decisions desk");
      return [item.id, { relayable: false, relayBlockedReason: reason }] as const;
    }),
  );
}

export async function listPendingDecisions(
  db: Db,
  input: { companyId: string; actor: Request["actor"]; userId: string | null },
): Promise<{ items: PendingDecision[]; omittedCount: number }> {
  const feed = await attentionService(db).list(input.companyId, {
    userId: input.userId ?? undefined,
    actor: input.actor,
    includeDismissed: true,
    all: true,
    allowUnscopedAll: true,
    sort: "decide",
  });
  const items = feed.items.filter((item) => RELAY_SOURCE_KINDS.includes(item.sourceKind));
  const now = Date.parse(feed.generatedAt);
  const omittedCount = feed.items.filter(
    (item) => !RELAY_SOURCE_KINDS.includes(item.sourceKind) && isOpenAttentionItem(item, now),
  ).length;
  const cardById = await loadRelayCards(db, input.companyId, items);
  const requesterIds = [
    ...new Set(
      items.flatMap((item) => {
        const metadata = record(item.subject.metadata);
        return [item.resolverAudience?.createdByAgentId, str(metadata.createdByAgentId), str(metadata.requestedByAgentId), str(metadata.originAgentId)]
          .filter((id): id is string => Boolean(id));
      }),
    ),
  ];
  const agentNames = new Map(
    requesterIds.length
      ? (
          await db
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(and(eq(agents.companyId, input.companyId), inArray(agents.id, requesterIds)))
        ).map((agent) => [agent.id, agent.name])
      : [],
  );
  const requester = (agentId: string | null) => ({ requestedByAgentId: agentId, requestedByAgentName: agentId ? (agentNames.get(agentId) ?? null) : null });
  const decisions = items.flatMap((item): PendingDecision[] => {
    const metadata = record(item.subject.metadata);
    const base = {
      id: item.subject.id,
      issueId: item.relatedIssue?.id ?? str(metadata.issueId) ?? str(metadata.originIssueId),
      issueIdentifier: item.relatedIssue?.identifier ?? null,
      issueTitle: item.relatedIssue?.title ?? null,
      title: item.subject.title,
      createdAt: item.createdAt,
      href: item.subject.href,
    };
    if (item.sourceKind === "issue_thread_interaction") {
      const card = cardById.get(item.subject.id);
      if (!card) return [];
      const blocked = ownerRelayBlockedReason(card);
      return [{
        ...base,
        source: "interaction",
        kind: card.kind,
        title: card.title ?? base.title,
        ...pendingDecisionCardShape(card.kind, record(card.payload)),
        humanOnly: item.resolverAudience?.effectiveResolverPolicy === "human_only",
        ...requester(item.resolverAudience?.createdByAgentId ?? str(metadata.createdByAgentId)),
        requestedByUserId: card.createdByUserId ?? null,
        relayable: blocked === null,
        relayBlockedReason: blocked,
      }];
    }
    return [{
      ...base,
      source: item.sourceKind === "approval" ? "approval" : "decision",
      kind: str(metadata.type) ?? item.sourceKind,
      prompt: decisionPrompt(item),
      options: item.decisionVerbs.map((verb) => ({ id: verb.id, label: verb.label, description: verb.description })),
      questions: [],
      humanOnly: true,
      ...requester(str(metadata.requestedByAgentId) ?? str(metadata.originAgentId)),
      requestedByUserId: str(metadata.requestedByUserId),
      relayable: false,
      relayBlockedReason: item.sourceKind === "approval" ? GOVERNED_APPROVAL_REASON : AGENT_DECISION_REASON,
    }];
  });
  return { items: decisions, omittedCount };
}

function decisionPrompt(item: AttentionItem): string | null {
  const detail = item.detail;
  if (detail && "summaryExcerpt" in detail) return detail.summaryExcerpt;
  return item.whyNow;
}
