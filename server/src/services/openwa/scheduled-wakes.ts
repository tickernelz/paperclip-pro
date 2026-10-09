import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import {
  agentWakeupRequests,
  chatActions,
  chatConversations,
  chatEndpoints,
  chatOutboundMessages,
  chatOwnerApprovalBubbles,
  chatOwnerApprovalRequests,
  chatScheduledWakes,
  issueThreadInteractions,
  issues,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { openwaEndpointPolicySchema, type ChatScheduledWakeKind } from "@tickernelz/paperclip-pro-shared";
import { logger } from "../../middleware/logger.js";
import type { IssueAssignmentWakeupDeps } from "../issue-assignment-wakeup.js";
import type { OpenwaTimerHooks } from "./admission.js";
import { logOpenwaActivity, recordOpenwaAudit } from "./audit.js";
import { reopenOpenwaConversationIssue } from "./conversation-status.js";
import { OPENWA_WAKE_MAX_MESSAGES } from "./guidance.js";
import { OPENWA_OWNER_ACTIVITY_TYPES, openwaChatSettings, openwaSenderRole, type OpenwaPolicySnapshot } from "./policy.js";
import type { OpenwaInboundEvent } from "./receiver.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type OpenwaScheduledWakeDb = Db | DbTransaction;
type ActionRow = typeof chatActions.$inferSelect;
type ApprovalRequestRow = typeof chatOwnerApprovalRequests.$inferSelect;

export const OPENWA_SCHEDULED_WAKE_ACTION_KIND = "scheduled_wakeup";
export const OPENWA_SCHEDULED_WAKE_ACTOR = "openwa:scheduled-wake";
export const OPENWA_MAX_APPROVAL_REMINDERS = 10;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const ACTION_STALE_MS = 60_000;
const ACTION_MAX_ATTEMPTS = 5;
const FIRE_CONCURRENCY = 4;
const RECENT_FIRED_CAP = 5_000;
const RECENT_FIRED_TTL_MS = 24 * 60 * 60 * 1000;
const RAW_KEYS = ["notifyName", "pushName"] as const;
const HOUR_MS = 3_600_000;
const APPROVAL_EXPIRY_EARLY_MS = 60_000;

export function openwaScheduledWakeActionId(wakeId: string): string {
  return OPENWA_SCHEDULED_WAKE_ACTION_KIND + ":" + wakeId;
}

export function openwaApprovalReminderWakeId(requestId: string, index: number): string {
  return seededWakeId("openwa-approval-reminder:" + requestId + ":" + index);
}

export function openwaApprovalExpiryWakeId(requestId: string, fireAt: Date): string {
  return seededWakeId("openwa-approval-expiry:" + requestId + ":" + fireAt.getTime());
}

function seededWakeId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-5" + hex.slice(13, 16) + "-" + variant + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

export interface DeadlineHeap<T> {
  push(deadline: number, value: T): void;
  peek(): { deadline: number; value: T } | null;
  pop(): { deadline: number; value: T } | null;
  readonly size: number;
}

export function createDeadlineHeap<T>(): DeadlineHeap<T> {
  const items: Array<{ deadline: number; seq: number; value: T }> = [];
  let seq = 0;
  const less = (a: (typeof items)[number], b: (typeof items)[number]) => a.deadline < b.deadline || (a.deadline === b.deadline && a.seq < b.seq);
  const swap = (i: number, j: number) => {
    const item = items[i];
    items[i] = items[j];
    items[j] = item;
  };
  return {
    push(deadline, value) {
      items.push({ deadline, seq: seq++, value });
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!less(items[index], items[parent])) break;
        swap(index, parent);
        index = parent;
      }
    },
    peek() {
      const top = items[0];
      return top ? { deadline: top.deadline, value: top.value } : null;
    },
    pop() {
      const top = items[0];
      if (!top) return null;
      const last = items.pop()!;
      if (items.length) {
        items[0] = last;
        let index = 0;
        for (;;) {
          const left = 2 * index + 1;
          const right = left + 1;
          let smallest = index;
          if (left < items.length && less(items[left], items[smallest])) smallest = left;
          if (right < items.length && less(items[right], items[smallest])) smallest = right;
          if (smallest === index) break;
          swap(index, smallest);
          index = smallest;
        }
      }
      return { deadline: top.deadline, value: top.value };
    },
    get size() {
      return items.length;
    },
  };
}

