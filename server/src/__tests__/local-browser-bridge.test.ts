import { constants as bufferConstants } from "node:buffer";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import express from "express";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, localBrowserConnections, localBrowserSettings } from "@tickernelz/paperclip-pro-db";
import {
  LOCAL_BROWSER_CAPABILITIES,
  LOCAL_BROWSER_CURSOR_PATTERN,
  LOCAL_BROWSER_LIMIT_DEFAULTS,
  LOCAL_BROWSER_LIMIT_KEYS,
  LOCAL_BROWSER_LIMITS,
  type LocalBrowserBridgeFrame,
} from "@tickernelz/paperclip-pro-shared";
import { errorHandler } from "../middleware/index.js";
import {
  LOCAL_BROWSER_BRIDGE_MAX_PAYLOAD_BYTES,
  localBrowserWebSocketInternals,
  setupLocalBrowserWebSocketServer,
  type LocalBrowserWebSocketServer,
} from "../realtime/local-browser-ws.js";
import {
  LOCAL_BROWSER_JSON_BODY_LIMIT,
  localBrowserBodyErrorHandler,
  localBrowserBodyLimit,
  localBrowserRoutes,
} from "../routes/local-browser.js";
import { resetPairings } from "../services/local-browser/pairing.js";
import { resetSessions } from "../services/local-browser/registry.js";
import { localBrowserService, normalizeLocalBrowserLimits } from "../services/local-browser/service.js";
import { seedCompanyWithBoardAccess, useEmbeddedPostgres } from "./helpers/route-test-harness.js";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws") as { WebSocket: new (url: string) => FakeExtensionSocket };

interface FakeExtensionSocket {
  readyState: number;
  on(event: "open" | "close" | "error", listener: (...args: unknown[]) => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN_STATE = 1;
const CALL_TIMEOUT_MS = 150;
const APP_ORIGIN = "https://app.example.com";

const postgres = useEmbeddedPostgres("local-browser-bridge");
const CEO_AGENT_ID = "00000000-0000-4000-8000-00000000ceo1";

function ceoAgentHeaders(): Record<string, string> {
  return { "x-test-actor": "ceo-agent" };
}

interface CallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  budgetMs?: number;
}

type CallAnswer = { ok: boolean; result?: unknown; error?: Record<string, unknown> } | "ignore";

interface Harness {
  baseUrl: string;
  wsUrl: string;
  service: ReturnType<typeof localBrowserService>;
  companyId: string;
  userId: string;
}

let server: Server | null = null;
let bridge: LocalBrowserWebSocketServer | null = null;
let harness: Harness | null = null;

async function startHarness(): Promise<Harness> {
  const seeded = await seedCompanyWithBoardAccess(postgres.db, "local-browser");
  const app = express();
  app.use("/api/local-browser", localBrowserBodyLimit(), express.json({ limit: LOCAL_BROWSER_JSON_BODY_LIMIT }), localBrowserBodyErrorHandler());
  app.use(express.json());
  app.use((req, _res, next) => {
    const asAgent = req.headers["x-test-actor"] === "ceo-agent";
    (req as unknown as { actor: unknown }).actor = asAgent
      ? {
          type: "agent",
          agentId: CEO_AGENT_ID,
          agentRole: "ceo",
          agentStatus: "active",
          companyId: seeded.companyId,
          keyScope: { kind: "standard" },
        }
      : seeded.actor;
    next();
  });
  const service = localBrowserService(postgres.db, { callTimeoutMs: CALL_TIMEOUT_MS });
  app.use("/api", localBrowserRoutes(postgres.db, service));
  app.use(errorHandler);
  const created = createServer(app);
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  bridge = setupLocalBrowserWebSocketServer(created, postgres.db, {
    service,
    pingIntervalMs: 60_000,
    silenceLimitMs: 600_000,
  });
  const address = created.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a port");
  server = created;
  harness = {
    baseUrl: "http://127.0.0.1:" + address.port,
    wsUrl: "ws://127.0.0.1:" + address.port,
    service,
    companyId: seeded.companyId,
    userId: seeded.userId,
  };
  return harness;
}

function currentHarness(): Harness {
  if (!harness) throw new Error("harness is not started");
  return harness;
}

function bridgeUrl(path: string): string {
  const active = currentHarness();
  return active.baseUrl + path + (path.includes("?") ? "&" : "?") + "companyId=" + active.companyId;
}

interface Paired {
  socket: FakeExtensionSocket;
  sessionId: string;
  sessionToken: string;
  calls: CallRecord[];
  waitForCall(tool: string): Promise<CallRecord>;
  emit(event: string, data: unknown): void;
  close(): void;
}

async function startPairing(): Promise<{ code: string; connectUrls: string[] }> {
  const response = await fetch(bridgeUrl("/api/local-browser/pairing"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Test browser" }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { code: string; connectUrls: string[] };
}

async function pairExtension(
  options: {
    code?: string;
    tabUrl?: string;
    capabilities?: string[];
    hello?: Record<string, unknown>;
    onCall?: (call: CallRecord) => CallAnswer;
  } = {},
): Promise<Paired> {
  const active = currentHarness();
  const code = options.code ?? (await startPairing()).code;
  const socket = new WebSocket(active.wsUrl + "/api/local-browser/bridge?code=" + code);
  const calls: CallRecord[] = [];
  const callWaiters: Array<{ tool: string; resolve: (call: CallRecord) => void }> = [];
  let ackResolve: ((frame: Extract<LocalBrowserBridgeFrame, { type: "hello_ack" }>) => void) | null = null;

  socket.on("message", (data: unknown) => {
    const frame = JSON.parse(String(data)) as LocalBrowserBridgeFrame;
    if (frame.type === "hello_ack") {
      ackResolve?.(frame);
      return;
    }
    if (frame.type !== "call") return;
    const call: CallRecord = {
      id: frame.id,
      tool: frame.tool,
      args: (frame.args ?? {}) as Record<string, unknown>,
      ...(frame.budgetMs === undefined ? {} : { budgetMs: frame.budgetMs }),
    };
    calls.push(call);
    const waiter = callWaiters.find((entry) => entry.tool === call.tool);
    if (waiter) {
      callWaiters.splice(callWaiters.indexOf(waiter), 1);
      waiter.resolve(call);
    }
    const answer = options.onCall?.(call) ?? { ok: true, result: { ok: true } };
    if (answer === "ignore") return;
    socket.send(
      JSON.stringify({ type: "result", id: frame.id, ok: answer.ok, result: answer.result, error: answer.error }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", (error) => reject(error as Error));
  });

  const ackPromise = new Promise<Extract<LocalBrowserBridgeFrame, { type: "hello_ack" }>>((resolve, reject) => {
    ackResolve = resolve;
    setTimeout(() => reject(new Error("timed out waiting for hello_ack")), 5_000);
  });
  socket.send(
    JSON.stringify({
      type: "hello",
      protocol: 1,
      client: "chromium",
      clientVersion: "1.0.0",
      capabilities: options.capabilities,
      label: "Test browser",
      profileName: "Default",
      tabs: [
        {
          tabId: 7,
          windowId: 1,
          title: "Example",
          url: options.tabUrl ?? APP_ORIGIN + "/dashboard",
          active: true,
        },
      ],
      ...options.hello,
    }),
  );
  const ack = await ackPromise;

  return {
    socket,
    sessionId: ack.sessionId,
    sessionToken: ack.sessionToken,
    calls,
    waitForCall(tool: string) {
      const seen = calls.find((call) => call.tool === tool);
      if (seen) return Promise.resolve(seen);
      return new Promise<CallRecord>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for call " + tool)), 5_000);
        callWaiters.push({
          tool,
          resolve: (call) => {
            clearTimeout(timer);
            resolve(call);
          },
        });
      });
    },
    emit(event: string, data: unknown) {
      socket.send(JSON.stringify({ type: "event", event, data }));
    },
    close() {
      socket.close();
    },
  };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for " + label);
}

function binding() {
  return { companyId: currentHarness().companyId, agentId: null, userId: "user-local-browser", runId: null, issueId: null };
}

it("refuses the jar-wide cookie scopes when the extension does not advertise them", async () => {
  const active = currentHarness();
  const oldBuild = await pairExtension();
  await setTier("full");
  await expectFailure(active.service.executeTool(binding(), "local_browser_storage", { kind: "cookies", op: "get", domain: "example.com" }), "local_browser_unsupported");
  await expectFailure(active.service.executeTool(binding(), "local_browser_storage", { kind: "cookies", op: "get", allDomains: true }), "local_browser_unsupported");
  await expectFailure(
    active.service.executeTool(binding(), "local_browser_storage", { kind: "cookies", op: "set", url: "https://a.test/", entries: [{ name: "a", value: "b", httpOnly: true }] }),
    "local_browser_unsupported",
  );
  await expectFailure(active.service.executeTool(binding(), "local_browser_storage", { kind: "cookies", op: "get", storeId: "3" }), "local_browser_unsupported");
  await expectFailure(active.service.executeTool(binding(), "local_browser_storage", { kind: "cookies", op: "get", limit: 5 }), "local_browser_unsupported");
  expect(oldBuild.calls).toHaveLength(0);
});

it("lets a capability-advertising extension use the jar-wide cookie scopes", async () => {
  const active = currentHarness();
  const modern = await pairExtension({ capabilities: ["cookies.v2"], onCall: () => ({ ok: true, result: { kind: "cookies", op: "get", cookies: [] } }) });
  await setTier("full");
  await active.service.executeTool(binding(), "local_browser_storage", { kind: "cookies", op: "get", domain: "example.com" });
  const call = modern.calls.find((entry) => entry.tool === "local_browser_storage");
  expect(call?.args).toMatchObject({ kind: "cookies", op: "get", domain: "example.com" });
});

async function expectFailure(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

async function allowOrigin(origin = APP_ORIGIN) {
  const response = await fetch(bridgeUrl("/api/local-browser/settings"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "refine", allowedOrigins: [origin] }),
  });
  expect(response.status).toBe(200);
}

async function setTier(tier: "refine" | "full", allowedOrigins: string[] = [APP_ORIGIN]) {
  const response = await fetch(bridgeUrl("/api/local-browser/settings"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier, allowedOrigins }),
  });
  expect(response.status).toBe(200);
}

