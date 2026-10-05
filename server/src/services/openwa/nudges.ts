import { and, eq, inArray, max, sql } from "drizzle-orm";
import { chatDeliveries, chatOutboundMessages, heartbeatRuns, type Db } from "@tickernelz/paperclip-pro-db";
import { readOpenwaRunContext } from "./authority.js";
import type { OpenwaScheduledWakeClock } from "./scheduled-wakes.js";

export interface OpenwaRunStarted {
  companyId: string;
  runId: string;
  endpointId: string;
  chatKey: string;
}

export type OpenwaRunStartListener = (run: OpenwaRunStarted) => void;

const runStartListeners = new WeakMap<Db, OpenwaRunStartListener>();

export function registerOpenwaRunStartListener(db: Db, listener: OpenwaRunStartListener): () => void {
  runStartListeners.set(db, listener);
  return () => {
    if (runStartListeners.get(db) === listener) runStartListeners.delete(db);
  };
}

export function notifyOpenwaRunStarted(db: Db, run: OpenwaRunStarted): void {
  runStartListeners.get(db)?.(run);
}

export const OPENWA_NUDGE_REPEAT_MS = 180_000;
export const OPENWA_NUDGE_MAX_PER_RUN = 5;

export type OpenwaNudgeSteer = (input: { runId: string; text: string; correlationId: string }) => Promise<boolean>;

export type OpenwaNudgeWaiting = (runId: string, chatKey: string) => Promise<boolean>;

/** True when a visible pending trigger of the run in chatKey is newer than the latest sent outbound to that chat from any run. */
export function openwaNudgeWaiting(db: Db): OpenwaNudgeWaiting {
  return async (runId, chatKey) => {
    const [run] = await db
      .select({ companyId: heartbeatRuns.companyId, contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .limit(1);
    const openwa = run ? readOpenwaRunContext(run.contextSnapshot) : null;
    if (!run || !openwa || openwa.chatKey !== chatKey || openwa.deliveryIds.length === 0) return false;
    const [trigger] = await db
      .select({ at: max(chatDeliveries.receivedAt) })
      .from(chatDeliveries)
      .where(and(
        eq(chatDeliveries.companyId, run.companyId),
        eq(chatDeliveries.endpointId, openwa.endpointId),
        inArray(chatDeliveries.id, openwa.deliveryIds),
        eq(chatDeliveries.answerState, "pending"),
        sql`${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'chatKey' = ${chatKey}`,
      ));
    if (!trigger?.at) return false;
    const [outbound] = await db
      .select({ at: max(chatOutboundMessages.sentAt) })
      .from(chatOutboundMessages)
      .where(and(
        eq(chatOutboundMessages.companyId, run.companyId),
        eq(chatOutboundMessages.endpointId, openwa.endpointId),
        eq(chatOutboundMessages.chatKey, chatKey),
        eq(chatOutboundMessages.state, "sent"),
      ));
    return !outbound?.at || trigger.at.getTime() > outbound.at.getTime();
  };
}

export interface OpenwaNudgeRun {
  runId: string;
  chatKey: string;
  progressNudgeSeconds: number;
}

export interface OpenwaNudges {
  start(run: OpenwaNudgeRun): void;
  originSent(runId: string, chatKey: string): void;
  stop(runId: string): void;
  stopAll(): void;
  active(runId: string): boolean;
  sent(runId: string): number;
}

const systemClock: OpenwaScheduledWakeClock = {
  now: () => Date.now(),
  setTimer(fire, delayMs) {
    const handle = setTimeout(fire, delayMs);
    handle.unref?.();
    return handle;
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry {
  chatKey: string;
  quietMs: number;
  sent: number;
  failed: number;
  handle: unknown;
  generation: number;
}

function nudgeText(quietSeconds: number, sent: number): string {
  return [
    "Internal progress reminder from Paperclip (not sent to WhatsApp).",
    "A trigger in the origin chat has waited at least " + quietSeconds + " seconds without any reply to the chat.",
    "Send one short progress update with openwa_send only if your final reply is still minutes away; skip it if you are about to reply.",
    "Never restate what was already sent to the chat.",
    "Reminder " + sent + " of at most " + OPENWA_NUDGE_MAX_PER_RUN + ".",
  ].join(" ");
}

/** In-memory progress nudges per active run (spec 7.6): one timer per run, no polling, nothing sent to WhatsApp; only while a trigger waits unacknowledged and the run has sent nothing to the origin chat. */
export function createOpenwaNudges(deps: { steer: OpenwaNudgeSteer; waiting: OpenwaNudgeWaiting; clock?: OpenwaScheduledWakeClock }): OpenwaNudges {
  const clock = deps.clock ?? systemClock;
  const runs = new Map<string, Entry>();

  function schedule(runId: string, entry: Entry, delayMs: number) {
    if (entry.handle !== null) clock.clearTimer(entry.handle);
    const generation = ++entry.generation;
    entry.handle = clock.setTimer(() => void fire(runId, generation), delayMs);
  }

  async function fire(runId: string, generation: number) {
    const entry = runs.get(runId);
    if (!entry || entry.generation !== generation) return;
    entry.handle = null;
    const waiting = await deps.waiting(runId, entry.chatKey).catch(() => false);
    if (runs.get(runId) !== entry || entry.generation !== generation) return;
    if (!waiting) {
      runs.delete(runId);
      return;
    }
    const number = entry.sent + 1;
    const delivered = await deps.steer({
      runId,
      text: nudgeText(Math.round(entry.quietMs / 1000), number),
      correlationId: "openwa-nudge:" + runId + ":" + number,
    }).catch(() => false);
    if (runs.get(runId) !== entry) return;
    if (!delivered) {
      entry.failed++;
      if (entry.failed >= OPENWA_NUDGE_MAX_PER_RUN) runs.delete(runId);
      else if (entry.generation === generation) schedule(runId, entry, OPENWA_NUDGE_REPEAT_MS);
      return;
    }
    entry.sent = number;
    if (entry.sent >= OPENWA_NUDGE_MAX_PER_RUN) {
      runs.delete(runId);
      return;
    }
    if (entry.generation === generation) schedule(runId, entry, OPENWA_NUDGE_REPEAT_MS);
  }

  return {
    start(run) {
      if (run.progressNudgeSeconds <= 0 || runs.has(run.runId)) return;
      const entry: Entry = { chatKey: run.chatKey, quietMs: run.progressNudgeSeconds * 1000, sent: 0, failed: 0, handle: null, generation: 0 };
      runs.set(run.runId, entry);
      schedule(run.runId, entry, entry.quietMs);
    },
    originSent(runId, chatKey) {
      if (runs.get(runId)?.chatKey === chatKey) this.stop(runId);
    },
    stop(runId) {
      const entry = runs.get(runId);
      if (!entry) return;
      if (entry.handle !== null) clock.clearTimer(entry.handle);
      entry.generation++;
      runs.delete(runId);
    },
    stopAll() {
      for (const runId of [...runs.keys()]) this.stop(runId);
    },
    active(runId) {
      return runs.has(runId);
    },
    sent(runId) {
      return runs.get(runId)?.sent ?? 0;
    },
  };
}