export interface OpenwaScheduledWakeClock {
  now(): number;
  setTimer(fire: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const openwaSystemClock: OpenwaScheduledWakeClock = {
  now: () => Date.now(),
  setTimer(fire, delayMs) {
    const handle = setTimeout(fire, delayMs);
    handle.unref?.();
    return handle;
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface OpenwaAbsenceIntent {
  actionId: string;
  wakeId: string;
  companyId: string;
  endpointId: string;
  chatKey: string;
  fireAt: Date;
  messages: OpenwaInboundEvent[];
}

export interface OpenwaLateOwnerActivity {
  companyId: string;
  endpointId: string;
  chatKey: string;
  wakeId: string;
  fireAt: Date;
  event: OpenwaInboundEvent;
}

export interface OpenwaScheduledWakesDeps {
  db: Db;
  companyId: string;
  endpointId: string;
  heartbeat: Pick<IssueAssignmentWakeupDeps, "wakeup">;
  /** Admits the attached messages and stages one owner_absent wake; must be idempotent. */
  deliverAbsence(intent: OpenwaAbsenceIntent): Promise<void>;
  /** Owner activity after a fired owner_absent wake in the same chat; steering belongs to the caller. */
  onLateOwnerActivity?(input: OpenwaLateOwnerActivity): Promise<void>;
  clock?: OpenwaScheduledWakeClock;
}

export interface OpenwaScheduledWakeStats {
  armed: number;
  attached: number;
  cancelled: number;
  claimed: number;
  delivered: number;
  failed: number;
  timerArms: number;
  timerFires: number;
}

export interface OpenwaScheduledWakes {
  readonly stats: OpenwaScheduledWakeStats;
  readonly pendingCount: number;
  readonly nextFireAt: Date | null;
  load(): Promise<{ loaded: number; overdue: number }>;
  start(): Promise<void>;
  armAbsence(event: OpenwaInboundEvent, absenceSeconds: number): Promise<{ outcome: "armed" | "attached"; wakeId: string; fireAt: Date }>;
  ownerActivity(chatKey: string, event: OpenwaInboundEvent): Promise<"cancelled" | "late" | "none">;
  hasPendingAbsence(chatKey: string): boolean;
  track(rows: ReadonlyArray<{ id: string; fireAt: Date; kind?: ChatScheduledWakeKind }>): void;
  forget(ids: readonly string[]): void;
  stop(): Promise<void>;
}

const active = new Map<string, OpenwaScheduledWakes>();

export function activeOpenwaScheduledWakes(endpointId: string): OpenwaScheduledWakes | null {
  return active.get(endpointId) ?? null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function absenceMessage(event: OpenwaInboundEvent): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of RAW_KEYS) if (typeof event.raw[key] === "string") raw[key] = event.raw[key];
  return { ...event, raw };
}

export function parseOpenwaAbsenceMessage(value: unknown): OpenwaInboundEvent | null {
  const source = record(value);
  const chatKey = stringOrNull(source.chatKey);
  const dedupeKey = stringOrNull(source.dedupeKey);
  const senderJid = stringOrNull(source.senderJid);
  const sessionId = stringOrNull(source.sessionId);
  if (!chatKey || !dedupeKey || !senderJid || !sessionId || typeof source.timestamp !== "number") return null;
  const quoted = record(source.quoted);
  const media = record(source.media);
  return {
    source: source.source === "catch_up" ? "catch_up" : "live",
    event: "message.received",
    sessionId,
    waMessageId: stringOrNull(source.waMessageId),
    rowUuid: stringOrNull(source.rowUuid),
    dedupeKey,
    chatId: stringOrNull(source.chatId) ?? chatKey,
    chatKey,
    chatKind: source.chatKind === "group" ? "group" : "dm",
    from: stringOrNull(source.from) ?? senderJid,
    author: stringOrNull(source.author),
    senderJid,
    senderPhone: stringOrNull(source.senderPhone),
    isLidSender: source.isLidSender === true,
    fromMe: false,
    phoneTyped: false,
    degraded: source.degraded === true,
    body: typeof source.body === "string" ? source.body : "",
    type: stringOrNull(source.type) ?? "unknown",
    timestamp: source.timestamp,
    mentionedIds: Array.isArray(source.mentionedIds) ? source.mentionedIds.filter((id): id is string => typeof id === "string") : [],
    quoted: typeof quoted.id === "string" ? { id: quoted.id, body: stringOrNull(quoted.body) } : null,
    media: Object.keys(media).length
      ? {
          mimetype: stringOrNull(media.mimetype),
          filename: stringOrNull(media.filename),
          sizeBytes: typeof media.sizeBytes === "number" ? media.sizeBytes : null,
          omitted: media.omitted === true,
        }
      : null,
    location: Object.keys(record(source.location)).length ? record(source.location) : null,
    contact: Object.keys(record(source.contact)).length ? record(source.contact) : null,
    raw: record(source.raw),
  };
}

type Outcome = { status: "processed" | "skipped"; result: Record<string, unknown> };

export function createOpenwaScheduledWakes(deps: OpenwaScheduledWakesDeps): OpenwaScheduledWakes {
  const { db, companyId, endpointId } = deps;
  const clock = deps.clock ?? openwaSystemClock;
  const heap = createDeadlineHeap<string>();
  const entries = new Map<string, number>();
  const pendingAbsence = new Map<string, string>();
  const absenceChat = new Map<string, string>();
  const recentlyFired = new Map<string, { wakeId: string; fireAt: number; firedAt: number }>();
  const pendingReminders = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  const stats: OpenwaScheduledWakeStats = { armed: 0, attached: 0, cancelled: 0, claimed: 0, delivered: 0, failed: 0, timerArms: 0, timerFires: 0 };
  let loading: Promise<{ loaded: number; overdue: number }> | null = null;
  let started = false;
  let stopped = false;
  let timer: unknown = null;
  let timerDeadline: number | null = null;

  function peekLive() {
    for (;;) {
      const top = heap.peek();
      if (!top) return null;
      if (entries.get(top.value) === top.deadline) return top;
      heap.pop();
    }
  }

  function clearTimer() {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    timerDeadline = null;
  }

  function armTimer() {
    if (!started || stopped) return;
    const next = peekLive();
    if (!next) {
      clearTimer();
      return;
    }
    if (timer !== null && timerDeadline === next.deadline) return;
    clearTimer();
    timerDeadline = next.deadline;
    stats.timerArms++;
    timer = clock.setTimer(onTimer, Math.min(MAX_TIMER_DELAY_MS, Math.max(0, next.deadline - clock.now())));
  }

  function schedule(key: string, deadline: number) {
    if (stopped || entries.get(key) === deadline) return;
    entries.set(key, deadline);
    heap.push(deadline, key);
    if (heap.size > 2 * entries.size + 64) {
      for (let item = heap.pop(); item; item = heap.pop());
      for (const [entry, at] of entries) heap.push(at, entry);
    }
    armTimer();
  }

  function unschedule(key: string) {
    entries.delete(key);
    if (key.startsWith("w:")) pendingReminders.delete(key.slice(2));
  }

  function forgetAbsence(wakeId: string) {
    const chatKey = absenceChat.get(wakeId);
    absenceChat.delete(wakeId);
    if (chatKey && pendingAbsence.get(chatKey) === wakeId) pendingAbsence.delete(chatKey);
  }

  function rememberAbsence(chatKey: string, wakeId: string) {
    pendingAbsence.set(chatKey, wakeId);
    absenceChat.set(wakeId, chatKey);
  }

  function rememberFired(chatKey: string, wakeId: string, fireAt: number) {
    recentlyFired.delete(chatKey);
    if (recentlyFired.size >= RECENT_FIRED_CAP) {
      const oldest = recentlyFired.keys().next().value;
      if (oldest !== undefined) recentlyFired.delete(oldest);
    }
    recentlyFired.set(chatKey, { wakeId, fireAt, firedAt: clock.now() });
  }

  function onTimer() {
    timer = null;
    timerDeadline = null;
    if (stopped) return;
    stats.timerFires++;
    const now = clock.now();
    const due: string[] = [];
    for (;;) {
      const top = peekLive();
      if (!top || top.deadline > now) break;
      heap.pop();
      entries.delete(top.value);
      due.push(top.value);
    }
    if (due.length) {
      const work = runDue(due).finally(() => {
        inFlight.delete(work);
        armTimer();
      });
      inFlight.add(work);
    }
    armTimer();
  }

  async function runDue(keys: string[]) {
    let next = 0;
    const worker = async () => {
      while (!stopped && next < keys.length) {
        const key = keys[next++];
        const id = key.slice(2);
        try {
          if (key.startsWith("w:")) await fireWake(id);
          else await processActionById(id);
        } catch (error) {
          logger.warn({ err: error, endpointId, key }, "openwa scheduled wake failed; retrying");
          if (!stopped) schedule(key, clock.now() + 1_000);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(FIRE_CONCURRENCY, keys.length) }, worker));
  }

  async function fireWake(wakeId: string) {
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(chatScheduledWakes)
        .set({ state: "fired", updatedAt: new Date(clock.now()) })
        .where(
          and(
            eq(chatScheduledWakes.id, wakeId),
            eq(chatScheduledWakes.companyId, companyId),
            eq(chatScheduledWakes.endpointId, endpointId),
            eq(chatScheduledWakes.state, "pending"),
          ),
        )
        .returning();
      if (!row) return null;
      const [action] = await tx
        .insert(chatActions)
        .values({
          companyId,
          endpointId,
          kind: OPENWA_SCHEDULED_WAKE_ACTION_KIND,
          providerActionId: openwaScheduledWakeActionId(row.id),
          status: "preparing",
          payload: {
            version: 1,
            wakeId: row.id,
            wakeKind: row.kind,
            chatKey: row.chatKey,
            fireAt: row.fireAt.toISOString(),
            relatedId: row.relatedId,
            data: row.payload,
          },
        })
        .onConflictDoNothing()
        .returning();
      return { row, action: action ?? null };
    });
    forgetAbsence(wakeId);
    pendingReminders.delete(wakeId);
    if (!claimed) return;
    stats.claimed++;
    if (claimed.row.kind === "owner_absent") rememberFired(claimed.row.chatKey, claimed.row.id, claimed.row.fireAt.getTime());
    if (claimed.action) await processAction(claimed.action);
  }

  async function processActionById(actionId: string) {
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.id, actionId), eq(chatActions.companyId, companyId), eq(chatActions.endpointId, endpointId)))
      .limit(1);
    if (action) await processAction(action);
  }

  async function processAction(action: ActionRow) {
    const now = new Date(clock.now());
    const [claimed] = await db
      .update(chatActions)
      .set({ status: "processing", updatedAt: now })
      .where(
        and(
          eq(chatActions.id, action.id),
          eq(chatActions.kind, OPENWA_SCHEDULED_WAKE_ACTION_KIND),
          or(
            eq(chatActions.status, "preparing"),
            and(eq(chatActions.status, "processing"), lte(chatActions.updatedAt, new Date(now.getTime() - ACTION_STALE_MS))),
          ),
        ),
      )
      .returning();
    if (!claimed) return;
    const attempts = Number(record(claimed.result).attempts ?? 0) + 1;
    const settle = (status: string, result: Record<string, unknown>) =>
      db
        .update(chatActions)
        .set({ status, result: { ...result, attempts }, updatedAt: new Date(clock.now()) })
        .where(and(eq(chatActions.id, claimed.id), eq(chatActions.status, "processing")));
    try {
      const outcome = await deliver(claimed);
      await settle(outcome.status, outcome.result);
      stats.delivered++;
    } catch (error) {
      const terminal = attempts >= ACTION_MAX_ATTEMPTS;
      const retryAt = clock.now() + Math.min(30_000, 1_000 * 2 ** attempts);
      logger.warn({ err: error, endpointId, actionId: claimed.id, attempts }, "openwa scheduled wake delivery failed");
      await settle(terminal ? "failed" : "preparing", {
        code: terminal ? "scheduled_wakeup_failed" : "scheduled_wakeup_retry",
        ...(terminal ? {} : { retryAt: new Date(retryAt).toISOString() }),
      });
      if (terminal) stats.failed++;
      else schedule("a:" + claimed.id, retryAt);
    }
  }

  async function deliver(action: ActionRow): Promise<Outcome> {
    const payload = record(action.payload);
    const wakeKind = payload.wakeKind as ChatScheduledWakeKind;
    const wakeId = String(payload.wakeId);
    const chatKey = String(payload.chatKey);
    const data = record(payload.data);
    if (wakeKind === "owner_absent") {
      const raw = Array.isArray(data.messages) ? data.messages : [];
      const messages = raw.map(parseOpenwaAbsenceMessage).filter((message): message is OpenwaInboundEvent => message !== null);
      if (!messages.length) return { status: "skipped", result: { code: "owner_absent_empty" } };
      await deps.deliverAbsence({
        actionId: action.id,
        wakeId,
        companyId,
        endpointId,
        chatKey,
        fireAt: new Date(String(payload.fireAt)),
        messages,
      });
      return { status: "processed", result: { code: "owner_absent_admitted", messages: messages.length } };
    }
    if (wakeKind === "approval_expiry")
      return deliverApprovalExpiry(db, deps.heartbeat, { companyId, endpointId, wakeId, requestId: stringOrNull(payload.relatedId), now: clock.now() });
    return deliverApprovalReminder(db, deps.heartbeat, {
      companyId,
      endpointId,
      wakeId,
      chatKey,
      requestId: stringOrNull(payload.relatedId),
      reminderIndex: Number(data.reminderIndex ?? 1),
      maxReminders: Number(data.maxReminders ?? 0),
    });
  }

  async function loadPending(): Promise<{ loaded: number; overdue: number }> {
    await ensureApprovalExpiryWakes(db, { companyId, endpointId });
    const [wakes, actions] = await Promise.all([
      db
        .select({ id: chatScheduledWakes.id, kind: chatScheduledWakes.kind, chatKey: chatScheduledWakes.chatKey, fireAt: chatScheduledWakes.fireAt })
        .from(chatScheduledWakes)
        .where(
          and(
            eq(chatScheduledWakes.companyId, companyId),
            eq(chatScheduledWakes.endpointId, endpointId),
            eq(chatScheduledWakes.state, "pending"),
          ),
        ),
      db
        .select({ id: chatActions.id, status: chatActions.status, result: chatActions.result, updatedAt: chatActions.updatedAt })
        .from(chatActions)
        .where(
          and(
            eq(chatActions.companyId, companyId),
            eq(chatActions.endpointId, endpointId),
            eq(chatActions.kind, OPENWA_SCHEDULED_WAKE_ACTION_KIND),
            inArray(chatActions.status, ["preparing", "processing"]),
          ),
        ),
    ]);
    if (stopped) return { loaded: 0, overdue: 0 };
    const now = clock.now();
    let overdue = 0;
    for (const wake of wakes) {
      if (wake.kind === "owner_absent") rememberAbsence(wake.chatKey, wake.id);
      if (wake.kind === "approval_reminder") pendingReminders.add(wake.id);
      if (wake.fireAt.getTime() <= now) overdue++;
      schedule("w:" + wake.id, wake.fireAt.getTime());
    }
    for (const action of actions) {
      const retryAt = Date.parse(String(record(action.result).retryAt ?? ""));
      const resumeAt = action.status === "processing" ? action.updatedAt.getTime() + ACTION_STALE_MS : Number.isFinite(retryAt) ? retryAt : now;
      schedule("a:" + action.id, resumeAt);
    }
    return { loaded: wakes.length + actions.length, overdue };
  }

  const api: OpenwaScheduledWakes = {
    stats,
    get pendingCount() {
      return entries.size;
    },
    get nextFireAt() {
      const next = peekLive();
      return next ? new Date(next.deadline) : null;
    },
    load() {
      loading ??= loadPending();
      return loading;
    },
    async start() {
      await api.load();
      if (stopped || started) return;
      started = true;
      armTimer();
    },
    async armAbsence(event, absenceSeconds) {
      const fireAt = new Date(event.timestamp * 1000 + absenceSeconds * 1000);
      const message = absenceMessage(event);
      const messages = sql`coalesce(${chatScheduledWakes.payload}->'messages', '[]'::jsonb)`;
      const [row] = await db
        .insert(chatScheduledWakes)
        .values({
          companyId,
          endpointId,
          chatKey: event.chatKey,
          kind: "owner_absent",
          fireAt,
          payload: { version: 1, messages: [message], omitted: 0 },
        })
        .onConflictDoUpdate({
          target: [chatScheduledWakes.endpointId, chatScheduledWakes.chatKey],
          targetWhere: sql`${chatScheduledWakes.kind} = 'owner_absent' and ${chatScheduledWakes.state} = 'pending'`,
          set: {
            payload: sql`case
              when ${messages} @> jsonb_build_array(jsonb_build_object('dedupeKey', ${event.dedupeKey}::text)) then ${chatScheduledWakes.payload}
              when jsonb_array_length(${messages}) >= ${OPENWA_WAKE_MAX_MESSAGES} then jsonb_set(${chatScheduledWakes.payload}, '{omitted}', to_jsonb(coalesce((${chatScheduledWakes.payload}->>'omitted')::int, 0) + 1))
              else jsonb_set(${chatScheduledWakes.payload}, '{messages}', ${messages} || (excluded.payload->'messages'))
            end`,
            updatedAt: new Date(clock.now()),
          },
        })
        .returning({ id: chatScheduledWakes.id, fireAt: chatScheduledWakes.fireAt, inserted: sql<boolean>`(xmax = 0)` });
      rememberAbsence(event.chatKey, row.id);
      schedule("w:" + row.id, row.fireAt.getTime());
      if (row.inserted) stats.armed++;
      else stats.attached++;
      return { outcome: row.inserted ? "armed" : "attached", wakeId: row.id, fireAt: row.fireAt };
    },
    async ownerActivity(chatKey, event) {
      const at = event.timestamp * 1000;
      if (pendingReminders.size) await cancelApprovalRemindersAfterOwnerReply(db, { companyId, endpointId, chatKey, at: new Date(at) });
      if (!pendingAbsence.has(chatKey)) {
        const fired = recentlyFired.get(chatKey);
        if (!fired || at < fired.fireAt || clock.now() - fired.firedAt > RECENT_FIRED_TTL_MS || !deps.onLateOwnerActivity) return "none";
        await deps.onLateOwnerActivity({ companyId, endpointId, chatKey, wakeId: fired.wakeId, fireAt: new Date(fired.fireAt), event });
        return "late";
      }
      const cancelled = await db
        .update(chatScheduledWakes)
        .set({ state: "cancelled", updatedAt: new Date(clock.now()) })
        .where(
          and(
            eq(chatScheduledWakes.endpointId, endpointId),
            eq(chatScheduledWakes.chatKey, chatKey),
            eq(chatScheduledWakes.kind, "owner_absent"),
            eq(chatScheduledWakes.state, "pending"),
            gt(chatScheduledWakes.fireAt, new Date(at)),
          ),
        )
        .returning({ id: chatScheduledWakes.id });
      for (const row of cancelled) {
        forgetAbsence(row.id);
        unschedule("w:" + row.id);
        stats.cancelled++;
      }
      return cancelled.length ? "cancelled" : "none";
    },
    hasPendingAbsence(chatKey) {
      return pendingAbsence.has(chatKey);
    },
    track(rows) {
      for (const row of rows) {
        if (row.kind === "approval_reminder") pendingReminders.add(row.id);
        schedule("w:" + row.id, row.fireAt.getTime());
      }
    },
    forget(ids) {
      for (const id of ids) unschedule("w:" + id);
    },
    async stop() {
      stopped = true;
      clearTimer();
      if (active.get(endpointId) === api) active.delete(endpointId);
      await Promise.allSettled([...inFlight]);
    },
  };
  active.set(endpointId, api);
  return api;
}