async function setLimits(limits: Record<string, number>, tier: "refine" | "full" = "refine") {
  const response = await fetch(bridgeUrl("/api/local-browser/settings"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier, allowedOrigins: [APP_ORIGIN], limits }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { limits: Record<string, number> };
}

beforeAll(async () => {
  await startHarness();
}, 90_000);

afterAll(async () => {
  resetSessions();
  resetPairings();
  if (bridge) bridge.closeAllSessions();
  if (server) {
    const closing = server;
    server = null;
    closing.closeAllConnections?.();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
});

beforeEach(async () => {
  resetSessions();
  resetPairings();
  await postgres.db.delete(activityLog);
  await postgres.db.delete(localBrowserConnections);
  await postgres.db.delete(localBrowserSettings);
});

afterEach(() => {
  resetSessions();
});

describe("local browser pairing", () => {
  it("mints a pairing code and answers hello_ack with a one-time session token", async () => {
    const active = currentHarness();
    const start = await startPairing();
    expect(start.code).toHaveLength(8);
    expect(start.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(start.connectUrls[0]).toContain("ws://");
    expect(start.connectUrls[0]).toContain("code=" + start.code);

    const paired = await pairExtension({ code: start.code });
    expect(paired.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(paired.sessionToken.length).toBeGreaterThanOrEqual(32);

    const sessions = active.service.listSessions(active.companyId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(paired.sessionId);
    expect(sessions[0]?.client).toBe("chromium");
    expect(sessions[0]?.tier).toBe("refine");

    const [row] = await postgres.db
      .select()
      .from(localBrowserConnections)
      .where(eq(localBrowserConnections.id, sessions[0]!.connectionId));
    expect(row?.companyId).toBe(active.companyId);
    expect(row?.tokenHash).not.toBe(paired.sessionToken);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    paired.close();
  });

  it("explains itself when the bridge address is opened in a browser tab", async () => {
    const response = await fetch(bridgeUrl("/api/local-browser/bridge?code=ABCD2345"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("connection endpoint, not a page");
    expect(html).toContain("Paperclip Local Browser extension");
    expect(html).toContain("ABCD2345");
    expect(html).not.toContain("API route not found");
  });

  it("escapes a pairing code it echoes into the help page", async () => {
    const response = await fetch(bridgeUrl("/api/local-browser/bridge?code=" + encodeURIComponent("<script>x</script>")));
    const html = await response.text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reports pending then paired for the same pairing code", async () => {
    const start = await startPairing();
    const pending = await fetch(bridgeUrl("/api/local-browser/pairing/" + start.code));
    expect(await pending.json()).toEqual({ status: "pending" });

    const paired = await pairExtension({ code: start.code });
    const settled = await fetch(bridgeUrl("/api/local-browser/pairing/" + start.code));
    const body = (await settled.json()) as { status: string; sessionId?: string };
    expect(body.status).toBe("paired");
    expect(body.sessionId).toBe(paired.sessionId);

    const unknown = await fetch(bridgeUrl("/api/local-browser/pairing/ZZZZZZZZ"));
    expect(await unknown.json()).toEqual({ status: "expired" });
    paired.close();
  });

  it("rejects an upgrade that carries no pairing code or session token", async () => {
    const active = currentHarness();
    const socket = new WebSocket(active.wsUrl + "/api/local-browser/bridge");
    const outcome = await new Promise<string>((resolve) => {
      socket.on("error", () => resolve("rejected"));
      socket.on("open", () => resolve("opened"));
    });
    expect(outcome).toBe("rejected");
  });
});

describe("local browser tools", () => {
  it("lists paired browsers through local_browser_sessions", async () => {
    const active = currentHarness();
    const paired = await pairExtension();
    const result = (await active.service.executeTool(binding(), "local_browser_sessions", {})) as {
      sessions: Array<{ sessionId: string; tabs: Array<{ tabId: number }> }>;
    };
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe(paired.sessionId);
    expect(result.sessions[0]?.tabs[0]?.tabId).toBe(7);
    paired.close();
  });

  it("renders a snapshot as compact text and continues with a cursor", async () => {
    const active = currentHarness();
    await allowOrigin();
    const nodes = [
      { ref: "e1", role: "button", name: "Sign in", depth: 0 },
      { ref: "e2", role: "textbox", name: "Email", value: "a@b.co", depth: 0 },
      { role: "text", name: "Welcome back", depth: 1 },
      { role: "text", name: "Continue where you left off", depth: 1 },
      { ref: "e3", role: "link", name: "Forgot password", depth: 1 },
      { ref: "e4", role: "checkbox", name: "Remember me", depth: 1, checked: true },
      { ref: "e5", role: "button", name: "Submit", depth: 1, disabled: true },
      { ref: "e6", role: "link", name: "Terms", depth: 2 },
      { ref: "e7", role: "link", name: "Privacy", depth: 2 },
      { ref: "e8", role: "button", name: "Cancel", depth: 2 },
      { ref: "e9", role: "button", name: "Help", depth: 2 },
      { ref: "e10", role: "button", name: "Close", depth: 2 },
    ];
    const paired = await pairExtension({
      onCall: (call) => {
        if (call.tool !== "local_browser_snapshot") return { ok: true, result: { ok: true } };
        const raw = typeof call.args.cursor === "string" ? call.args.cursor.trim() : "";
        const offset = /^\d+$/.test(raw) ? Number(raw) : 0;
        const limit = typeof call.args.maxNodes === "number" ? call.args.maxNodes : 120;
        const slice = nodes.slice(offset, offset + limit);
        const truncated = offset + slice.length < nodes.length;
        return {
          ok: true,
          result: {
            url: APP_ORIGIN + "/login",
            title: "Sign in",
            nodes: slice,
            total: nodes.length,
            truncated,
            offset,
            cursor: truncated ? String(offset + slice.length) : null,
          },
        };
      },
    });

    const first = (await active.service.executeTool(binding(), "local_browser_snapshot", { maxNodes: 10 })) as {
      text: string;
      truncated: boolean;
      cursor?: string;
      total: number;
      nodes: number;
    };
    const firstLines = first.text.split("\n");
    expect(firstLines).toHaveLength(9);
    expect(firstLines.slice(0, 4)).toEqual([
      'e1 button "Sign in"',
      'e2 textbox "Email"=a@b.co',
      '  text "Welcome back Continue where you left off"',
      '  e3 link "Forgot password"',
    ]);
    expect(firstLines[8]).toBe('    e8 button "Cancel"');
    expect(first.truncated).toBe(true);
    expect(first.total).toBe(nodes.length);
    expect(first.cursor).toBe("10");

    const second = (await active.service.executeTool(binding(), "local_browser_snapshot", {
      maxNodes: 10,
      cursor: first.cursor,
    })) as { text: string; truncated: boolean; cursor?: string };
    expect(second.text).toBe('    e9 button "Help"\n    e10 button "Close"');
    expect(second.truncated).toBe(false);
    expect(second.cursor).toBeUndefined();
    paired.close();
  });

  it("passes the snapshot ref through local_browser_act unchanged", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_act" ? { ok: true, result: { clicked: true } } : { ok: true, result: {} },
    });
    const result = await active.service.executeTool(binding(), "local_browser_act", {
      action: "click",
      ref: "e12",
      tabId: 7,
    });
    expect(result).toMatchObject({ clicked: true });
    const call = await paired.waitForCall("local_browser_act");
    expect(call.args.ref).toBe("e12");
    expect(call.args.action).toBe("click");
    expect(call.args.tabId).toBe(7);
    paired.close();
  });

  it("refreshes the session tab list from a frozen tabs event", async () => {
    const active = currentHarness();
    const paired = await pairExtension();

    paired.emit("tabs", {
      tabs: [
        { tabId: 7, windowId: 1, title: "Example", url: APP_ORIGIN + "/dashboard", active: false },
        { tabId: 9, windowId: 1, title: "Docs", url: "https://docs.example.com/guide", active: true },
      ],
    });
    await waitFor(
      () => active.service.listSessions(active.companyId)[0]?.tabs.some((tab) => tab.tabId === 9) === true,
      "tab list refresh",
    );
    const sessions = active.service.listSessions(active.companyId);
    expect(sessions[0]?.tabs.map((tab) => tab.tabId)).toEqual([7, 9]);
    expect(sessions[0]?.tabs[1]?.active).toBe(true);

    paired.emit("tabs", [{ tabId: 11, title: "Legacy shape", url: APP_ORIGIN, active: true }]);
    paired.emit("tabs", { tabs: [{ tabId: "not-a-number", title: "Broken" }] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(active.service.listSessions(active.companyId)[0]?.tabs.map((tab) => tab.tabId)).toEqual([7, 9]);
    paired.close();
  });

  it("caps local_browser_read and reports truncation", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_read"
          ? { ok: true, result: { url: APP_ORIGIN + "/", format: "text", content: "x".repeat(900), totalChars: 900 } }
          : { ok: true, result: {} },
    });
    const result = (await active.service.executeTool(binding(), "local_browser_read", { maxChars: 200 })) as {
      content: string;
      totalChars: number;
      truncated: boolean;
    };
    expect(result.content).toHaveLength(200);
    expect(result.totalChars).toBe(900);
    expect(result.truncated).toBe(true);
    paired.close();
  });
});

describe("local browser refusals", () => {
  it("refuses a full-tier tool in refine tier without sending the call", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension();
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_evaluate", { expression: "document.title" }),
      "local_browser_tier_denied",
    );
    expect(paired.calls.map((call) => call.tool)).not.toContain("local_browser_evaluate");
    paired.close();
  });

  it("refuses navigation to an origin outside the refine allowlist and allows it in full tier", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_navigate" ? { ok: true, result: { url: call.args.url } } : { ok: true, result: {} },
    });
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_navigate", { url: "https://evil.example.org/steal" }),
      "local_browser_origin_denied",
    );
    expect(paired.calls.map((call) => call.tool)).not.toContain("local_browser_navigate");

    await setTier("full");
    const allowed = await active.service.executeTool(binding(), "local_browser_navigate", {
      url: "https://evil.example.org/steal",
    });
    expect(allowed).toMatchObject({ url: "https://evil.example.org/steal" });
    paired.close();
  });

  it("refuses a page tool in refine tier when the tab origin cannot be resolved", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_snapshot"
          ? {
              ok: true,
              result: { url: APP_ORIGIN + "/refreshed", title: "Refreshed", nodes: [], total: 0 },
            }
          : { ok: true, result: {} },
    });
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_snapshot", { tabId: 99 }),
      "local_browser_origin_denied",
    );
    expect(paired.calls).toHaveLength(0);

    await setTier("full");
    const allowed = (await active.service.executeTool(binding(), "local_browser_snapshot", { tabId: 99 })) as {
      url: string;
    };
    expect(allowed.url).toBe("https://app.example.com/refreshed");
    paired.close();
  });

  it("refuses the internal viewer and input tools on the agent path", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension();
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_viewer", { op: "start" }),
      "local_browser_unsupported",
    );
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_input", { kind: "mouse", x: 1, y: 2 }),
      "local_browser_unsupported",
    );
    expect(paired.calls).toHaveLength(0);
    paired.close();
  });

  it("lists no browsers instead of failing, and reports local_browser_not_paired for a page call", async () => {
    const active = currentHarness();
    await expect(active.service.executeTool(binding(), "local_browser_sessions", {})).resolves.toEqual({ sessions: [] });
    await expectFailure(active.service.executeTool(binding(), "local_browser_snapshot", {}), "local_browser_not_paired");
  });
});

