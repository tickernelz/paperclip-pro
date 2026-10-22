// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ToolConnection } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessions, settings, saveSettings, startPairing, pairingStatus, disconnect } = vi.hoisted(() => ({
  sessions: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  startPairing: vi.fn(),
  pairingStatus: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/api/local-browser", () => ({
  localBrowserApi: { sessions, settings, saveSettings, startPairing, pairingStatus, disconnect },
}));

const { LocalBrowserSettingsPanel } = await import("./LocalBrowserSettingsPanel");

const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const connection = { id: "connection", companyId: COMPANY_ID, config: { sourceTemplateKey: "local-browser" } } as unknown as ToolConnection;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  sessions.mockResolvedValue({ sessions: [] });
  settings.mockResolvedValue({ tier: "refine", allowedOrigins: ["https://app.example.com"] });
  saveSettings.mockImplementation(async (_companyId: string, next: { tier: string; allowedOrigins: string[] }) => next);
  startPairing.mockResolvedValue({
    code: "ABCD2345",
    expiresAt: "2026-10-21T12:10:00.000Z",
    connectUrls: ["https://example.test/pair?code=ABCD2345"],
  });
  pairingStatus.mockResolvedValue({ status: "pending" });
  disconnect.mockResolvedValue({ ok: true });
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <LocalBrowserSettingsPanel connection={connection} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return client;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((entry) =>
    entry.textContent?.trim().startsWith(label),
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}

describe("Local Browser settings panel", () => {
  it("shows the pairing code and connect links a browser needs", async () => {
    await render();
    expect(container.textContent).toContain("No browser is paired yet");
    await act(async () => button("Pair a browser").click());
    expect(startPairing).toHaveBeenCalledWith(COMPANY_ID, {});
    expect(container.textContent).toContain("ABCD2345");
    expect(container.textContent).toContain("https://example.test/pair?code=ABCD2345");
  });

  it("copies the pairing link and marks the page for the extension", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void written.push(value) },
    });
    await render();
    await act(async () => button("Pair a browser").click());

    const marker = container.querySelector("[data-paperclip-local-browser-pairing]");
    expect(marker).toBeTruthy();
    expect(marker?.getAttribute("data-code")).toBe("ABCD2345");
    expect(marker?.getAttribute("data-origin")).toBe("https://example.test");

    await act(async () => button("Copy pairing link").click());
    expect(written).toEqual(["https://example.test/pair?code=ABCD2345"]);
    expect(container.textContent).toContain("Link copied");
  });

  it("drops the pairing marker once the pairing is cancelled", async () => {
    await render();
    await act(async () => button("Pair a browser").click());
    expect(container.querySelector("[data-paperclip-local-browser-pairing]")).toBeTruthy();
    await act(async () => button("Cancel").click());
    expect(container.querySelector("[data-paperclip-local-browser-pairing]")).toBeNull();
  });

  it("offers both extension downloads with the install steps", async () => {
    await render();
    expect(container.textContent).toContain("Install the extension");

    const chromium = container.querySelector('a[href="/downloads/local-browser-chromium.zip"]');
    const firefox = container.querySelector('a[href="/downloads/local-browser-firefox.xpi"]');
    expect(chromium?.textContent).toContain("Chrome, Edge or Brave");
    expect(firefox?.textContent).toContain("Install in Firefox");
    expect(chromium?.hasAttribute("download")).toBe(true);
    expect(firefox?.hasAttribute("download")).toBe(false);

    const text = container.textContent ?? "";
    expect(text).toContain("chrome://extensions");
    expect(text).toContain("Developer mode");
    expect(text).toContain("Load unpacked");
    expect(text).toContain("about:addons");
    expect(text).toContain("Install Add-on From File");
  });

  it("warns that full tier reaches any signed-in site", async () => {
    await render();
    expect(container.textContent).not.toContain("Full power lets an agent read and change anything");
    await act(async () => button("Full power").click());
    expect(container.textContent).toContain("Full power lets an agent read and change anything");
    expect(container.textContent).toContain("origin allowlist no longer applies");
  });

  it("saves the selected tier with the origin allowlist", async () => {
    await render();
    expect(button("Save access level").disabled).toBe(true);
    await act(async () => button("Full power").click());
    await act(async () => button("Save access level").click());
    expect(saveSettings).toHaveBeenCalledWith(COMPANY_ID, {
      tier: "full",
      allowedOrigins: ["https://app.example.com"],
    });
  });

  it("lists a live session and can disconnect it", async () => {
    sessions.mockResolvedValue({
      sessions: [{
        sessionId: SESSION_ID,
        connectionId: "44444444-4444-4444-8444-444444444444",
        client: "chromium",
        clientVersion: "0.1.0",
        label: "Work laptop",
        profileName: null,
        ownerUserId: "user-alice",
        tier: "refine",
        connectedAt: "2026-10-21T00:00:00.000Z",
        lastSeenAt: "2026-10-21T00:00:05.000Z",
        tabs: [],
        controlledByViewer: false,
      }],
    });
    await render();
    expect(container.textContent).toContain("Work laptop");
    expect(container.textContent).toContain("chromium 0.1.0");
    expect(container.textContent).toContain("owner user-alice");
    await act(async () => button("Disconnect").click());
    expect(disconnect).toHaveBeenCalledWith(COMPANY_ID, SESSION_ID);
  });

  it("keeps the live viewer reachable from a session row", async () => {
    sessions.mockResolvedValue({
      sessions: [{
        sessionId: SESSION_ID,
        connectionId: "44444444-4444-4444-8444-444444444444",
        client: "chromium",
        clientVersion: "0.1.0",
        label: "Work laptop",
        profileName: null,
        ownerUserId: "user-alice",
        tier: "refine",
        connectedAt: "2026-10-21T00:00:00.000Z",
        lastSeenAt: "2026-10-21T00:00:05.000Z",
        tabs: [],
        controlledByViewer: false,
      }],
    });
    await render();
    await act(async () => button("Watch").click());
    expect(button("Hide browser")).toBeDefined();
  });

  it("keeps a running viewer mounted when a sessions refetch fails", async () => {
    sessions.mockResolvedValue({
      sessions: [{
        sessionId: SESSION_ID,
        connectionId: "44444444-4444-4444-8444-444444444444",
        client: "chromium",
        clientVersion: "0.1.0",
        label: "Work laptop",
        profileName: null,
        ownerUserId: "user-alice",
        tier: "refine",
        connectedAt: "2026-10-21T00:00:00.000Z",
        lastSeenAt: "2026-10-21T00:00:05.000Z",
        tabs: [],
        controlledByViewer: false,
      }],
    });
    const client = await render();
    await act(async () => button("Watch").click());
    const source = MockEventSource.instances.at(-1);
    expect(source).toBeDefined();
    expect(container.querySelector('[data-testid="local-browser-surface"]')).not.toBeNull();

    sessions.mockRejectedValue(new Error("blip"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["local-browser-sessions", COMPANY_ID] });
    });
    await flush();

    expect(sessions).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="local-browser-surface"]')).not.toBeNull();
    expect(source?.closed).toBe(false);
    expect(container.textContent).toContain("Could not refresh the session list");
    expect(container.textContent).toContain("Work laptop");
  });

  it("stays usable when the Local Browser service is unavailable", async () => {
    sessions.mockRejectedValue(new Error("offline"));
    settings.mockRejectedValue(new Error("offline"));
    await render();
    expect(container.textContent).toContain("did not answer");
    expect(button("Save access level").disabled).toBe(true);
    expect(container.querySelector("h2")?.textContent).toBe("Local Browser");
  });
});