export function createOpenwaTimerHooks(input: {
  lookup(endpointId: string): OpenwaScheduledWakes | null;
  policies: { peek(endpointId: string): OpenwaPolicySnapshot | null };
}): Required<OpenwaTimerHooks> {
  return {
    async onOwnerActivity(chatKey, event, ctx) {
      if (!OPENWA_OWNER_ACTIVITY_TYPES.has(event.type)) return;
      const wakes = input.lookup(ctx.endpointId);
      if (!wakes) return;
      if (!event.phoneTyped && input.policies.peek(ctx.endpointId)?.policy.numberMode === "owner_number") return;
      await wakes.ownerActivity(chatKey, event);
    },
    async onAbsenceCandidate(event, ctx) {
      const wakes = input.lookup(ctx.endpointId);
      const snapshot = input.policies.peek(ctx.endpointId);
      if (!wakes || !snapshot) return;
      const role = openwaSenderRole(snapshot, null, event.senderPhone);
      if (role === "denylisted" || (role === "outside_allowlist" && event.chatKind === "dm")) return;
      const absenceSeconds = openwaChatSettings(snapshot, event.chatKey).absenceSeconds ?? snapshot.policy.absenceSeconds;
      await wakes.armAbsence(event, absenceSeconds);
    },
  };
}