describe("local browser call lifecycle", () => {
  it("times out a call the extension never answers", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ onCall: () => "ignore" });
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_snapshot", {}),
      "local_browser_timeout",
    );
    paired.close();
  });

  it("fails pending calls when the extension disconnects", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ onCall: () => "ignore" });
    const pending = active.service.executeTool(binding(), "local_browser_snapshot", {});
    await paired.waitForCall("local_browser_snapshot");
    paired.close();
    await expectFailure(pending, "local_browser_extension_unavailable");
    expect(active.service.listSessions(active.companyId)).toHaveLength(0);
  });

  it("propagates an extension error code to the caller", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_act"
          ? {
              ok: false,
              error: { code: "local_browser_ref_stale", message: "ref e9 is stale", retryable: true },
            }
          : { ok: true, result: {} },
    });
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_act", { action: "click", ref: "e9" }),
      "local_browser_ref_stale",
    );
    paired.close();
  });
});

describe("local browser viewer and input", () => {
  it("starts the frame stream for the first subscriber and stops it after the last leaves", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_viewer" ? { ok: true, result: { started: call.args.op === "start" } } : { ok: true, result: {} },
    });

    const controller = new AbortController();
    const response = await fetch(
      bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/viewer"),
      { signal: controller.signal, headers: { accept: "text/event-stream" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const start = await paired.waitForCall("local_browser_viewer");
    expect(start.args.op).toBe("start");
    expect(start.args.intervalMs).toBe(1_000);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes('"state":"connected"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { type: "stream" });
    }
    expect(buffer).toContain('{"type":"state","state":"connected"}');

    paired.emit("frame", {
      dataUrl: "data:image/png;base64,AAAA",
      width: 800,
      height: 600,
      tabId: 7,
    });
    paired.emit("state", { state: "agent_streaming" });
    paired.emit("state", { state: "not-a-viewer-state" });
    while (!buffer.includes('"type":"frame"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { type: "stream" });
    }
    expect(buffer).toContain('{"type":"frame","dataUrl":"data:image/png;base64,AAAA","width":800,"height":600,"tabId":7}');
    while (!buffer.includes("agent_streaming")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { type: "stream" });
    }
    expect(buffer).toContain('{"type":"state","state":"agent_streaming"}');
    expect(buffer).not.toContain("not-a-viewer-state");
    expect(buffer).not.toContain('"event":"state"');

    controller.abort();
    await waitFor(
      () => paired.calls.some((call) => call.tool === "local_browser_viewer" && call.args.op === "stop"),
      "local_browser_viewer stop",
    );
    expect(paired.calls.filter((call) => call.tool === "local_browser_viewer").map((call) => call.args.op)).toEqual([
      "start",
      "stop",
    ]);
    await reader.cancel().catch(() => undefined);
    paired.close();
  });

  it("forwards viewer input as local_browser_input and rejects oversized bodies", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_input" ? { ok: true, result: { synthetic: true } } : { ok: true, result: {} },
    });
    const accepted = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "mouse", action: "down", x: 10, y: 20, button: "left", clickCount: 1 }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true });
    const call = await paired.waitForCall("local_browser_input");
    expect(call.args).toEqual({ kind: "mouse", action: "down", x: 10, y: 20, button: "left", clickCount: 1 });

    const keyed = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "key", action: "down", key: "Enter", code: "Enter", ctrl: true }),
    });
    expect(keyed.status).toBe(200);

    const invalid = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "mouse", x: 10, y: 20 }),
    });
    expect(invalid.status).toBe(400);
    const issues = (await invalid.json()) as { error: string; issues: Array<{ path: Array<string | number> }> };
    expect(issues.error).toBe("Invalid viewer input");
    expect(issues.issues.length).toBeGreaterThan(0);

    const oversized = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "key", action: "down", key: "a".repeat(20_000) }),
    });
    expect(oversized.status).toBe(413);
    void active;
    paired.close();
  });
});

