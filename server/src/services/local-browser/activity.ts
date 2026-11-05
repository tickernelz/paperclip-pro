import type { LiveSession, TabOperator } from "./types.js";

export const LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS = 300_000;
export const LOCAL_BROWSER_INDICATOR_CAPABILITY = "indicator.v1";

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

export interface LocalBrowserOperatorRef {
  key: string;
  name: string | null;
}

export interface LocalBrowserIndicatorTab {
  tabId: number;
  agents: string[];
}

type IndicatorSender = (session: LiveSession, tabs: LocalBrowserIndicatorTab[]) => Promise<unknown>;

let indicatorSender: IndicatorSender | null = null;

export function setLocalBrowserIndicatorSender(sender: IndicatorSender | null): void {
  indicatorSender = sender;
}

export function localBrowserIndicatorTabs(session: LiveSession): LocalBrowserIndicatorTab[] {
  const byTab = new Map<number, string[]>();
  for (const operator of session.operators.values()) {
    if (operator.tabId === null) continue;
    const agents = byTab.get(operator.tabId) ?? [];
    if (operator.name && !agents.includes(operator.name)) agents.push(operator.name);
    byTab.set(operator.tabId, agents);
  }
  return [...byTab.entries()].sort((a, b) => a[0] - b[0]).map(([tabId, agents]) => ({ tabId, agents }));
}

function syncIndicators(session: LiveSession): void {
  const sender = indicatorSender;
  if (!sender || !session.capabilities.includes(LOCAL_BROWSER_INDICATOR_CAPABILITY)) return;
  const sync = session.indicatorSync;
  if (sync.inFlight) {
    sync.dirty = true;
    return;
  }
  const tabs = localBrowserIndicatorTabs(session);
  const key = JSON.stringify(tabs);
  if (key === sync.sent) return;
  sync.inFlight = true;
  sync.dirty = false;
  sender(session, tabs)
    .then(
      () => {
        sync.sent = key;
      },
      () => undefined,
    )
    .finally(() => {
      sync.inFlight = false;
      if (sync.dirty) syncIndicators(session);
    });
}

function clearIdleTimer(operator: TabOperator): void {
  if (!operator.timer) return;
  clearTimeout(operator.timer);
  operator.timer = null;
}

function armIdleTimer(session: LiveSession, key: string, operator: TabOperator): void {
  clearIdleTimer(operator);
  operator.timer = setTimeout(() => {
    operator.timer = null;
    if (operator.calls !== 0 || session.operators.get(key) !== operator) return;
    session.operators.delete(key);
    syncIndicators(session);
  }, LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS);
  operator.timer.unref?.();
}

export function touchActivity(session: LiveSession): void {
  for (const [key, operator] of session.operators) {
    if (operator.calls === 0) armIdleTimer(session, key, operator);
  }
}

export function beginTabCall(session: LiveSession, ref: LocalBrowserOperatorRef, tabId: number | null): void {
  let operator = session.operators.get(ref.key);
  if (!operator) {
    operator = { name: ref.name, calls: 0, tabId: null, timer: null };
    session.operators.set(ref.key, operator);
  }
  operator.name = ref.name ?? operator.name;
  operator.calls += 1;
  operator.tabId = tabId ?? operator.tabId;
  clearIdleTimer(operator);
  syncIndicators(session);
}

export function endTabCall(session: LiveSession, ref: LocalBrowserOperatorRef, tabId: number | null): void {
  const operator = session.operators.get(ref.key);
  if (!operator) return;
  operator.calls = Math.max(0, operator.calls - 1);
  operator.tabId = tabId ?? operator.tabId;
  if (operator.calls === 0) armIdleTimer(session, ref.key, operator);
  syncIndicators(session);
}

export function closeActivity(session: LiveSession): void {
  for (const operator of session.operators.values()) clearIdleTimer(operator);
  session.operators.clear();
}

export function reconcileActivityWithTabs(session: LiveSession): void {
  const open = new Set(session.tabs.map((tab) => tab.tabId));
  let closed = false;
  for (const [key, operator] of [...session.operators]) {
    if (typeof operator.tabId !== "number" || open.has(operator.tabId)) continue;
    clearIdleTimer(operator);
    session.operators.delete(key);
    closed = true;
  }
  if (closed) syncIndicators(session);
}
