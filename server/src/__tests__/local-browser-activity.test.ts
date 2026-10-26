import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTabCall,
  closeActivity,
  endTabCall,
  LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS,
  touchActivity,
} from "../services/local-browser/activity.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import type { LiveSession } from "../services/local-browser/types.js";

const COMPANY_ID = "33333333-3333-4333-8333-333333333333";

function fakeSession(): LiveSession {
  return {
    companyId: COMPANY_ID,
    sessionId: "44444444-4444-4444-8444-444444444444",
    activity: null,
    operatingCalls: 0,
  } as unknown as LiveSession;
}

describe("local browser activity idle close", () => {
  const states: string[] = [];
  let unsubscribe = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    states.length = 0;
    unsubscribe = subscribeCompanyLiveEvents(COMPANY_ID, (event) => {
      if (event.type === "local_browser.activity") states.push((event.payload as { state: string }).state);
    });
  });

  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
  });

  it("closes only after the agent stays idle past the window, not between sequential calls", () => {
    const session = fakeSession();
    beginTabCall(session, 9);
    endTabCall(session, 9);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1);
    expect(session.activity).toMatchObject({ state: "idle", tabId: 9 });

    beginTabCall(session, 9);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 3);
    expect(session.activity).toMatchObject({ state: "operating", tabId: 9 });

    endTabCall(session, 9);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS);
    expect(session.activity).toBeNull();
    expect(states).toEqual(["operating", "idle", "operating", "idle", "closed"]);
  });

  it("postpones the idle close while the user takes over, and never starts one without activity", () => {
    const session = fakeSession();
    touchActivity(session);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 2);
    expect(states).toEqual([]);

    beginTabCall(session, 9);
    endTabCall(session, 9);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1000);
    touchActivity(session);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS - 1000);
    expect(session.activity).toMatchObject({ state: "idle", tabId: 9 });
    vi.advanceTimersByTime(1000);
    expect(session.activity).toBeNull();
  });

  it("keeps the timer off while another call is still running", () => {
    const session = fakeSession();
    beginTabCall(session, 9);
    beginTabCall(session, 9);
    endTabCall(session, 9);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 2);
    expect(session.activity).toMatchObject({ state: "operating", tabId: 9 });
  });

  it("does not publish a second closed event when the tab already closed the activity", () => {
    const session = fakeSession();
    beginTabCall(session, 9);
    endTabCall(session, 9);
    closeActivity(session);
    vi.advanceTimersByTime(LOCAL_BROWSER_ACTIVITY_IDLE_CLOSE_MS * 2);
    expect(states.filter((state) => state === "closed")).toHaveLength(1);
  });
});
