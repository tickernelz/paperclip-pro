import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { chatActions, chatDeliveries, chatOwnerApprovalRequests, type Db } from "@tickernelz/paperclip-pro-db";
import type { OpenwaGrantCategory } from "@tickernelz/paperclip-pro-shared";
import { openwaChatKey } from "./outbound.js";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
type EndpointRef = { companyId: string; id: string };

const MAX_DISCUSSIONS = 10;
const MAX_PENDING = 100;
const MAX_EVIDENCE = 50;
const MAX_OWNER_TEXT = 2000;

const AFFIRMATIVE_WORDS = new Set(["ok", "oke", "okay", "okeh", "ya", "iya", "yes", "y", "boleh", "setuju", "approve", "approved", "acc", "gas", "lanjut", "lanjutkan", "silakan", "sip"]);
const AFFIRMATIVE_SYMBOLS = ["\u{1F44D}", "\u2705"];
const NEGATIVE_WORDS = new Set(["jangan", "tidak", "nggak", "gak", "ga", "no", "reject", "rejected", "tolak", "batal", "stop"]);
const NEGATIVE_SYMBOLS = ["\u{1F44E}"];

export type OpenwaOwnerDecision = "approve" | "reject";

export interface OpenwaApprovalDiscussion {
  requestId: string;
  summary: string;
  proposedAction: string;
  categories: OpenwaGrantCategory[];
  startedAt: Date;
}