describe("local browser takeover authority", () => {
  it("refuses viewer and input to a company-owner agent but allows the board user", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_input" || call.tool === "local_browser_viewer"
          ? { ok: true, result: { synthetic: true } }
          : { ok: true, result: {} },
    });

    const agentInput = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ceoAgentHeaders() },
      body: JSON.stringify({ kind: "mouse", action: "down", x: 1, y: 1 }),
    });
    expect(agentInput.status).toBe(403);

    const agentViewer = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/viewer"), {
      headers: ceoAgentHeaders(),
    });
    expect(agentViewer.status).toBe(403);
    expect(paired.calls.map((call) => call.tool)).not.toContain("local_browser_input");

    const boardInput = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "mouse", action: "down", x: 1, y: 1 }),
    });
    expect(boardInput.status).toBe(200);

    const controller = new AbortController();
    const boardViewer = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/viewer"), {
      signal: controller.signal,
    });
    expect(boardViewer.status).toBe(200);
    expect(boardViewer.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
    await boardViewer.body?.cancel().catch(() => undefined);
    void active;
    paired.close();
  });

  it("records the real actor on a takeover audit row", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_input" ? { ok: true, result: { synthetic: true } } : { ok: true, result: {} },
    });
    const accepted = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "key", action: "down", key: "a" }),
    });
    expect(accepted.status).toBe(200);
    await waitFor(
      async () => (await postgres.db.select().from(activityLog).where(eq(activityLog.action, "local_browser.tool_called"))).length > 0,
      "input audit row",
    );
    const rows = await postgres.db.select().from(activityLog).where(eq(activityLog.action, "local_browser.tool_called"));
    const inputRow = rows.find((row) => row.details?.tool === "local_browser_input");
    expect(inputRow?.actorType).toBe("user");
    expect(inputRow?.actorId).toBe(active.userId);
    paired.close();
  });
});

describe("local browser body limits", () => {
  it("answers 413 for a declared body over the limit and for a parsed one", async () => {
    const paired = await pairExtension();
    const declared = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "key", action: "down", key: "a".repeat(200_000) }),
    });
    expect(declared.status).toBe(413);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"kind":"key","action":"down","key":"' + "a".repeat(200_000) + '"}'));
        controller.close();
      },
    });
    const chunked = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/input"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(chunked.status).toBe(413);
    paired.close();
  });
});

describe("local browser session teardown", () => {
  it("ends the SSE stream and stops the capture loop when the session is deleted", async () => {
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_viewer" ? { ok: true, result: { started: call.args.op === "start" } } : { ok: true, result: {} },
    });
    const response = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/viewer"));
    expect(response.status).toBe(200);
    await paired.waitForCall("local_browser_viewer");
    const reader = response.body!.getReader();
    await reader.read();

    const deleted = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId), { method: "DELETE" });
    expect(deleted.status).toBe(200);

    let closed = false;
    for (let index = 0; index < 200; index += 1) {
      const chunk = await reader.read();
      if (chunk.done) {
        closed = true;
        break;
      }
    }
    expect(closed).toBe(true);
    paired.close();
  });

  it("closes the connection row when a silent session is swept", async () => {
    const active = currentHarness();
    const start = await startPairing();
    const sweepServer = createServer(express());
    await new Promise<void>((resolve) => sweepServer.listen(0, "127.0.0.1", resolve));
    const address = sweepServer.address();
    if (!address || typeof address === "string") throw new Error("sweep server did not bind");
    const sweepBridge = setupLocalBrowserWebSocketServer(sweepServer, postgres.db, {
      service: active.service,
      pingIntervalMs: 40,
      silenceLimitMs: 60,
    });

    const socket = new WebSocket("ws://127.0.0.1:" + address.port + "/api/local-browser/bridge?code=" + start.code);
    const ack = new Promise<Extract<LocalBrowserBridgeFrame, { type: "hello_ack" }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no hello_ack")), 5_000);
      socket.on("message", (data: unknown) => {
        const frame = JSON.parse(String(data)) as LocalBrowserBridgeFrame;
        if (frame.type !== "hello_ack") return;
        clearTimeout(timer);
        resolve(frame);
      });
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", (error) => reject(error as Error));
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        protocol: 1,
        client: "chromium",
        clientVersion: "1.0.0",
        label: "Sweep browser",
        profileName: null,
        tabs: [{ tabId: 1, title: "Sweep", url: APP_ORIGIN + "/", active: true }],
      }),
    );
    const session = await ack;
    const connectionId = active.service.listSessions(active.companyId).find((entry) => entry.sessionId === session.sessionId)?.connectionId;
    expect(connectionId).toBeTruthy();

    await waitFor(
      async () => {
        const [row] = await postgres.db
          .select()
          .from(localBrowserConnections)
          .where(eq(localBrowserConnections.id, connectionId!));
        return row?.status === "closed" && row.closedAt !== null;
      },
      "swept connection row closed",
      10_000,
    );
    expect(active.service.listSessions(active.companyId).some((entry) => entry.sessionId === session.sessionId)).toBe(false);
    sweepBridge.closeAllSessions();
    await new Promise<void>((resolve) => sweepServer.close(() => resolve()));
  });
});

describe("local browser pairing single use", () => {
  it("refuses the second socket that presents the same pairing code", async () => {
    const active = currentHarness();
    const start = await startPairing();
    const first = await pairExtension({ code: start.code });
    expect(active.service.listSessions(active.companyId)).toHaveLength(1);

    const second = new WebSocket(active.wsUrl + "/api/local-browser/bridge?code=" + start.code);
    const outcome = await new Promise<string>((resolve) => {
      second.on("error", () => resolve("rejected"));
      second.on("open", () => resolve("opened"));
    });
    expect(outcome).toBe("rejected");
    expect(active.service.listSessions(active.companyId)).toHaveLength(1);
    expect(await postgres.db.select().from(localBrowserConnections)).toHaveLength(1);
    first.close();
  });
});

describe("local browser tenant isolation", () => {
  it("returns 404 for a delete that targets another company's connection", async () => {
    const other = await seedCompanyWithBoardAccess(postgres.db, "local-browser-other");
    const [row] = await postgres.db
      .insert(localBrowserConnections)
      .values({
        companyId: other.companyId,
        label: "Other company browser",
        client: "firefox",
        clientVersion: "1.0.0",
        tier: "refine",
        allowedOrigins: [],
        tokenHash: "f".repeat(64),
        status: "active",
      })
      .returning({ id: localBrowserConnections.id });
    expect(row?.id).toBeTruthy();

    const response = await fetch(bridgeUrl("/api/local-browser/sessions/" + row!.id), { method: "DELETE" });
    expect(response.status).toBe(404);
    const [after] = await postgres.db
      .select()
      .from(localBrowserConnections)
      .where(eq(localBrowserConnections.id, row!.id));
    expect(after?.status).toBe("active");
    expect(after?.closedAt).toBeNull();
  });
});

describe("local browser viewer frame bounds", () => {
  it("drops a viewer frame whose data URL exceeds the screenshot budget", async () => {
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_viewer" ? { ok: true, result: { started: true } } : { ok: true, result: {} },
    });
    const controller = new AbortController();
    const response = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/viewer"), {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes('"state":"connected"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { type: "stream" });
    }
    await paired.waitForCall("local_browser_viewer");

    paired.emit("frame", { dataUrl: "data:image/png;base64," + "A".repeat(3 * 1024 * 1024), width: 800, height: 600 });
    paired.emit("frame", { dataUrl: "data:image/png;base64,AAAA", width: 10, height: 10 });
    while (!buffer.includes('"width":10')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { type: "stream" });
    }
    expect(buffer).not.toContain("AAAA".repeat(1_000));
    expect(buffer).toContain('{"type":"frame","dataUrl":"data:image/png;base64,AAAA","width":10,"height":10}');
    controller.abort();
    await reader.cancel().catch(() => undefined);
    paired.close();
  });
});

