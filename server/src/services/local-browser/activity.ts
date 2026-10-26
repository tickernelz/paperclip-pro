import type { LocalBrowserActivityState } from "@tickernelz/paperclip-pro-shared";
import { publishLiveEvent } from "../live-events.js";
import type { LiveSession } from "./types.js";

export const LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS = 300_000;

const idleTimers = new WeakMap<LiveSession, ReturnType<typeof setTimeout>>();

function clearIdleTimer(session: LiveSession): void {
  const timer = idleTimers.get(session);
  if (!timer) return;
  clearTimeout(timer);
  idleTimers.delete(session);
}

function armIdleTimer(session: LiveSession): void {
  clearIdleTimer(session);
  const timer = setTimeout(() => {
    idleTimers.delete(session);
    if (session.operatingCalls === 0) closeActivity(session);
  }, LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS);
  timer.unref?.();
  idleTimers.set(session, timer);
}

export const LOCAL_BROWSER_TAB_TOOLS: ReadonlySet<string> = new Set([
  "local_browser_open",
  "local_browser_navigate",
  "local_browser_snapshot",
  "local_browser_act",
  "local_browser_read",
  "local_browser_screenshot",
  "local_browser_wait",
  "local_browser_evaluate",
  "local_browser_upload",
  "local_browser_context",
]);

function publish(session: LiveSession, state: LocalBrowserActivityState, tabId: number | null, at: string): void {
  publishLiveEvent({
    companyId: session.companyId,
    type: "local_browser.activity",
    payload: { sessionId: session.sessionId, state, tabId, at },
  });
}

function changed(session: LiveSession, state: "operating" | "idle", tabId: number | null): boolean {
  const current = session.activity;
  return !current || current.state !== state || current.tabId !== tabId;
}

export function beginTabCall(session: LiveSession, tabId: number | null): void {
  session.operatingCalls += 1;
  clearIdleTimer(session);
  const next = tabId ?? session.activity?.tabId ?? null;
  if (!changed(session, "operating", next)) return;
  const at = new Date().toISOString();
  session.activity = { state: "operating", tabId: next, at };
  publish(session, "operating", next, at);
}

export function endTabCall(session: LiveSession, tabId: number | null): void {
  session.operatingCalls = Math.max(0, session.operatingCalls - 1);
  const next = tabId ?? session.activity?.tabId ?? null;
  const state = session.operatingCalls > 0 ? "operating" : "idle";
  if (state === "idle") armIdleTimer(session);
  if (!changed(session, state, next)) return;
  const at = new Date().toISOString();
  session.activity = { state, tabId: next, at };
  publish(session, state, next, at);
}

export function closeActivity(session: LiveSession): void {
  clearIdleTimer(session);
  const current = session.activity;
  if (!current) return;
  session.activity = null;
  session.operatingCalls = 0;
  publish(session, "closed", current.tabId, new Date().toISOString());
}

export function reconcileActivityWithTabs(session: LiveSession): void {
  const tabId = session.activity?.tabId;
  if (typeof tabId !== "number") return;
  if (session.tabs.some((tab) => tab.tabId === tabId)) return;
  closeActivity(session);
}