/** Schedules reminders 1..maxReminders at reminderMinutes x k after createdAt, before the pending expiry, plus the expiry wake; idempotent per request. */
export async function scheduleApprovalReminders(
  db: OpenwaScheduledWakeDb,
  input: { companyId: string; endpointId: string; requestId: string; chatKey: string; createdAt: Date },
): Promise<void> {
  const [endpoint] = await db
    .select({ policy: chatEndpoints.policy })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId), eq(chatEndpoints.provider, "openwa")))
    .limit(1);
  if (!endpoint) throw new Error("OpenWA endpoint not found for approval reminders");
  const { reminderMinutes, maxReminders, pendingTtlHours } = openwaEndpointPolicySchema.parse(endpoint.policy ?? {}).approvals;
  const expiresAt = new Date(input.createdAt.getTime() + pendingTtlHours * HOUR_MS);
  const reminders = Array.from({ length: Math.min(maxReminders, OPENWA_MAX_APPROVAL_REMINDERS) }, (_, offset) => {
    const reminderIndex = offset + 1;
    return {
      id: openwaApprovalReminderWakeId(input.requestId, reminderIndex),
      companyId: input.companyId,
      endpointId: input.endpointId,
      chatKey: input.chatKey,
      kind: "approval_reminder" as const,
      fireAt: new Date(input.createdAt.getTime() + reminderIndex * reminderMinutes * 60_000),
      relatedId: input.requestId,
      payload: { version: 1, reminderIndex, maxReminders, reminderMinutes },
    };
  }).filter((row) => row.fireAt < expiresAt);
  const expiry = {
    id: openwaApprovalExpiryWakeId(input.requestId, expiresAt),
    companyId: input.companyId,
    endpointId: input.endpointId,
    chatKey: input.chatKey,
    kind: "approval_expiry" as const,
    fireAt: expiresAt,
    relatedId: input.requestId,
    payload: { version: 1, pendingTtlHours },
  };
  const inserted = await db
    .insert(chatScheduledWakes)
    .values([...reminders, expiry])
    .onConflictDoNothing()
    .returning({ id: chatScheduledWakes.id, fireAt: chatScheduledWakes.fireAt, kind: chatScheduledWakes.kind });
  activeOpenwaScheduledWakes(input.endpointId)?.track(inserted);
}