describe("local browser snapshot text bounds", () => {
  it("bounds a hostile snapshot by the result limit and marks it truncated", async () => {
    const active = currentHarness();
    await setLimits({ resultMaxChars: 20_000 });
    const huge = "x".repeat(20_000);
    const nodes = Array.from({ length: 120 }, (_, index) => ({
      ref: "e" + (index + 1),
      role: "button",
      name: huge,
      value: huge,
      depth: 0,
    }));
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_snapshot"
          ? { ok: true, result: { url: APP_ORIGIN + "/", title: "Hostile", nodes, total: nodes.length, truncated: false } }
          : { ok: true, result: {} },
    });
    const result = (await active.service.executeTool(binding(), "local_browser_snapshot", {})) as {
      text: string;
      truncated: boolean;
      nodes: number;
      total: number;
      cursor?: string;
    };
    expect(result.text.length).toBeLessThanOrEqual(20_000);
    expect(result.truncated).toBe(true);
    expect(result.nodes).toBeLessThan(120);
    expect(result.total).toBe(120);
    expect(result.cursor).toMatch(LOCAL_BROWSER_CURSOR_PATTERN);
    expect(Number(result.cursor)).toBe(result.nodes);

    const next = (await active.service.executeTool(binding(), "local_browser_snapshot", {
      cursor: result.cursor,
    })) as { text: string; nodes: number; cursor?: string };
    expect(next.text.length).toBeLessThanOrEqual(20_000);
    expect(next.text.startsWith("e" + (result.nodes + 1) + " ")).toBe(true);
    expect(next.nodes).toBeGreaterThan(0);
    paired.close();
  });

  it("refuses a malformed screenshot payload instead of throwing", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_screenshot"
          ? { ok: true, result: { dataUrl: "data:image/png,%E0%A4%A", width: 10, height: 10 } }
          : { ok: true, result: {} },
    });
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_screenshot", {}),
      "local_browser_protocol_error",
    );
    paired.close();
  });
});

describe("local browser call budgets", () => {
  it("arms the per-tool budget instead of a flat 30s", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ onCall: () => "ignore" });
    const bare = localBrowserService(postgres.db);

    const pending = bare.executeTool(binding(), "local_browser_wait", { timeoutMs: 60_000 });
    await paired.waitForCall("local_browser_wait");
    const live = bare.getSessionForCompany(active.companyId, paired.sessionId);
    const armed = [...(live?.pending.values() ?? [])];
    expect(armed).toHaveLength(1);
    expect(armed[0]?.budgetMs).toBe(65_000);

    paired.close();
    await expectFailure(pending, "local_browser_extension_unavailable");
  });

  it("keeps the shared 30s default plus grace for tools without a longer row", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ onCall: () => "ignore" });
    const bare = localBrowserService(postgres.db);

    const pending = bare.executeTool(binding(), "local_browser_snapshot", {});
    await paired.waitForCall("local_browser_snapshot");
    const live = bare.getSessionForCompany(active.companyId, paired.sessionId);
    expect([...(live?.pending.values() ?? [])][0]?.budgetMs).toBe(35_000);

    paired.close();
    await expectFailure(pending, "local_browser_extension_unavailable");
  });
});

describe("local browser close", () => {
  it("closes the connection row when an agent closes the session", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_close" ? { ok: true, result: { closed: true } } : { ok: true, result: {} },
    });
    const connectionId = active.service.listSessions(active.companyId)[0]?.connectionId;
    expect(connectionId).toBeTruthy();

    await active.service.executeTool(binding(), "local_browser_close", { closeSession: true });

    expect(active.service.listSessions(active.companyId)).toHaveLength(0);
    await waitFor(
      async () => {
        const [row] = await postgres.db
          .select()
          .from(localBrowserConnections)
          .where(eq(localBrowserConnections.id, connectionId!));
        return row?.status === "closed" && row.closedAt !== null;
      },
      "closed row after agent close",
    );
    const [row] = await postgres.db
      .select()
      .from(localBrowserConnections)
      .where(eq(localBrowserConnections.id, connectionId!));
    expect(row?.status).toBe("closed");
    expect(row?.closedAt).toBeInstanceOf(Date);
  });
});

describe("local browser audit", () => {
  it("writes one audit row per tool call without the arguments or the result", async () => {
    const active = currentHarness();
    await allowOrigin();
    const secretText = "hunter2-super-secret";
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_act"
          ? { ok: true, result: { typed: true, echo: secretText } }
          : { ok: true, result: {} },
    });

    await active.service.executeTool(binding(), "local_browser_act", {
      action: "type",
      ref: "e3",
      text: secretText,
      tabId: 7,
    });

    const rows = await postgres.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "local_browser.tool_called"));
    expect(rows).toHaveLength(1);
    const details = rows[0]!.details ?? {};
    expect(details).toMatchObject({
      tool: "local_browser_act",
      sessionId: paired.sessionId,
      tabId: 7,
      origin: APP_ORIGIN,
      tier: "refine",
      ok: true,
    });
    expect(typeof details.durationMs).toBe("number");
    expect(details.errorCode).toBeNull();
    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain("typed");
    expect(rows[0]!.companyId).toBe(active.companyId);
    paired.close();
  });

  it("records the error code on a refused call", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension();
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_evaluate", { expression: "1" }),
      "local_browser_tier_denied",
    );
    const rows = await postgres.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "local_browser.tool_called"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ tool: "local_browser_evaluate", ok: false, errorCode: "local_browser_tier_denied" });
    paired.close();
  });
});

const ALL_CAPABILITIES = [...LOCAL_BROWSER_CAPABILITIES];
const ACCESS = { siteAccess: "limited", granted: ["tabs", "scripting"], missing: ["cookies", "<all_urls>"], pending: [] };
const UPDATE_HINT = "Update the Paperclip Local Browser extension";

async function readSettings(): Promise<{ tier: string; allowedOrigins: string[]; limits: Record<string, number> }> {
  const response = await fetch(bridgeUrl("/api/local-browser/settings"));
  expect(response.status).toBe(200);
  return (await response.json()) as { tier: string; allowedOrigins: string[]; limits: Record<string, number> };
}

describe("local browser limits", () => {
  it("round-trips limits through settings and keeps them when a save omits them", async () => {
    const active = currentHarness();
    expect((await readSettings()).limits).toEqual(LOCAL_BROWSER_LIMIT_DEFAULTS);
    const paired = await pairExtension();
    const saved = await setLimits({ snapshotMaxNodes: 50, callMaxMs: 9_000 });
    expect(saved.limits).toEqual({ ...LOCAL_BROWSER_LIMIT_DEFAULTS, snapshotMaxNodes: 50, callMaxMs: 9_000 });
    await setTier("refine");
    expect((await readSettings()).limits).toMatchObject({ snapshotMaxNodes: 50, callMaxMs: 9_000 });
    expect(active.service.getSessionForCompany(active.companyId, paired.sessionId)?.limits).toMatchObject({
      snapshotMaxNodes: 50,
      callMaxMs: 9_000,
    });
    const [row] = await postgres.db.select().from(localBrowserSettings);
    expect(row?.limits).toMatchObject({ snapshotMaxNodes: 50, callMaxMs: 9_000 });
    const tooHigh = await fetch(bridgeUrl("/api/local-browser/settings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "refine", allowedOrigins: [], limits: { callMaxMs: 600_001 } }),
    });
    expect(tooHigh.status).toBe(400);
    expect((await readSettings()).limits.callMaxMs).toBe(9_000);
    paired.close();
  });

  it("clamps calls to the company limits and reports what it clamped", async () => {
    const active = currentHarness();
    await setLimits({ snapshotMaxNodes: 50, readMaxChars: 300, resultMaxChars: 1_000 }, "full");
    const paired = await pairExtension({
      onCall: (call) => {
        if (call.tool === "local_browser_snapshot") {
          return { ok: true, result: { url: APP_ORIGIN + "/", title: "t", nodes: [{ ref: "e1", role: "button", name: "Go" }], total: 1 } };
        }
        if (call.tool === "local_browser_read") {
          return { ok: true, result: { url: APP_ORIGIN + "/", content: "y".repeat(900), totalChars: 900 } };
        }
        if (call.tool === "local_browser_evaluate") return { ok: true, result: { value: "z".repeat(5_000) } };
        return { ok: true, result: {} };
      },
    });
    const snapshot = (await active.service.executeTool(binding(), "local_browser_snapshot", { maxNodes: 5_000 })) as {
      limited?: unknown;
    };
    expect(snapshot.limited).toEqual([{ field: "maxNodes", requested: 5_000, applied: 50 }]);
    expect((await paired.waitForCall("local_browser_snapshot")).args.maxNodes).toBe(50);

    const read = (await active.service.executeTool(binding(), "local_browser_read", { maxChars: 2_000 })) as {
      content: string;
      limited?: unknown;
    };
    expect(read.content).toHaveLength(300);
    expect(read.limited).toEqual([{ field: "maxChars", requested: 2_000, applied: 300 }]);
    expect((await paired.waitForCall("local_browser_read")).args.maxChars).toBe(300);

    const evaluated = (await active.service.executeTool(binding(), "local_browser_evaluate", { expression: "1" })) as {
      truncated: boolean;
      preview: string;
      limited: Array<{ field: string; applied: number }>;
    };
    expect(evaluated.truncated).toBe(true);
    expect(evaluated.preview).toHaveLength(1_000);
    expect(evaluated.limited).toEqual([expect.objectContaining({ field: "resultMaxChars", applied: 1_000 })]);

    const unclamped = (await active.service.executeTool(binding(), "local_browser_snapshot", { maxNodes: 20 })) as {
      limited?: unknown;
    };
    expect(unclamped.limited).toBeUndefined();
    paired.close();
  });

  it("clamps timeouts to the call limit and arms the matching budget", async () => {
    const active = currentHarness();
    await setLimits({ callMaxMs: 5_000 });
    const paired = await pairExtension({ capabilities: ["budget.v1"], onCall: () => "ignore" });
    const bare = localBrowserService(postgres.db);
    const pending = bare.executeTool(binding(), "local_browser_wait", { timeoutMs: 60_000 });
    const call = await paired.waitForCall("local_browser_wait");
    expect(call.args.timeoutMs).toBe(5_000);
    expect(call.budgetMs).toBe(10_000);
    const armed = [...(bare.getSessionForCompany(active.companyId, paired.sessionId)?.pending.values() ?? [])];
    expect(armed[0]?.budgetMs).toBe(10_000);
    paired.close();
    await expectFailure(pending, "local_browser_extension_unavailable");
  });

  it("refuses a screenshot above the company byte limit", async () => {
    const active = currentHarness();
    await setLimits({ screenshotMaxBytes: 65_536 });
    const big = Buffer.alloc(70_000, 1).toString("base64");
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_screenshot"
          ? { ok: true, result: { dataUrl: "data:image/png;base64," + big, width: 10, height: 10 } }
          : { ok: true, result: {} },
    });
    await expect(active.service.executeTool(binding(), "local_browser_screenshot", {})).rejects.toMatchObject({
      code: "local_browser_result_too_large",
      status: 413,
    });
    paired.close();
  });
});