export interface OpenwaOwnerMessage {
  deliveryId: string;
  text: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** True when the owner's words carry an explicit approval (approve) or refusal (reject) token. */
export function openwaOwnerWordsDecide(text: string, decision: OpenwaOwnerDecision): boolean {
  const normalized = text.normalize("NFKC").toLowerCase();
  if ((decision === "approve" ? AFFIRMATIVE_SYMBOLS : NEGATIVE_SYMBOLS).some((symbol) => normalized.includes(symbol))) return true;
  const words = decision === "approve" ? AFFIRMATIVE_WORDS : NEGATIVE_WORDS;
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .some((word) => words.has(word));
}

/** Pending requests this owner principal opened by quoting their bubble in this chat; the first quoting reply starts the discussion. */
export async function openwaApprovalDiscussions(
  db: DbOrTransaction,
  input: { endpoint: EndpointRef; principalId: string; chatKey: string; requestId?: string },
): Promise<OpenwaApprovalDiscussion[]> {
  const pending = await db
    .select({
      id: chatOwnerApprovalRequests.id,
      summary: chatOwnerApprovalRequests.summary,
      proposedAction: chatOwnerApprovalRequests.proposedAction,
      categories: chatOwnerApprovalRequests.categories,
      createdAt: chatOwnerApprovalRequests.createdAt,
    })
    .from(chatOwnerApprovalRequests)
    .where(
      and(
        eq(chatOwnerApprovalRequests.companyId, input.endpoint.companyId),
        eq(chatOwnerApprovalRequests.endpointId, input.endpoint.id),
        eq(chatOwnerApprovalRequests.status, "pending"),
        ...(input.requestId ? [eq(chatOwnerApprovalRequests.id, input.requestId)] : []),
      ),
    )
    .orderBy(desc(chatOwnerApprovalRequests.createdAt))
    .limit(MAX_PENDING);
  if (!pending.length) return [];
  const chatKey = openwaChatKey(input.chatKey);
  const oldest = pending.reduce((min, request) => (request.createdAt < min ? request.createdAt : min), pending[0]!.createdAt);
  const requestKey = sql<string | null>`${chatDeliveries.normalizedEvent} -> 'openwa' -> 'approval' ->> 'requestId'`;
  const replies = await db
    .select({ requestId: requestKey, chatKey: sql<string | null>`${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'chatKey'`, receivedAt: chatDeliveries.receivedAt })
    .from(chatDeliveries)
    .where(
      and(
        eq(chatDeliveries.companyId, input.endpoint.companyId),
        eq(chatDeliveries.endpointId, input.endpoint.id),
        eq(chatDeliveries.principalId, input.principalId),
        eq(chatDeliveries.triggerClass, "owner"),
        eq(chatDeliveries.principalRole, "owner"),
        gte(chatDeliveries.receivedAt, oldest),
        sql`${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'event' = 'approval_reply'`,
        inArray(requestKey, pending.map((request) => request.id)),
      ),
    )
    .orderBy(asc(chatDeliveries.receivedAt));
  const startedAt = new Map<string, Date>();
  for (const reply of replies)
    if (reply.requestId && openwaChatKey(reply.chatKey ?? "") === chatKey && !startedAt.has(reply.requestId)) startedAt.set(reply.requestId, reply.receivedAt);
  return pending
    .flatMap((request) => {
      const started = startedAt.get(request.id);
      return started ? [{ requestId: request.id, summary: request.summary, proposedAction: request.proposedAction, categories: request.categories, startedAt: started }] : [];
    })
    .slice(0, MAX_DISCUSSIONS);
}

/** This owner's messages in this chat since the discussion started and visible to the run, oldest first, with voice transcripts. */
export async function openwaOwnerMessagesSince(
  db: DbOrTransaction,
  input: { endpoint: EndpointRef; principalId: string; chatKey: string; since: Date; visibleBefore: Date; deliveryIds: string[] },
): Promise<OpenwaOwnerMessage[]> {
  const chatKey = openwaChatKey(input.chatKey);
  const rows = await db
    .select({ id: chatDeliveries.id, normalizedEvent: chatDeliveries.normalizedEvent })
    .from(chatDeliveries)
    .where(
      and(
        eq(chatDeliveries.companyId, input.endpoint.companyId),
        eq(chatDeliveries.endpointId, input.endpoint.id),
        eq(chatDeliveries.principalId, input.principalId),
        eq(chatDeliveries.triggerClass, "owner"),
        eq(chatDeliveries.principalRole, "owner"),
        gte(chatDeliveries.receivedAt, input.since),
        or(lte(chatDeliveries.receivedAt, input.visibleBefore), ...(input.deliveryIds.length ? [inArray(chatDeliveries.id, input.deliveryIds)] : [])),
      ),
    )
    .orderBy(desc(chatDeliveries.receivedAt), desc(chatDeliveries.id))
    .limit(MAX_EVIDENCE);
  const messages = rows.filter((row) => openwaChatKey(str(record(row.normalizedEvent.openwa).chatKey) ?? "") === chatKey).reverse();
  const waIds = messages.flatMap((row) => {
    const id = str(record(row.normalizedEvent.openwa).waMessageId);
    return id ? ["openwa_media:" + id] : [];
  });
  const media = waIds.length
    ? await db
        .select({ providerActionId: chatActions.providerActionId, payload: chatActions.payload })
        .from(chatActions)
        .where(
          and(
            eq(chatActions.companyId, input.endpoint.companyId),
            eq(chatActions.endpointId, input.endpoint.id),
            eq(chatActions.kind, "openwa_media"),
            inArray(chatActions.providerActionId, waIds),
          ),
        )
    : [];
  const transcripts = new Map(
    media.map((row) => {
      const items = record(row.payload).items;
      const texts = (Array.isArray(items) ? items : []).flatMap((item) => {
        const entry = record(item);
        const transcript = str(entry.transcript);
        return entry.transcriptStatus === "done" && transcript ? [transcript] : [];
      });
      return [row.providerActionId.slice("openwa_media:".length), texts] as const;
    }),
  );
  return messages.map((row) => {
    const waId = str(record(row.normalizedEvent.openwa).waMessageId);
    const text = [str(record(row.normalizedEvent.message).text), ...(waId ? (transcripts.get(waId) ?? []) : [])].filter(Boolean).join("\n");
    return { deliveryId: row.id, text };
  });
}

/** Owner text behind the decision, from the latest message with an explicit token to the newest message; null without one. */
export function openwaOwnerDecisionText(messages: readonly OpenwaOwnerMessage[], decision: OpenwaOwnerDecision): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (!openwaOwnerWordsDecide(messages[index]!.text, decision)) continue;
    const text = messages
      .slice(index)
      .map((message) => message.text)
      .filter(Boolean)
      .join("\n");
    return text.slice(0, MAX_OWNER_TEXT);
  }
  return null;
}