/** Gives every pending request exactly one pending expiry wake at createdAt + pendingTtlHours, moving existing ones when the TTL changed. */
export async function ensureApprovalExpiryWakes(db: OpenwaScheduledWakeDb, input: { companyId: string; endpointId: string }): Promise<void> {
  const [endpoint] = await db
    .select({ policy: chatEndpoints.policy })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId), eq(chatEndpoints.provider, "openwa")))
    .limit(1);
  if (!endpoint) return;
  const { pendingTtlHours } = openwaEndpointPolicySchema.parse(endpoint.policy ?? {}).approvals;
  const requests = await db
    .select({ id: chatOwnerApprovalRequests.id, createdAt: chatOwnerApprovalRequests.createdAt, originChatKey: chatOwnerApprovalRequests.originChatKey })
    .from(chatOwnerApprovalRequests)
    .where(
      and(
        eq(chatOwnerApprovalRequests.companyId, input.companyId),
        eq(chatOwnerApprovalRequests.endpointId, input.endpointId),
        eq(chatOwnerApprovalRequests.status, "pending"),
      ),
    );
  if (!requests.length) return;
  const wakes = await db
    .select({ id: chatScheduledWakes.id, relatedId: chatScheduledWakes.relatedId, fireAt: chatScheduledWakes.fireAt })
    .from(chatScheduledWakes)
    .where(
      and(
        eq(chatScheduledWakes.companyId, input.companyId),
        eq(chatScheduledWakes.endpointId, input.endpointId),
        eq(chatScheduledWakes.kind, "approval_expiry"),
        eq(chatScheduledWakes.state, "pending"),
        inArray(chatScheduledWakes.relatedId, requests.map((request) => request.id)),
      ),
    );
  const existing = new Map(wakes.map((wake) => [wake.relatedId, wake]));
  const tracked: Array<{ id: string; fireAt: Date }> = [];
  const missing = [];
  for (const request of requests) {
    const fireAt = new Date(request.createdAt.getTime() + pendingTtlHours * HOUR_MS);
    const wake = existing.get(request.id);
    if (!wake) {
      missing.push({
        id: openwaApprovalExpiryWakeId(request.id, fireAt),
        companyId: input.companyId,
        endpointId: input.endpointId,
        chatKey: request.originChatKey,
        kind: "approval_expiry" as const,
        fireAt,
        relatedId: request.id,
        payload: { version: 1, pendingTtlHours },
      });
      continue;
    }
    if (wake.fireAt.getTime() === fireAt.getTime()) continue;
    const moved = await db
      .update(chatScheduledWakes)
      .set({ fireAt, payload: { version: 1, pendingTtlHours }, updatedAt: new Date() })
      .where(and(eq(chatScheduledWakes.id, wake.id), eq(chatScheduledWakes.state, "pending")))
      .returning({ id: chatScheduledWakes.id, fireAt: chatScheduledWakes.fireAt });
    tracked.push(...moved);
  }
  if (missing.length)
    tracked.push(
      ...(await db.insert(chatScheduledWakes).values(missing).onConflictDoNothing().returning({ id: chatScheduledWakes.id, fireAt: chatScheduledWakes.fireAt })),
    );
  activeOpenwaScheduledWakes(input.endpointId)?.track(tracked);
}

