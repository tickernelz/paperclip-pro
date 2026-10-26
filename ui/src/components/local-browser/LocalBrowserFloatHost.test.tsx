// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LiveEvent } from "@tickernelz/paperclip-pro-shared";
import { LocalBrowserFloatHost } from "./LocalBrowserFloatHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

const liveHandlers = vi.hoisted(() => ({ current: null as ((event: LiveEvent) => void) | null }));
const sessionsMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", () => ({
  authApi: { getSession: authMock },
}));

vi.mock("@/context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (handler: (event: LiveEvent) => void) => {
    liveHandlers.current = handler;
  },
}));

vi.mock("@/api/local-browser", () => ({
  localBrowserApi: { sessions: sessionsMock },
}));

vi.mock("./LocalBrowserViewer", () => ({
  LocalBrowserViewer: (props: { sessionId: string; tabId?: number }) => (
    <div data-testid="viewer" data-session={props.sessionId} data-tab={props.tabId} />
  ),
}));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    tabs: [{ tabId: 41, title: "Invoices", url: "https://app.example.test/invoices", active: false }],
    agentActivity: null,
    ...overrides,
  };
}

function activity(state: "operating" | "idle" | "closed", tabId: number | null) {
  const event = {
    id: 1,
    companyId: COMPANY_ID,
    type: "local_browser.activity",
    createdAt: new Date().toISOString(),
    payload: { sessionId: SESSION_ID, state, tabId, at: new Date().toISOString() },
  } as unknown as LiveEvent;
  return act(async () => {
    liveHandlers.current?.(event);
  });
}

async function mountHost() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <LocalBrowserFloatHost companyId={COMPANY_ID} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function panel() {
  return container.querySelector('[data-testid="local-browser-float-panel"]');
}

function childFrame(): Window {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const child = frame.contentWindow as Window;
  child.document.open();
  child.document.write("<!doctype html><html><head></head><body></body></html>");
  child.document.close();
  return child;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sessionsMock.mockReset();
  sessionsMock.mockResolvedValue({ sessions: [session()] });
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: "user-1" }, session: { userId: "user-1" } });
  liveHandlers.current = null;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
});

it("shows nothing until the agent operates a tab", async () => {
  await mountHost();
  expect(panel()).toBeNull();
});

it("opens a panel on the operated tab and closes it when the tab closes", async () => {
  await mountHost();
  await activity("operating", 41);
  const viewer = container.querySelector('[data-testid="viewer"]');
  expect(panel()).not.toBeNull();
  expect(viewer?.getAttribute("data-tab")).toBe("41");
  expect(viewer?.getAttribute("data-session")).toBe(SESSION_ID);
  await activity("closed", 41);
  expect(panel()).toBeNull();
});

it("follows the agent to another tab", async () => {
  await mountHost();
  await activity("operating", 41);
  await activity("operating", 52);
  expect(container.querySelector('[data-testid="viewer"]')?.getAttribute("data-tab")).toBe("52");
});

it("adopts a session that is already operating when the page loads", async () => {
  sessionsMock.mockResolvedValue({ sessions: [session({ agentActivity: { state: "operating", tabId: 41, at: "now" } })] });
  await mountHost();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(panel()).not.toBeNull();
  expect(container.textContent).toContain("Invoices");
});

it("keeps the panel through idle gaps between calls and closes only when the tab closes", async () => {
  await mountHost();
  await activity("operating", 41);
  await activity("idle", 41);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(panel()).not.toBeNull();
  await activity("operating", 41);
  await activity("idle", 41);
  expect(panel()).not.toBeNull();
  await activity("closed", 41);
  expect(panel()).toBeNull();
});

it("stays dismissed through idle and further calls on the same tab until the tab closes or changes", async () => {
  await mountHost();
  await activity("operating", 41);
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Close agent browser"]')?.click();
  });
  expect(panel()).toBeNull();
  await activity("idle", 41);
  expect(panel()).toBeNull();
  await activity("operating", 41);
  expect(panel()).toBeNull();
  await activity("idle", 41);
  expect(panel()).toBeNull();
  await activity("operating", 52);
  expect(panel()).not.toBeNull();
  await activity("closed", 52);
  await activity("operating", 41);
  expect(panel()).not.toBeNull();
});

it("shows a tab to its owner only", async () => {
  sessionsMock.mockResolvedValue({ sessions: [session({ ownerUserId: "someone-else" })] });
  await mountHost();
  await activity("operating", 41);
  expect(panel()).toBeNull();
  sessionsMock.mockResolvedValue({ sessions: [session({ ownerUserId: "user-1" })] });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["local-browser-sessions", COMPANY_ID] });
  });
  await activity("operating", 41);
  expect(panel()).not.toBeNull();
});

it("withholds the viewer stream while the page is hidden and resumes when it shows", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await mountHost();
  await activity("operating", 41);
  expect(panel()).not.toBeNull();
  expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
  visibility.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
});

it("updates the sessions cache from the event instead of refetching for each call", async () => {
  await mountHost();
  const before = sessionsMock.mock.calls.length;
  await activity("operating", 41);
  await activity("idle", 41);
  await activity("operating", 41);
  expect(sessionsMock.mock.calls.length).toBe(before);
  const cached = client.getQueryData<{ sessions: Array<{ agentActivity: { state: string } | null }> }>([
    "local-browser-sessions",
    COMPANY_ID,
  ]);
  expect(cached?.sessions[0]?.agentActivity?.state).toBe("operating");
});

it("pops out into a Document Picture-in-Picture window and moves the viewer there", async () => {
  const child = childFrame();
  const requestWindow = vi.fn().mockResolvedValue(child);
  (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow };
  await mountHost();
  await activity("operating", 41);
  await act(async () => {
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Pop out")?.click();
  });
  expect(requestWindow).toHaveBeenCalledTimes(1);
  expect(panel()).toBeNull();
  const moved = child.document.querySelector('[data-testid="viewer"]');
  expect(moved?.getAttribute("data-tab")).toBe("41");
  expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
});

it("falls back to a popup window when Picture-in-Picture is unavailable", async () => {
  const child = childFrame();
  const open = vi.spyOn(window, "open").mockReturnValue(child);
  await mountHost();
  await activity("operating", 41);
  await act(async () => {
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Pop out")?.click();
  });
  expect(open).toHaveBeenCalledWith("", "paperclip-local-browser", expect.stringContaining("popup"));
  expect(child.document.querySelector('[data-testid="viewer"]')).not.toBeNull();
});

it("keeps the in-page panel when the browser blocks the popup", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  await mountHost();
  await activity("operating", 41);
  await act(async () => {
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Pop out")?.click();
  });
  expect(panel()).not.toBeNull();
});

it("closes the floating window when the agent closes the tab", async () => {
  const child = childFrame();
  vi.spyOn(window, "open").mockReturnValue(child);
  const closeSpy = vi.spyOn(child, "close");
  await mountHost();
  await activity("operating", 41);
  await act(async () => {
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Pop out")?.click();
  });
  await activity("closed", 41);
  expect(closeSpy).toHaveBeenCalled();
  expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
  expect(panel()).toBeNull();
});