describe("local browser call frames", () => {
  it("sends budgetMs to an extension that advertises budget.v1", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ capabilities: ["budget.v1"] });
    await active.service.executeTool(binding(), "local_browser_snapshot", {});
    expect((await paired.waitForCall("local_browser_snapshot")).budgetMs).toBe(CALL_TIMEOUT_MS);
    paired.close();
  });

  it("leaves budgetMs off the frame for an extension without budget.v1", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension();
    await active.service.executeTool(binding(), "local_browser_snapshot", {});
    expect((await paired.waitForCall("local_browser_snapshot")).budgetMs).toBeUndefined();
    paired.close();
  });
});

describe("local browser capability negotiation", () => {
  it("refuses every new feature against an extension that does not advertise it", async () => {
    const active = currentHarness();
    await setTier("full");
    const legacy = await pairExtension();
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["local_browser_context", {}],
      ["local_browser_permissions", { op: "status" }],
      ["local_browser_api", { path: "history.search", args: [{ text: "" }] }],
      ["local_browser_open", { url: APP_ORIGIN + "/", cookieStoreId: "firefox-container-1" }],
      ["local_browser_open", { url: APP_ORIGIN + "/", incognito: true }],
      ["local_browser_act", { action: "click", ref: "e1", force: true }],
    ];
    for (const [tool, args] of attempts) {
      await expect(active.service.executeTool(binding(), tool, args), tool).rejects.toMatchObject({
        code: "local_browser_unsupported",
        hint: expect.stringContaining(UPDATE_HINT),
      });
    }
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_storage", {
        kind: "cookies",
        op: "set",
        url: APP_ORIGIN + "/",
        entries: [{ name: "a", value: "b", session: true }],
      }),
      "local_browser_unsupported",
    );
    expect(legacy.calls).toHaveLength(0);
    legacy.close();
  });

  it("forwards the new features to an extension that advertises them", async () => {
    const active = currentHarness();
    await setTier("full");
    const modern = await pairExtension({
      capabilities: ALL_CAPABILITIES,
      onCall: (call) => {
        if (call.tool === "local_browser_api") return { ok: true, result: { value: [{ url: "https://a.test/" }], type: "object" } };
        if (call.tool === "local_browser_context") return { ok: true, result: { contentScript: "connected", access: ACCESS } };
        return { ok: true, result: { ok: true } };
      },
    });
    await expect(
      active.service.executeTool(binding(), "local_browser_api", { path: "history.search", args: [{ text: "invoice" }] }),
    ).resolves.toEqual({ value: [{ url: "https://a.test/" }], type: "object" });
    await expect(active.service.executeTool(binding(), "local_browser_context", { tabId: 7 })).resolves.toMatchObject({
      contentScript: "connected",
    });
    await active.service.executeTool(binding(), "local_browser_open", { url: APP_ORIGIN + "/", cookieStoreId: "firefox-container-1" });
    await active.service.executeTool(binding(), "local_browser_act", { action: "click", ref: "e1", force: true });
    await active.service.executeTool(binding(), "local_browser_network", { op: "list", includeHeaders: true, since: 5, types: ["fetch"] });
    expect((await modern.waitForCall("local_browser_api")).args).toMatchObject({ path: "history.search", args: [{ text: "invoice" }] });
    expect((await modern.waitForCall("local_browser_open")).args.cookieStoreId).toBe("firefox-container-1");
    expect((await modern.waitForCall("local_browser_act")).args.force).toBe(true);
    expect((await modern.waitForCall("local_browser_network")).args).toMatchObject({ includeHeaders: true, since: 5, types: ["fetch"] });
    modern.close();
  });

  it("exempts permissions from the origin gate, keeps context behind it and api in full tier", async () => {
    const active = currentHarness();
    await setTier("refine", []);
    const paired = await pairExtension({
      capabilities: ALL_CAPABILITIES,
      onCall: (call) =>
        call.tool === "local_browser_permissions"
          ? { ok: true, result: { granted: [], missing: ["history"], pending: [], siteAccess: "limited", note: "Ask the user" } }
          : { ok: true, result: {} },
    });
    await expect(active.service.executeTool(binding(), "local_browser_permissions", { op: "status" })).resolves.toMatchObject({
      missing: ["history"],
    });
    await expectFailure(active.service.executeTool(binding(), "local_browser_context", {}), "local_browser_origin_denied");
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_api", { path: "history.search" }),
      "local_browser_tier_denied",
    );
    expect(paired.calls.map((call) => call.tool)).toEqual(["local_browser_permissions"]);
    paired.close();
  });

  it("never lets an agent call the internal ui tool", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ capabilities: ALL_CAPABILITIES });
    await expectFailure(
      active.service.executeTool(binding(), "local_browser_ui", { op: "open_permissions" }),
      "local_browser_unsupported",
    );
    expect(paired.calls).toHaveLength(0);
    paired.close();
  });

  it("propagates permission_required with the missing permissions and a hint", async () => {
    const active = currentHarness();
    await setTier("full");
    let extensionHint: string | undefined;
    const paired = await pairExtension({
      capabilities: ALL_CAPABILITIES,
      onCall: () => ({
        ok: false,
        error: {
          code: "local_browser_permission_required",
          message: "history is not granted",
          permissions: ["history"],
          ...(extensionHint ? { hint: extensionHint } : {}),
        },
      }),
    });
    const failure = (await active.service
      .executeTool(binding(), "local_browser_api", { path: "history.search" })
      .catch((error: unknown) => error)) as {
      code: string;
      status: number;
      retryable: boolean;
      permissions: string[];
      hint: string;
      details: Record<string, unknown>;
      toToolError(): Record<string, unknown>;
    };
    expect(failure).toMatchObject({ code: "local_browser_permission_required", status: 403, retryable: true, permissions: ["history"] });
    expect(failure.hint).toContain("local_browser_permissions");
    expect(failure.details).toMatchObject({ permissions: ["history"], retryable: true });
    expect(failure.toToolError()).toMatchObject({ code: "local_browser_permission_required", permissions: ["history"] });

    extensionHint = "Press Allow in the extension popup";
    await expect(
      active.service.executeTool(binding(), "local_browser_api", { path: "history.search" }),
    ).rejects.toMatchObject({ hint: extensionHint, permissions: ["history"] });
    paired.close();
  });
});