async function cancelRequestWakes(
  db: OpenwaScheduledWakeDb,
  input: { companyId: string; endpointId: string; requestIds: string[]; kinds: ChatScheduledWakeKind[] },
): Promise<string[]> {
  if (!input.requestIds.length) return [];
  const cancelled = await db
    .update(chatScheduledWakes)
    .set({ state: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(chatScheduledWakes.companyId, input.companyId),
        eq(chatScheduledWakes.endpointId, input.endpointId),
        inArray(chatScheduledWakes.relatedId, input.requestIds),
        inArray(chatScheduledWakes.kind, input.kinds),
        eq(chatScheduledWakes.state, "pending"),
      ),
    )
    .returning({ id: chatScheduledWakes.id });
  activeOpenwaScheduledWakes(input.endpointId)?.forget(cancelled.map((row) => row.id));
  return cancelled.map((row) => row.id);
}

/** Cancels every pending reminder and expiry wake of a request that left pending. */
export async function cancelApprovalReminders(
  db: OpenwaScheduledWakeDb,
  input: { companyId: string; endpointId: string; requestId: string },
): Promise<void> {
  await cancelRequestWakes(db, { ...input, requestIds: [input.requestId], kinds: ["approval_reminder", "approval_expiry"] });
}

/** Cancels the remaining reminders of pending requests created before an owner message in their origin chat or in a chat that got their bubble; the requests stay pending. */
export async function cancelApprovalRemindersAfterOwnerReply(
  db: OpenwaScheduledWakeDb,
  input: { companyId: string; endpointId: string; chatKey: string; at: Date },
): Promise<string[]> {
  const bubbledHere = db
    .select({ requestId: chatOwnerApprovalBubbles.requestId })
    .from(chatOwnerApprovalBubbles)
    .innerJoin(
      chatOutboundMessages,
      and(eq(chatOutboundMessages.companyId, chatOwnerApprovalBubbles.companyId), eq(chatOutboundMessages.id, chatOwnerApprovalBubbles.outboundMessageId)),
    )
    .where(
      and(
        eq(chatOwnerApprovalBubbles.companyId, input.companyId),
        eq(chatOwnerApprovalBubbles.endpointId, input.endpointId),
        eq(chatOutboundMessages.chatKey, input.chatKey),
      ),
    );
  const requests = await db
    .select({ id: chatOwnerApprovalRequests.id })
    .from(chatOwnerApprovalRequests)
    .where(
      and(
        eq(chatOwnerApprovalRequests.companyId, input.companyId),
        eq(chatOwnerApprovalRequests.endpointId, input.endpointId),
        eq(chatOwnerApprovalRequests.status, "pending"),
        lt(chatOwnerApprovalRequests.createdAt, input.at),
        or(eq(chatOwnerApprovalRequests.originChatKey, input.chatKey), inArray(chatOwnerApprovalRequests.id, bubbledHere)),
      ),
    );
  if (!requests.length) return [];
  await cancelRequestWakes(db, { ...input, requestIds: requests.map((request) => request.id), kinds: ["approval_reminder"] });
  return requests.map((request) => request.id);
}

