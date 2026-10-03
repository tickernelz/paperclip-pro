import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { chatOutboundMessages, type Db } from "@tickernelz/paperclip-pro-db";
import type {
  ChatOutboundMessageSource,
  ChatOutboundMessageState,
} from "@tickernelz/paperclip-pro-shared";
import {
  OpenwaGatewayError,
  type OpenwaGatewayClient,
  type OpenwaSendResult,
} from "./gateway.js";

export const OPENWA_OUTBOUND_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const OPENWA_OUTBOUND_INDEX_CAP = 50_000;
const OPEN_ROW_LIMIT = 10_000;
const STALE_PENDING_MS = 2 * 60_000;
const RECONCILE_CLOCK_SKEW_SECONDS = 120;
const RECONCILE_PAGE_SIZE = 100;

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type OpenwaOutboundSource = ChatOutboundMessageSource;
export type OpenwaOutboundState = ChatOutboundMessageState;

export interface OpenwaOutboundRecord {
  readonly id: string;
  readonly companyId: string;
  readonly endpointId: string;
  readonly chatKey: string;
  readonly source: OpenwaOutboundSource;
  readonly bodyHash: string;
  readonly clientNonce: string;
  readonly runId: string | null;
  readonly providerMessageId: string | null;
  readonly state: OpenwaOutboundState;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

export interface OpenwaEchoCandidate {
  waMessageId: string | null;
  chatKey: string;
  body: string;
}

export interface OpenwaOutboundRegistry {
  reserve(input: {
    database?: DbOrTransaction;
    companyId: string;
    endpointId: string;
    chatKey: string;
    source: OpenwaOutboundSource;
    body: string;
    runId?: string | null;
  }): Promise<OpenwaOutboundRecord>;
  settle(input: {
    record: OpenwaOutboundRecord;
    providerMessageId: string | null;
    state: Exclude<OpenwaOutboundState, "pending">;
  }): Promise<OpenwaOutboundRecord>;
  lookup(endpointId: string, waMessageId: string): OpenwaOutboundRecord | null;
  lookupStored(companyId: string, endpointId: string, waMessageId: string): Promise<OpenwaOutboundRecord | null>;
  matchEcho(endpointId: string, candidate: OpenwaEchoCandidate): Promise<OpenwaOutboundRecord | null>;
  applyAck(endpointId: string, input: { waMessageId: string; status: string }): Promise<OpenwaOutboundRecord | null>;
  preload(companyId: string, endpointId: string): Promise<void>;
  reconcileUncertain(companyId: string, endpointId: string, gateway: OpenwaGatewayClient): Promise<number>;
  forget(endpointId: string): void;
}

export function openwaChatKey(chatId: string): string {
  const trimmed = chatId.trim().toLowerCase();
  return trimmed.endsWith("@s.whatsapp.net") ? trimmed.slice(0, -"@s.whatsapp.net".length) + "@c.us" : trimmed;
}

export function openwaNormalizeBody(body: string): string {
  return body.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export function openwaBodyHash(body: string): string {
  return createHash("sha256").update(openwaNormalizeBody(body)).digest("hex");
}

export function openwaMessageKeyId(waMessageId: string): string {
  const match = /^(?:true|false)_[^_]+@[a-z.]+_([^_]+)(?:_.+)?$/.exec(waMessageId);
  return match ? match[1] : waMessageId;
}

type Row = typeof chatOutboundMessages.$inferSelect;

function toRecord(row: Row): OpenwaOutboundRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    endpointId: row.endpointId,
    chatKey: row.chatKey,
    source: row.source,
    bodyHash: row.bodyHash,
    clientNonce: row.clientNonce,
    runId: row.runId,
    providerMessageId: row.providerMessageId,
    state: row.state,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

function isOpen(state: OpenwaOutboundState): boolean {
  return state === "pending" || state === "uncertain";
}

class EndpointIndex {
  readonly byKeyId = new Map<string, OpenwaOutboundRecord>();
  readonly open = new Map<string, OpenwaOutboundRecord[]>();
  readonly inFlight = new Set<string>();

  put(record: OpenwaOutboundRecord): void {
    this.removeOpen(record.id);
    if (record.providerMessageId) {
      const key = openwaMessageKeyId(record.providerMessageId);
      this.byKeyId.delete(key);
      this.byKeyId.set(key, record);
      while (this.byKeyId.size > OPENWA_OUTBOUND_INDEX_CAP) {
        const oldest = this.byKeyId.keys().next().value;
        if (oldest === undefined) break;
        this.byKeyId.delete(oldest);
      }
    }
    if (isOpen(record.state)) {
      const key = record.chatKey + "\u0000" + record.bodyHash;
      const list = this.open.get(key);
      if (list) list.push(record);
      else this.open.set(key, [record]);
    }
  }

  removeOpen(id: string): void {
    for (const [key, list] of this.open) {
      const index = list.findIndex((entry) => entry.id === id);
      if (index < 0) continue;
      list.splice(index, 1);
      if (!list.length) this.open.delete(key);
      return;
    }
  }

  openRecords(): OpenwaOutboundRecord[] {
    return [...this.open.values()].flat();
  }
}

export function openwaOutboundRegistry(
  db: Db,
  now: () => number = Date.now,
  onSent?: (record: OpenwaOutboundRecord) => void,
): OpenwaOutboundRegistry {
  const indexes = new Map<string, EndpointIndex>();
  const index = (endpointId: string) => {
    let value = indexes.get(endpointId);
    if (!value) {
      value = new EndpointIndex();
      indexes.set(endpointId, value);
    }
    return value;
  };

  function withinWindow(record: OpenwaOutboundRecord): boolean {
    const at = (record.sentAt ?? record.createdAt).getTime();
    return now() - at <= OPENWA_OUTBOUND_WINDOW_MS;
  }

  function lookup(endpointId: string, waMessageId: string): OpenwaOutboundRecord | null {
    const record = indexes.get(endpointId)?.byKeyId.get(openwaMessageKeyId(waMessageId));
    return record && withinWindow(record) ? record : null;
  }

  async function recordProviderId(
    record: OpenwaOutboundRecord,
    providerMessageId: string,
    state: OpenwaOutboundState,
  ): Promise<OpenwaOutboundRecord> {
    const sentAt = record.sentAt ?? new Date(now());
    const [row] = await db
      .update(chatOutboundMessages)
      .set({ providerMessageId, state, sentAt, updatedAt: new Date(now()) })
      .where(
        and(
          eq(chatOutboundMessages.companyId, record.companyId),
          eq(chatOutboundMessages.endpointId, record.endpointId),
          eq(chatOutboundMessages.id, record.id),
          or(isNull(chatOutboundMessages.providerMessageId), eq(chatOutboundMessages.providerMessageId, providerMessageId)),
        ),
      )
      .returning();
    const next = row ? toRecord(row) : { ...record, providerMessageId, state, sentAt };
    index(record.endpointId).put(next);
    return next;
  }

  return {
    async reserve(input) {
      const [row] = await (input.database ?? db)
        .insert(chatOutboundMessages)
        .values({
          companyId: input.companyId,
          endpointId: input.endpointId,
          chatKey: input.chatKey,
          source: input.source,
          runId: input.runId ?? null,
          state: "pending",
          bodyHash: openwaBodyHash(input.body),
          clientNonce: randomUUID(),
        })
        .returning();
      const record = toRecord(row);
      const target = index(input.endpointId);
      target.inFlight.add(record.id);
      target.put(record);
      return record;
    },

    async settle({ record, providerMessageId, state }) {
      const target = index(record.endpointId);
      target.inFlight.delete(record.id);
      if (providerMessageId) {
        const sent = await recordProviderId(record, providerMessageId, state);
        if (state === "sent" && sent.runId) onSent?.(sent);
        return sent;
      }
      const [row] = await db
        .update(chatOutboundMessages)
        .set({ state, updatedAt: new Date(now()) })
        .where(
          and(
            eq(chatOutboundMessages.companyId, record.companyId),
            eq(chatOutboundMessages.endpointId, record.endpointId),
            eq(chatOutboundMessages.id, record.id),
            inArray(chatOutboundMessages.state, ["pending", "uncertain"]),
          ),
        )
        .returning();
      const next = row ? toRecord(row) : { ...record, state };
      target.put(next);
      return next;
    },

    lookup,

    async lookupStored(companyId, endpointId, waMessageId) {
      const cached = lookup(endpointId, waMessageId);
      if (cached) return cached;
      const [row] = await db
        .select()
        .from(chatOutboundMessages)
        .where(
          and(
            eq(chatOutboundMessages.companyId, companyId),
            eq(chatOutboundMessages.endpointId, endpointId),
            eq(chatOutboundMessages.providerMessageId, waMessageId),
          ),
        )
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async matchEcho(endpointId, candidate) {
      if (candidate.waMessageId) {
        const registered = lookup(endpointId, candidate.waMessageId);
        if (registered) return registered;
      }
      const target = indexes.get(endpointId);
      if (!target || !target.open.size) return null;
      const list = target.open.get(candidate.chatKey + "\u0000" + openwaBodyHash(candidate.body));
      const match = list?.[0];
      if (!match) return null;
      if (!candidate.waMessageId) return match;
      return recordProviderId(match, candidate.waMessageId, "sent");
    },

    async applyAck(endpointId, { waMessageId, status }) {
      const record = lookup(endpointId, waMessageId);
      if (!record) return null;
      if (status === "failed") {
        if (record.state === "failed") return record;
        return recordProviderId(record, record.providerMessageId ?? waMessageId, "failed");
      }
      if (["sent", "delivered", "read"].includes(status) && isOpen(record.state))
        return recordProviderId(record, record.providerMessageId ?? waMessageId, "sent");
      return record;
    },

    async preload(companyId, endpointId) {
      const since = new Date(now() - OPENWA_OUTBOUND_WINDOW_MS);
      const scope = and(
        eq(chatOutboundMessages.companyId, companyId),
        eq(chatOutboundMessages.endpointId, endpointId),
      );
      const recent = await db
        .select()
        .from(chatOutboundMessages)
        .where(and(scope, gte(chatOutboundMessages.sentAt, since)))
        .orderBy(desc(chatOutboundMessages.sentAt))
        .limit(OPENWA_OUTBOUND_INDEX_CAP);
      const open = await db
        .select()
        .from(chatOutboundMessages)
        .where(and(scope, inArray(chatOutboundMessages.state, ["pending", "uncertain"])))
        .orderBy(asc(chatOutboundMessages.createdAt))
        .limit(OPEN_ROW_LIMIT);
      const previous = indexes.get(endpointId);
      const fresh = new EndpointIndex();
      if (previous) for (const id of previous.inFlight) fresh.inFlight.add(id);
      for (const row of recent.reverse()) fresh.put(toRecord(row));
      for (const row of open) fresh.put(toRecord(row));
      if (previous) {
        for (const record of previous.byKeyId.values())
          if (!fresh.byKeyId.has(openwaMessageKeyId(record.providerMessageId!))) fresh.put(record);
        for (const record of previous.openRecords()) if (previous.inFlight.has(record.id)) fresh.put(record);
      }
      indexes.set(endpointId, fresh);
    },

    async reconcileUncertain(companyId, endpointId, gateway) {
      const target = indexes.get(endpointId);
      if (!target) return 0;
      const staleBefore = now() - STALE_PENDING_MS;
      const candidates = target
        .openRecords()
        .filter((record) => record.companyId === companyId && !target.inFlight.has(record.id))
        .filter((record) => record.state === "uncertain" || record.createdAt.getTime() <= staleBefore);
      if (!candidates.length) return 0;
      const byChat = new Map<string, OpenwaOutboundRecord[]>();
      for (const record of candidates) {
        const list = byChat.get(record.chatKey);
        if (list) list.push(record);
        else byChat.set(record.chatKey, [record]);
      }
      let reconciled = 0;
      for (const [chatKey, records] of byChat) {
        const page = await gateway.listStoredMessages({ chatId: chatKey, limit: RECONCILE_PAGE_SIZE, inlineMedia: false });
        const claimed = new Set<string>();
        for (const record of records.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
          const floor = Math.floor(record.createdAt.getTime() / 1000) - RECONCILE_CLOCK_SKEW_SECONDS;
          const stored = page.messages
            .filter((message) => message.direction === "outgoing" && message.waMessageId && !claimed.has(message.id))
            .filter((message) => (message.timestamp ?? Math.floor(Date.parse(message.createdAt) / 1000)) >= floor)
            .filter((message) => !lookup(endpointId, message.waMessageId!))
            .filter((message) => openwaBodyHash(message.body ?? "") === record.bodyHash)
            .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];
          if (stored) {
            claimed.add(stored.id);
            await recordProviderId(record, stored.waMessageId!, stored.status === "failed" ? "failed" : "sent");
            reconciled++;
          } else if (record.state === "pending") {
            const [row] = await db
              .update(chatOutboundMessages)
              .set({ state: "uncertain", updatedAt: new Date(now()) })
              .where(and(eq(chatOutboundMessages.id, record.id), eq(chatOutboundMessages.state, "pending")))
              .returning();
            if (row) target.put(toRecord(row));
          }
        }
      }
      return reconciled;
    },

    forget(endpointId) {
      indexes.delete(endpointId);
    },
  };
}

export interface OpenwaRegisteredSend {
  record: OpenwaOutboundRecord;
  result: OpenwaSendResult;
}

export async function sendThroughRegistry(input: {
  registry: OpenwaOutboundRegistry;
  database?: DbOrTransaction;
  companyId: string;
  endpointId: string;
  chatId: string;
  source: OpenwaOutboundSource;
  body: string;
  runId?: string | null;
  send: () => Promise<OpenwaSendResult>;
}): Promise<OpenwaRegisteredSend> {
  const record = await input.registry.reserve({
    database: input.database,
    companyId: input.companyId,
    endpointId: input.endpointId,
    chatKey: openwaChatKey(input.chatId),
    source: input.source,
    body: input.body,
    runId: input.runId,
  });
  let result: OpenwaSendResult;
  try {
    result = await input.send();
  } catch (error) {
    const definite = error instanceof OpenwaGatewayError && error.code !== "uncertain";
    await input.registry.settle({ record, providerMessageId: null, state: definite ? "failed" : "uncertain" });
    throw error;
  }
  if (!result || typeof result.messageId !== "string" || !result.messageId) {
    await input.registry.settle({ record, providerMessageId: null, state: "uncertain" });
    throw new OpenwaGatewayError("invalid_response", "OpenWA send returned no message id");
  }
  const settled = await input.registry.settle({ record, providerMessageId: result.messageId, state: "sent" });
  return { record: settled, result };
}
