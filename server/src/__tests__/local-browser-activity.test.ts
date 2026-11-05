import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTabCall,
  closeActivity,
  endTabCall,
  LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS,
  LOCAL_BROWSER_INDICATOR_CAPABILITY,
  reconcileActivityWithTabs,
  setLocalBrowserIndicatorSender,
  touchActivity,
  type LocalBrowserIndicatorTab,
} from "../services/local-browser/activity.js";
import type { LiveSession } from "../services/local-browser/types.js";

const ADA = { key: "agent:ada", name: "Ada" };
const BOB = { key: "agent:bob", name: "Bob" };

function fakeSession(capabilities: string[] = [LOCAL_BROWSER_INDICATOR_CAPABILITY]): LiveSession {
  return {
    companyId: "33333333-3333-4333-8333-333333333333",
    sessionId: "44444444-4444-4444-8444-444444444444",
    capabilities,
    tabs: [],
    operators: new Map(),
    indicatorSync: { inFlight: false, dirty: false, sent: "[]" },
  } as unknown as LiveSession;
}

function operatedTabs(session: LiveSession): Array<number | null> {
  return [...session.operators.values()].map((operator) => operator.tabId);
}

describe("local browser tab indicator", () => {
  const sent: LocalBrowserIndicatorTab[][] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    sent.length = 0;
    setLocalBrowserIndicatorSender(async (_session, tabs) => {
      sent.push(tabs);
    });
  });

  afterEach(() => {
    setLocalBrowserIndicatorSender(null);
    vi.useRealTimers();
  });

  it("drops the tab only after the agent stays idle past the window, not between sequential calls", async () => {
    const session = fakeSession();
    beginTabCall(session, ADA, 9);
    endTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1);
    expect(operatedTabs(session)).toEqual([9]);

    beginTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 3);
    expect(operatedTabs(session)).toEqual([9]);

    endTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS);
    expect(operatedTabs(session)).toEqual([]);
    expect(sent.at(-1)).toEqual([]);
  });

  it("postpones the idle drop while the user drives the live view, and starts none without an agent", async () => {
    const session = fakeSession();
    touchActivity(session);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 2);
    expect(sent).toEqual([]);

    beginTabCall(session, ADA, 9);
    endTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1000);
    touchActivity(session);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1000);
    expect(operatedTabs(session)).toEqual([9]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(operatedTabs(session)).toEqual([]);
  });

  it("keeps the tab marked while another call is still running", async () => {
    const session = fakeSession();
    beginTabCall(session, ADA, 9);
    beginTabCall(session, ADA, 9);
    endTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 2);
    expect(operatedTabs(session)).toEqual([9]);
  });

  it("keeps one agent's tab when another agent works in a different tab", () => {
    const session = fakeSession();
    beginTabCall(session, ADA, 9);
    endTabCall(session, ADA, 9);
    beginTabCall(session, BOB, 12);
    endTabCall(session, BOB, null);
    beginTabCall(session, ADA, null);
    endTabCall(session, ADA, null);
    expect(operatedTabs(session)).toEqual([9, 12]);
  });

  it("marks only the tabs agents operate, with their names, and drops a tab once its agent goes idle past the window", async () => {
    const session = fakeSession();
    session.tabs = [
      { tabId: 9, windowId: 1, title: "a", url: "https://a.example", active: false },
      { tabId: 12, windowId: 1, title: "b", url: "https://b.example", active: true },
    ];
    beginTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(0);
    endTabCall(session, ADA, 9);
    beginTabCall(session, BOB, 12);
    await vi.advanceTimersByTimeAsync(0);
    endTabCall(session, BOB, 12);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual([
      { tabId: 9, agents: ["Ada"] },
      { tabId: 12, agents: ["Bob"] },
    ]);

    await vi.advanceTimersByTimeAsync(2000);
    beginTabCall(session, BOB, 12);
    endTabCall(session, BOB, 12);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1000);
    expect(sent.at(-1)).toEqual([{ tabId: 12, agents: ["Bob"] }]);

    session.tabs = [];
    reconcileActivityWithTabs(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual([]);
  });

  it("sends nothing to an extension that cannot draw the indicator", async () => {
    const session = fakeSession([]);
    beginTabCall(session, ADA, 9);
    endTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);
  });

  it("sends the latest state after a slow send instead of queueing every change", async () => {
    const session = fakeSession();
    let release = () => {};
    setLocalBrowserIndicatorSender(
      (_session, tabs) =>
        new Promise<void>((resolve) => {
          sent.push(tabs);
          release = resolve;
        }),
    );
    beginTabCall(session, ADA, 9);
    beginTabCall(session, BOB, 12);
    beginTabCall(session, BOB, 13);
    expect(sent).toEqual([[{ tabId: 9, agents: ["Ada"] }]]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual([
      { tabId: 9, agents: ["Ada"] },
      { tabId: 13, agents: ["Bob"] },
    ]);
    expect(sent).toHaveLength(2);
  });

  it("stops every idle timer when the browser goes away", async () => {
    const session = fakeSession();
    beginTabCall(session, ADA, 9);
    endTabCall(session, ADA, 9);
    await vi.advanceTimersByTimeAsync(0);
    const before = sent.length;
    closeActivity(session);
    await vi.advanceTimersByTimeAsync(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 2);
    expect(operatedTabs(session)).toEqual([]);
    expect(sent).toHaveLength(before);
  });
});