type ApprovalWakeTarget = { conversation: typeof chatConversations.$inferSelect; issue: typeof issues.$inferSelect & { assigneeAgentId: string } };

async function approvalWakeTarget(db: Db, input: { companyId: string; endpointId: string }, request: ApprovalRequestRow): Promise<ApprovalWakeTarget | null> {
  const [endpoint] = await db
    .select({ providerAccountId: chatEndpoints.providerAccountId })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId)))
    .limit(1);
  const account = endpoint?.providerAccountId ?? "";
  const externalConversationId = "openwa:" + account.slice(account.lastIndexOf("#") + 1) + ":" + request.originChatKey;
  const conversationColumns = { conversation: chatConversations, issue: issues };
  const joined = and(eq(issues.companyId, chatConversations.companyId), eq(issues.id, chatConversations.issueId));
  const [current] = await db
    .select(conversationColumns)
    .from(chatConversations)
    .innerJoin(issues, joined)
    .where(
      and(
        eq(chatConversations.companyId, input.companyId),
        eq(chatConversations.endpointId, input.endpointId),
        eq(chatConversations.externalConversationId, externalConversationId),
        inArray(chatConversations.state, ["active", "waiting"]),
      ),
    )
    .orderBy(desc(chatConversations.sessionGeneration))
    .limit(1);
  const [origin] = current || !request.originConversationId
    ? []
    : await db
        .select(conversationColumns)
        .from(chatConversations)
        .innerJoin(issues, joined)
        .where(and(eq(chatConversations.companyId, input.companyId), eq(chatConversations.id, request.originConversationId)))
        .limit(1);
  const target = current ?? origin;
  if (!target || !target.issue.assigneeAgentId || ["backlog", "done", "cancelled"].includes(target.issue.status)) return null;
  return target as ApprovalWakeTarget;
}

async function wakeApprovalAgent(
  db: Db,
  heartbeat: Pick<IssueAssignmentWakeupDeps, "wakeup">,
  input: { companyId: string; target: ApprovalWakeTarget; requestId: string; idempotencyKey: string; event: "approval_pending" | "approval_expired"; reason: string },
): Promise<boolean> {
  const { issue } = input.target;
  const agentId = issue.assigneeAgentId;
  const openwa = { event: input.event, triggerClass: "other", deliveryIds: [] as string[], approvalRequestId: input.requestId };
  const [existing] = await db
    .select({ id: agentWakeupRequests.id })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, input.companyId),
        eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.idempotencyKey, input.idempotencyKey),
      ),
    )
    .orderBy(asc(agentWakeupRequests.requestedAt))
    .limit(1);
  if (existing) return false;
  await reopenOpenwaConversationIssue(db, { companyId: input.companyId, issueId: issue.id, actorId: OPENWA_SCHEDULED_WAKE_ACTOR, wake: input.event });
  await heartbeat.wakeup(agentId, {
    source: "assignment",
    triggerDetail: "system",
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    requestedByActorType: "system",
    requestedByActorId: OPENWA_SCHEDULED_WAKE_ACTOR,
    payload: { issueId: issue.id, mutation: "openwa_" + input.event, taskKey: issue.identifier, openwa },
    contextSnapshot: { issueId: issue.id, source: "chat:openwa", taskKey: issue.identifier, openwa },
  });
  return true;
}