describe("local browser session state", () => {
  it("surfaces capabilities, access, guards and container tabs from hello and later events", async () => {
    const active = currentHarness();
    const guards = { protectPaperclipTab: true, protectFocusedTab: false, networkBufferSize: 500 };
    const paired = await pairExtension({
      capabilities: ["permissions.v1"],
      hello: {
        access: ACCESS,
        guards,
        tabs: [
          {
            tabId: 7,
            windowId: 1,
            title: "Example",
            url: APP_ORIGIN + "/dashboard",
            active: true,
            cookieStoreId: "firefox-container-2",
            containerName: "Work",
            incognito: false,
          },
        ],
      },
    });
    expect(active.service.listSessions(active.companyId)[0]).toMatchObject({
      capabilities: ["permissions.v1"],
      access: ACCESS,
      guards,
      tabs: [{ cookieStoreId: "firefox-container-2", containerName: "Work", incognito: false }],
    });

    paired.emit("access", { ...ACCESS, granted: [...ACCESS.granted, "cookies"], missing: ["<all_urls>"] });
    await waitFor(
      () => active.service.listSessions(active.companyId)[0]?.access?.granted.includes("cookies") === true,
      "access event",
    );
    paired.emit("guards", { networkBufferSize: 5 });
    paired.emit("guards", { ...guards, protectFocusedTab: true });
    await waitFor(
      () => active.service.listSessions(active.companyId)[0]?.guards?.protectFocusedTab === true,
      "guards event",
    );
    expect(active.service.listSessions(active.companyId)[0]?.guards?.networkBufferSize).toBe(500);

    const response = await fetch(bridgeUrl("/api/local-browser/sessions"));
    const body = (await response.json()) as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions[0]).toMatchObject({ capabilities: ["permissions.v1"], access: { missing: ["<all_urls>"] } });
    const listed = (await active.service.executeTool(binding(), "local_browser_sessions", {})) as {
      sessions: Array<Record<string, unknown>>;
    };
    expect(listed.sessions[0]).toMatchObject({ access: { granted: ["tabs", "scripting", "cookies"] } });
    paired.close();
  });

  it("passes document state through snapshot, read and wait results", async () => {
    const active = currentHarness();
    await allowOrigin();
    const documentState = {
      documentId: "d1",
      url: APP_ORIGIN + "/",
      readyState: "complete",
      visibilityState: "visible",
      navigationType: "back_forward",
      restoredFromBfcache: true,
      wasDiscarded: false,
      prerendering: false,
      loadedAt: 1,
      ageMs: 2,
      requestsSinceLoad: 0,
      xhrSinceLoad: 0,
      stale: true,
      staleReasons: ["restored_from_bfcache"],
    };
    const paired = await pairExtension({
      capabilities: ["document.state"],
      onCall: (call) => {
        if (call.tool === "local_browser_snapshot") {
          return {
            ok: true,
            result: { url: APP_ORIGIN + "/", title: "t", nodes: [{ ref: "e1", role: "button", name: "Go" }], total: 1, document: documentState },
          };
        }
        if (call.tool === "local_browser_read") {
          return { ok: true, result: { url: APP_ORIGIN + "/", content: "hi", totalChars: 2, document: documentState } };
        }
        return { ok: true, result: { ok: true, document: documentState } };
      },
    });
    for (const [tool, args] of [
      ["local_browser_snapshot", {}],
      ["local_browser_read", {}],
      ["local_browser_wait", { idle: true }],
    ] as const) {
      const result = (await active.service.executeTool(binding(), tool, args)) as { document?: unknown };
      expect(result.document, tool).toEqual(documentState);
    }
    paired.close();
  });
});

describe("local browser open-permissions route", () => {
  it("asks the extension to open its permission page and audits the board user", async () => {
    const active = currentHarness();
    const paired = await pairExtension({ capabilities: ["permissions.v1"] });
    const response = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/open-permissions"), {
      method: "POST",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect((await paired.waitForCall("local_browser_ui")).args).toEqual({ op: "open_permissions" });
    await waitFor(
      async () =>
        (await postgres.db.select().from(activityLog).where(eq(activityLog.action, "local_browser.tool_called"))).some(
          (row) => row.details?.tool === "local_browser_ui",
        ),
      "open-permissions audit row",
    );
    const rows = await postgres.db.select().from(activityLog).where(eq(activityLog.action, "local_browser.tool_called"));
    const row = rows.find((entry) => entry.details?.tool === "local_browser_ui");
    expect(row).toMatchObject({ actorType: "user", actorId: active.userId, entityId: paired.sessionId });
    expect(row?.details).toMatchObject({ ok: true, sessionId: paired.sessionId });
    paired.close();
  });

  it("refuses agents, unknown sessions and extensions without permissions.v1", async () => {
    const legacy = await pairExtension();
    const url = bridgeUrl("/api/local-browser/sessions/" + legacy.sessionId + "/open-permissions");
    const asAgent = await fetch(url, { method: "POST", headers: ceoAgentHeaders() });
    expect(asAgent.status).toBe(403);
    const unsupported = await fetch(url, { method: "POST" });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.text()).toContain("local_browser_unsupported");
    const unknown = await fetch(
      bridgeUrl("/api/local-browser/sessions/00000000-0000-4000-8000-000000000999/open-permissions"),
      { method: "POST" },
    );
    expect(unknown.status).toBe(409);
    expect(legacy.calls).toHaveLength(0);
    legacy.close();
  });
});

function helloFrame(label = "Test browser"): string {
  return JSON.stringify({
    type: "hello",
    protocol: 1,
    client: "chromium",
    clientVersion: "1.0.0",
    label,
    profileName: "Default",
    tabs: [{ tabId: 7, windowId: 1, title: "Example", url: APP_ORIGIN + "/dashboard", active: true }],
  });
}

function watchSocket(url: string) {
  const socket = new WebSocket(url);
  const opened = new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
    socket.on("open", () => resolve({ ok: true }));
    socket.on("error", (error) => resolve({ ok: false, message: (error as Error).message }));
  });
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code as number)));
  const acked = new Promise<Extract<LocalBrowserBridgeFrame, { type: "hello_ack" }>>((resolve) => {
    socket.on("message", (data: unknown) => {
      const frame = JSON.parse(String(data)) as LocalBrowserBridgeFrame;
      if (frame.type === "hello_ack") resolve(frame);
    });
  });
  return { socket, opened, closed, acked };
}

async function listenBridge(options: { maxPayloadBytes?: number } = {}) {
  const active = currentHarness();
  const extra = createServer(express());
  await new Promise<void>((resolve) => extra.listen(0, "127.0.0.1", resolve));
  const address = extra.address();
  if (!address || typeof address === "string") throw new Error("extra server did not bind");
  const extraBridge = setupLocalBrowserWebSocketServer(extra, postgres.db, {
    service: active.service,
    pingIntervalMs: 60_000,
    silenceLimitMs: 600_000,
    ...options,
  });
  return {
    wsUrl: "ws://127.0.0.1:" + address.port,
    async close() {
      extraBridge.closeAllSessions();
      extra.closeAllConnections?.();
      await new Promise<void>((resolve) => extra.close(() => resolve()));
    },
  };
}

