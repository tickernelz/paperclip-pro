// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LOCAL_BROWSER_LIMIT_DEFAULTS,
  type LocalBrowserSession,
  type ToolConnection,
} from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessions, settings, saveSettings, startPairing, pairingStatus, disconnect, openPermissions } = vi.hoisted(() => ({
  sessions: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  startPairing: vi.fn(),
  pairingStatus: vi.fn(),
  disconnect: vi.fn(),
  openPermissions: vi.fn(),
}));

vi.mock("@/api/local-browser", () => ({
  localBrowserApi: { sessions, settings, saveSettings, startPairing, pairingStatus, disconnect, openPermissions },
}));

const { LocalBrowserSettingsPanel } = await import("./LocalBrowserSettingsPanel");
const { ApiError } = await import("@/api/client");

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
  openPermissions.mockResolvedValue({ ok: true });
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

function labelled(label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}

function field(label: string): HTMLInputElement {
  const target = Array.from(container.querySelectorAll("label")).find(
    (entry) => entry.textContent?.trim() === label,
  );
  const found = target ? document.getElementById(target.htmlFor) : null;
  if (!found) throw new Error(`Missing field: ${label}`);
  return found as HTMLInputElement;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function permissionsBlock(): HTMLElement {
  const found = container.querySelector('[role="group"][aria-label="Permissions"]');
  if (!found) throw new Error("Missing permissions block");
  return found as HTMLElement;
}

function liveSession(overrides: Partial<LocalBrowserSession> = {}): LocalBrowserSession {
  return {
    sessionId: SESSION_ID,
    connectionId: "44444444-4444-4444-8444-444444444444",
    client: "chromium",
    clientVersion: "0.2.0",
    label: "Work laptop",
    profileName: null,
    ownerUserId: "user-alice",
    tier: "refine",
    connectedAt: "2026-10-21T00:00:00.000Z",
    lastSeenAt: "2026-10-21T00:00:05.000Z",
    tabs: [],
    controlledByViewer: false,
    capabilities: ["permissions.v1", "cookies.v2"],
    access: {
      siteAccess: "limited",
      granted: ["tabs", "scripting"],
      missing: ["cookies", "debugger"],
      pending: [
        {
          permission: "cookies",
          reason: "Read the sign-in cookie",
          tool: "local_browser_storage",
          at: Date.now() - 120_000,
        },
      ],
    },
    ...overrides,
  };
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

  it("saves the selected tier with the origin allowlist and limits", async () => {
    await render();
    expect(button("Save settings").disabled).toBe(true);
    await act(async () => button("Full power").click());
    settings.mockResolvedValue({
      tier: "full",
      allowedOrigins: ["https://app.example.com"],
      limits: LOCAL_BROWSER_LIMIT_DEFAULTS,
    });
    await act(async () => button("Save settings").click());
    expect(saveSettings).toHaveBeenCalledWith(COMPANY_ID, {
      tier: "full",
      allowedOrigins: ["https://app.example.com"],
      limits: LOCAL_BROWSER_LIMIT_DEFAULTS,
    });
    await flush();
    expect(container.textContent).toContain("Settings saved.");
  });

  it("shows granted, missing and pending permissions for a live session", async () => {
    sessions.mockResolvedValue({ sessions: [liveSession()] });
    await render();
    const block = permissionsBlock();
    const text = block.textContent ?? "";
    expect(text).toContain("Only some websites");
    const granted = block.querySelector('[aria-label="Granted permissions"]')?.textContent ?? "";
    expect(granted).toContain("Tabs");
    expect(granted).toContain("Page scripting");
    expect(granted).not.toContain("Cookies");
    const missing = block.querySelector('[aria-label="Missing permissions"]')?.textContent ?? "";
    expect(missing).toContain("Cookies");
    expect(missing).toContain("Debugger · required");
    expect(missing).not.toContain("Cookies · required");
    const attention = block.querySelector('[data-state="attention"]');
    expect(attention?.textContent).toContain("2 permissions are missing, 1 required.");
    expect(attention?.textContent).toContain("Open the extension and press Allow all.");
    const pending = block.querySelector('[aria-label="Pending permission requests"]')?.textContent ?? "";
    expect(pending).toContain("Cookies");
    expect(pending).toContain("Read the sign-in cookie");
    expect(pending).toContain("local_browser_storage");
    expect(pending).toContain("2m ago");
    const chips = container.querySelector('[aria-label="Extension capabilities"]')?.textContent ?? "";
    expect(chips).toContain("permissions.v1");
    expect(chips).toContain("cookies.v2");
    expect(container.textContent).toContain("chromium 0.2.0");
  });

  it("drops the amber state once every permission is granted", async () => {
    sessions.mockResolvedValue({
      sessions: [
        liveSession({
          access: { siteAccess: "all", granted: ["tabs", "cookies"], missing: [], pending: [] },
        }),
      ],
    });
    await render();
    const block = permissionsBlock();
    expect(block.textContent).toContain("Every website");
    expect(block.querySelector('[data-state="attention"]')).toBeNull();
    expect(block.querySelector('[aria-label="Missing permissions"]')).toBeNull();
  });

  it("opens the permission page in the paired browser", async () => {
    sessions.mockResolvedValue({ sessions: [liveSession()] });
    await render();
    await act(async () => button("Open permission page in browser").click());
    await flush();
    expect(openPermissions).toHaveBeenCalledWith(COMPANY_ID, SESSION_ID);
    expect(permissionsBlock().textContent).toContain("The permission page is open in Work laptop.");
  });

  it("tells the user to update an extension that cannot open the permission page", async () => {
    sessions.mockResolvedValue({ sessions: [liveSession()] });
    openPermissions.mockRejectedValue(
      new ApiError("[local_browser_unsupported] This browser extension cannot open its permission page yet", 400, {
        error: "[local_browser_unsupported] This browser extension cannot open its permission page yet",
        code: "local_browser_unsupported",
      }),
    );
    await render();
    await act(async () => button("Open permission page in browser").click());
    await flush();
    const alert = permissionsBlock().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Update the extension, then pair it again.");
  });

  it("surfaces other open-permission failures with the server message", async () => {
    sessions.mockResolvedValue({ sessions: [liveSession()] });
    openPermissions.mockRejectedValue(
      new ApiError("[local_browser_extension_unavailable] Browser session is not connected", 409, {
        code: "local_browser_extension_unavailable",
      }),
    );
    await render();
    await act(async () => button("Open permission page in browser").click());
    await flush();
    const alert = permissionsBlock().querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Could not open the permission page. Browser session is not connected");
  });

  it("asks an old extension to update before permissions show here", async () => {
    sessions.mockResolvedValue({
      sessions: [liveSession({ capabilities: [], access: undefined })],
    });
    await render();
    const block = permissionsBlock();
    expect(block.textContent).toContain("Update the extension to manage permissions here.");
    expect(block.querySelector('[data-state="attention"]')).toBeNull();
    expect(container.querySelector('[aria-label="Extension capabilities"]')).toBeNull();
  });

  it("shows limits in display units with their default and range", async () => {
    settings.mockResolvedValue({
      tier: "refine",
      allowedOrigins: [],
      limits: { ...LOCAL_BROWSER_LIMIT_DEFAULTS, screenshotMaxBytes: 4_194_304, callMaxMs: 90_000 },
    });
    await render();
    expect(field("Screenshot size").value).toBe("4");
    expect(field("Call time limit").value).toBe("90");
    expect(field("Snapshot size").value).toBe("400");
    const text = container.textContent ?? "";
    expect(text).toContain("Default 2 MiB, allowed 0.0625 to 50.");
    expect(text).toContain("Default 120 seconds, allowed 5 to 600.");
    expect(text).toContain("Default 60,000 chars, allowed 1,000 to 2,000,000.");

    await act(async () => labelled("Reset Screenshot size to default").click());
    expect(field("Screenshot size").value).toBe("2");
    expect(labelled("Reset Screenshot size to default").disabled).toBe(true);
  });

  it("blocks out-of-range limits and saves converted units", async () => {
    settings.mockResolvedValue({
      tier: "refine",
      allowedOrigins: ["https://app.example.com"],
      limits: LOCAL_BROWSER_LIMIT_DEFAULTS,
    });
    await render();

    await typeInto(field("Screenshot size"), "60");
    await typeInto(field("Call time limit"), "1");
    await typeInto(field("Network log entries"), "lots");
    const text = container.textContent ?? "";
    expect(text).toContain("Use 0.0625 to 50 MiB.");
    expect(text).toContain("Use 5 to 600 seconds.");
    expect(text).toContain("Enter a number of entries.");
    expect(text).toContain("Fix the highlighted limits before saving.");
    expect(field("Screenshot size").getAttribute("aria-invalid")).toBe("true");
    expect(button("Save settings").disabled).toBe(true);
    await act(async () => button("Save settings").click());
    expect(saveSettings).not.toHaveBeenCalled();

    await typeInto(field("Screenshot size"), "8");
    await typeInto(field("Call time limit"), "30");
    await typeInto(field("Network log entries"), "500");
    await typeInto(field("Upload and download size"), "100");
    expect(button("Save settings").disabled).toBe(false);
    await act(async () => button("Save settings").click());
    expect(saveSettings).toHaveBeenCalledWith(COMPANY_ID, {
      tier: "refine",
      allowedOrigins: ["https://app.example.com"],
      limits: {
        ...LOCAL_BROWSER_LIMIT_DEFAULTS,
        screenshotMaxBytes: 8_388_608,
        transferMaxBytes: 104_857_600,
        callMaxMs: 30_000,
        networkMaxEntries: 500,
      },
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
    expect(button("Save settings").disabled).toBe(true);
    expect(container.querySelector("h2")?.textContent).toBe("Local Browser");
  });
});