async function deliverApprovalReminder(
  db: Db,
  heartbeat: Pick<IssueAssignmentWakeupDeps, "wakeup">,
  input: { companyId: string; endpointId: string; wakeId: string; chatKey: string; requestId: string | null; reminderIndex: number; maxReminders: number },
): Promise<Outcome> {
  if (!input.requestId) return { status: "skipped", result: { code: "approval_request_missing" } };
  const [request] = await db
    .update(chatOwnerApprovalRequests)
    .set({ reminderCount: sql`greatest(${chatOwnerApprovalRequests.reminderCount}, ${input.reminderIndex})`, updatedAt: new Date() })
    .where(
      and(
        eq(chatOwnerApprovalRequests.companyId, input.companyId),
        eq(chatOwnerApprovalRequests.endpointId, input.endpointId),
        eq(chatOwnerApprovalRequests.id, input.requestId),
        eq(chatOwnerApprovalRequests.status, "pending"),
      ),
    )
    .returning();
  if (!request) return { status: "skipped", result: { code: "approval_not_pending" } };
  const target = await approvalWakeTarget(db, input, request);
  if (!target) return { status: "skipped", result: { code: "approval_conversation_unavailable" } };
  const woke = await wakeApprovalAgent(db, heartbeat, {
    companyId: input.companyId,
    target,
    requestId: request.id,
    idempotencyKey: "openwa-scheduled-wake:" + input.wakeId,
    event: "approval_pending",
    reason: "OpenWA approval request is still pending",
  });
  if (woke)
    await recordOpenwaAudit(db, {
      companyId: input.companyId,
      endpointId: input.endpointId,
      kind: "approval_reminded",
      actorKind: "system",
      actorRef: OPENWA_SCHEDULED_WAKE_ACTOR,
      chatKey: input.chatKey,
      conversationId: target.conversation.id,
      metadata: { requestId: request.id, reminderIndex: input.reminderIndex, maxReminders: input.maxReminders, wakeId: input.wakeId },
    });
  return { status: "processed", result: { code: "approval_pending_woken", issueId: target.issue.id, reminderIndex: input.reminderIndex } };
}

async function deliverApprovalExpiry(
  db: Db,
  heartbeat: Pick<IssueAssignmentWakeupDeps, "wakeup">,
  input: { companyId: string; endpointId: string; wakeId: string; requestId: string | null; now: number },
): Promise<Outcome> {
  const requestId = input.requestId;
  if (!requestId) return { status: "skipped", result: { code: "approval_request_missing" } };
  const [endpoint] = await db
    .select({ policy: chatEndpoints.policy })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, input.companyId), eq(chatEndpoints.id, input.endpointId), eq(chatEndpoints.provider, "openwa")))
    .limit(1);
  if (!endpoint) return { status: "skipped", result: { code: "approval_endpoint_missing" } };
  const { pendingTtlHours } = openwaEndpointPolicySchema.parse(endpoint.policy ?? {}).approvals;
  const now = new Date(input.now);
  const step = await db.transaction(async (tx): Promise<{ request: ApprovalRequestRow } | { code: string }> => {
    const [request] = await tx
      .select()
      .from(chatOwnerApprovalRequests)
      .where(
        and(
          eq(chatOwnerApprovalRequests.companyId, input.companyId),
          eq(chatOwnerApprovalRequests.endpointId, input.endpointId),
          eq(chatOwnerApprovalRequests.id, requestId),
        ),
      )
      .for("update")
      .limit(1);
    if (!request) return { code: "approval_request_missing" };
    if (request.status === "expired") return { request };
    if (request.status !== "pending") return { code: "approval_not_pending" };
    if (request.createdAt.getTime() + pendingTtlHours * HOUR_MS > now.getTime() + APPROVAL_EXPIRY_EARLY_MS) return { code: "approval_expiry_rescheduled" };
    const [expired] = await tx
      .update(chatOwnerApprovalRequests)
      .set({ status: "expired", resolvedAt: now, updatedAt: now })
      .where(and(eq(chatOwnerApprovalRequests.id, request.id), eq(chatOwnerApprovalRequests.status, "pending")))
      .returning();
    if (request.interactionId)
      await tx
        .update(issueThreadInteractions)
        .set({
          status: "expired",
          result: { version: 1, outcome: "withdrawn", reason: "Expired after " + pendingTtlHours + " hours without an owner decision" },
          resolvedByUserId: null,
          resolvedByAgentId: null,
          resolvedByRunId: null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(issueThreadInteractions.id, request.interactionId),
            eq(issueThreadInteractions.companyId, input.companyId),
            eq(issueThreadInteractions.status, "pending"),
          ),
        );
    await cancelApprovalReminders(tx, { companyId: input.companyId, endpointId: input.endpointId, requestId: request.id });
    await recordOpenwaAudit(tx, {
      companyId: input.companyId,
      endpointId: input.endpointId,
      kind: "approval_expired",
      actorKind: "system",
      actorRef: OPENWA_SCHEDULED_WAKE_ACTOR,
      chatKey: request.originChatKey,
      conversationId: request.originConversationId,
      metadata: { requestId: request.id, pendingTtlHours, reminderCount: request.reminderCount, wakeId: input.wakeId },
    });
    await logOpenwaActivity(tx, {
      companyId: input.companyId,
      endpointId: input.endpointId,
      action: "openwa.approval_expired",
      details: { requestId: request.id, pendingTtlHours },
    });
    return { request: expired! };
  });
  if (!("request" in step)) {
    if (step.code === "approval_expiry_rescheduled") await ensureApprovalExpiryWakes(db, input);
    return { status: "skipped", result: { code: step.code } };
  }
  const target = await approvalWakeTarget(db, input, step.request);
  if (!target) return { status: "processed", result: { code: "approval_expired", woken: false } };
  await wakeApprovalAgent(db, heartbeat, {
    companyId: input.companyId,
    target,
    requestId: step.request.id,
    idempotencyKey: "openwa-approval-expired:" + step.request.id,
    event: "approval_expired",
    reason: "OpenWA approval request expired",
  });
  return { status: "processed", result: { code: "approval_expired_woken", issueId: target.issue.id } };
}