describe("local browser bridge frame hardening", () => {
  it("keeps the frame ceiling below the longest string Node can build", () => {
    expect(LOCAL_BROWSER_LIMITS.transferMaxBytes.ceiling).toBe(268_435_456);
    expect(LOCAL_BROWSER_BRIDGE_MAX_PAYLOAD_BYTES).toBeGreaterThan(Math.ceil((LOCAL_BROWSER_LIMITS.transferMaxBytes.ceiling * 4) / 3));
    expect(LOCAL_BROWSER_BRIDGE_MAX_PAYLOAD_BYTES).toBeLessThan(bufferConstants.MAX_STRING_LENGTH);
  });

  it("answers null instead of throwing when a frame cannot become a string", () => {
    const unreadable = {
      toString(): string {
        throw new RangeError("Cannot create a string longer than 0x1fffffe8 characters");
      },
    };
    expect(localBrowserWebSocketInternals.readFrame(unreadable)).toBeNull();
    expect(localBrowserWebSocketInternals.readFrame(Buffer.from("not json"))).toBeNull();
  });

  it("closes only the socket that sent an oversized frame and keeps serving", async () => {
    const active = currentHarness();
    const small = await listenBridge({ maxPayloadBytes: 4_096 });
    try {
      const offender = watchSocket(small.wsUrl + "/api/local-browser/bridge?code=" + (await startPairing()).code);
      expect(await offender.opened).toEqual({ ok: true });
      offender.socket.send(helloFrame("Offender"));
      await offender.acked;
      const bystander = watchSocket(small.wsUrl + "/api/local-browser/bridge?code=" + (await startPairing()).code);
      expect(await bystander.opened).toEqual({ ok: true });
      bystander.socket.send(helloFrame("Bystander"));
      const bystanderAck = await bystander.acked;

      offender.socket.send("x".repeat(10_000));
      expect(await offender.closed).toBe(1009);

      expect(bystander.socket.readyState).toBe(OPEN_STATE);
      await waitFor(() => active.service.listSessions(active.companyId).length === 1, "offender session removed");
      expect(active.service.listSessions(active.companyId)[0]?.sessionId).toBe(bystanderAck.sessionId);

      const later = watchSocket(small.wsUrl + "/api/local-browser/bridge?code=" + (await startPairing()).code);
      expect(await later.opened).toEqual({ ok: true });
      later.socket.send(helloFrame("Later"));
      await later.acked;
      expect(active.service.listSessions(active.companyId)).toHaveLength(2);
      bystander.socket.close();
      later.socket.close();
    } finally {
      await small.close();
    }
  });

  it("closes a socket whose first frame is not a hello", async () => {
    const active = currentHarness();
    const early = watchSocket(active.wsUrl + "/api/local-browser/bridge?code=" + (await startPairing()).code);
    expect(await early.opened).toEqual({ ok: true });
    early.socket.send(JSON.stringify({ type: "result", id: "c1", ok: true, result: {} }));
    expect(await early.closed).toBe(1008);

    const garbage = watchSocket(active.wsUrl + "/api/local-browser/bridge?code=" + (await startPairing()).code);
    expect(await garbage.opened).toEqual({ ok: true });
    garbage.socket.send("{not json");
    expect(await garbage.closed).toBe(1008);

    expect(active.service.listSessions(active.companyId)).toHaveLength(0);
    expect(await postgres.db.select().from(localBrowserConnections)).toHaveLength(0);
    const paired = await pairExtension();
    expect(active.service.listSessions(active.companyId)).toHaveLength(1);
    paired.close();
  });

  it("refuses a session token it does not know before the socket opens", async () => {
    const active = currentHarness();
    const stranger = watchSocket(active.wsUrl + "/api/local-browser/bridge?session=" + "a".repeat(43));
    const outcome = await stranger.opened;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.message).toContain("403");
  });

  it("reopens with a live session token and refuses it once the connection is closed", async () => {
    const active = currentHarness();
    const first = await pairExtension();
    const token = first.sessionToken;
    const firstClosed = new Promise<void>((resolve) => first.socket.on("close", () => resolve()));
    first.close();
    await firstClosed;
    await waitFor(() => active.service.listSessions(active.companyId).length === 0, "first session gone");

    const resumed = watchSocket(active.wsUrl + "/api/local-browser/bridge?session=" + encodeURIComponent(token));
    expect(await resumed.opened).toEqual({ ok: true });
    resumed.socket.send(helloFrame("Resumed"));
    expect((await resumed.acked).sessionToken).toBe(token);
    const resumedClosed = resumed.closed;
    resumed.socket.close();
    await resumedClosed;

    await postgres.db.update(localBrowserConnections).set({ status: "closed", closedAt: new Date() });
    const revoked = watchSocket(active.wsUrl + "/api/local-browser/bridge?session=" + encodeURIComponent(token));
    const outcome = await revoked.opened;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.message).toContain("403");
  });
});

describe("local browser network default limit", () => {
  it("sends the company network limit when the agent names none", async () => {
    const active = currentHarness();
    await setLimits({ networkMaxEntries: 30 }, "full");
    const paired = await pairExtension({ onCall: () => ({ ok: true, result: { requests: [] } }) });

    await active.service.executeTool(binding(), "local_browser_network", { op: "list" });
    expect(paired.calls.at(-1)?.args.limit).toBe(30);

    await active.service.executeTool(binding(), "local_browser_network", { op: "list", limit: 5 });
    expect(paired.calls.at(-1)?.args.limit).toBe(5);

    const clamped = (await active.service.executeTool(binding(), "local_browser_network", { op: "list", limit: 1_000 })) as {
      limited?: unknown;
    };
    expect(paired.calls.at(-1)?.args.limit).toBe(30);
    expect(clamped.limited).toEqual([{ field: "limit", requested: 1_000, applied: 30 }]);
    paired.close();
  });
});

describe("local browser viewer frames under a lowered screenshot limit", () => {
  it("keeps the viewer's own frame bound when the agent screenshot limit is lower", () => {
    const { toViewerEvent } = localBrowserWebSocketInternals;
    const frame = (bytes: number) => ({
      type: "event" as const,
      event: "frame" as const,
      data: { dataUrl: "data:image/jpeg;base64," + "A".repeat(Math.ceil((bytes * 4) / 3)), width: 10, height: 10 },
    });
    const viewerDefault = LOCAL_BROWSER_LIMITS.screenshotMaxBytes.default;
    const lowest = LOCAL_BROWSER_LIMITS.screenshotMaxBytes.min;
    expect(toViewerEvent(frame(1_000_000), lowest)).toMatchObject({ type: "frame" });
    expect(toViewerEvent(frame(viewerDefault - 1_024), lowest)).toMatchObject({ type: "frame" });
    expect(toViewerEvent(frame(viewerDefault + 4_096), lowest)).toBeNull();
    expect(toViewerEvent(frame(viewerDefault * 2), viewerDefault * 4)).toMatchObject({ type: "frame" });
    expect(toViewerEvent(frame(viewerDefault * 5), viewerDefault * 4)).toBeNull();
  });

  it("streams a viewer frame larger than a lowered screenshot limit", async () => {
    await setLimits({ screenshotMaxBytes: LOCAL_BROWSER_LIMITS.screenshotMaxBytes.min });
    const paired = await pairExtension({
      onCall: (call) =>
        call.tool === "local_browser_viewer" ? { ok: true, result: { started: true } } : { ok: true, result: {} },
    });
    const controller = new AbortController();
    const response = await fetch(bridgeUrl("/api/local-browser/sessions/" + paired.sessionId + "/viewer"), {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes('"state":"connected"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    await paired.waitForCall("local_browser_viewer");

    paired.emit("frame", { dataUrl: "data:image/jpeg;base64," + "B".repeat(400_000), width: 640, height: 480 });
    while (!buffer.includes('"width":640')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    expect(buffer).toContain('"width":640');
    expect(buffer).toContain("B".repeat(400_000));
    controller.abort();
    await reader.cancel().catch(() => undefined);
    paired.close();
  });
});

describe("local browser stored limits", () => {
  it("replaces out-of-range, wrong-typed and unknown stored values with defaults", () => {
    const ranges = LOCAL_BROWSER_LIMITS;
    expect(
      normalizeLocalBrowserLimits({
        resultMaxChars: ranges.resultMaxChars.min - 1,
        snapshotMaxNodes: ranges.snapshotMaxNodes.ceiling + 1,
        readMaxChars: "5000",
        screenshotMaxBytes: 70_000.5,
        transferMaxBytes: null,
        callMaxMs: ranges.callMaxMs.ceiling,
        networkMaxEntries: ranges.networkMaxEntries.min,
        retired: 7,
      }),
    ).toEqual({
      ...LOCAL_BROWSER_LIMIT_DEFAULTS,
      callMaxMs: ranges.callMaxMs.ceiling,
      networkMaxEntries: ranges.networkMaxEntries.min,
    });
    for (const raw of [null, undefined, "limits", 42, [1, 2], { transferMaxBytes: Number.POSITIVE_INFINITY }]) {
      expect(normalizeLocalBrowserLimits(raw)).toEqual(LOCAL_BROWSER_LIMIT_DEFAULTS);
    }
    for (const key of LOCAL_BROWSER_LIMIT_KEYS) {
      expect(normalizeLocalBrowserLimits({ [key]: ranges[key].ceiling })[key]).toBe(ranges[key].ceiling);
    }
  });

  it("serves defaults for a stored row whose limits fell out of range", async () => {
    await setLimits({ snapshotMaxNodes: 50 });
    await postgres.db.update(localBrowserSettings).set({
      limits: { snapshotMaxNodes: 50, transferMaxBytes: 524_288_000, callMaxMs: 1, readMaxChars: "big" } as unknown as Record<string, number>,
    });
    expect((await readSettings()).limits).toEqual({ ...LOCAL_BROWSER_LIMIT_DEFAULTS, snapshotMaxNodes: 50 });
  });
});
