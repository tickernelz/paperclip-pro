import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import express from "express";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, localBrowserConnections, localBrowserSettings } from "@tickernelz/paperclip-pro-db";
import { LOCAL_BROWSER_CURSOR_PATTERN, type LocalBrowserBridgeFrame } from "@tickernelz/paperclip-pro-shared";
import { errorHandler } from "../middleware/index.js";
import { setupLocalBrowserWebSocketServer, type LocalBrowserWebSocketServer } from "../realtime/local-browser-ws.js";
import {
  LOCAL_BROWSER_JSON_BODY_LIMIT,
  localBrowserBodyErrorHandler,
  localBrowserBodyLimit,
  localBrowserRoutes,
} from "../routes/local-browser.js";
import { resetPairings } from "../services/local-browser/pairing.js";
import { resetSessions } from "../services/local-browser/registry.js";
import { localBrowserService } from "../services/local-browser/service.js";
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
  options: { code?: string; tabUrl?: string; onCall?: (call: CallRecord) => CallAnswer } = {},
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
    const call: CallRecord = { id: frame.id, tool: frame.tool, args: (frame.args ?? {}) as Record<string, unknown> };
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
  it("bounds a hostile snapshot and marks it truncated", async () => {
    const active = currentHarness();
    await allowOrigin();
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
    expect(result.text.length).toBeLessThanOrEqual(40_000);
    expect(result.text.length).toBeLessThan(200_000);
    expect(result.truncated).toBe(true);
    expect(result.nodes).toBeLessThan(120);
    expect(result.total).toBe(120);
    expect(result.cursor).toMatch(LOCAL_BROWSER_CURSOR_PATTERN);
    expect(Number(result.cursor)).toBe(result.nodes);

    const next = (await active.service.executeTool(binding(), "local_browser_snapshot", {
      cursor: result.cursor,
    })) as { text: string; nodes: number; cursor?: string };
    expect(next.text.length).toBeLessThanOrEqual(40_000);
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

  it("keeps the shared 30s default for tools without a longer row", async () => {
    const active = currentHarness();
    await allowOrigin();
    const paired = await pairExtension({ onCall: () => "ignore" });
    const bare = localBrowserService(postgres.db);

    const pending = bare.executeTool(binding(), "local_browser_snapshot", {});
    await paired.waitForCall("local_browser_snapshot");
    const live = bare.getSessionForCompany(active.companyId, paired.sessionId);
    expect([...(live?.pending.values() ?? [])][0]?.budgetMs).toBe(30_000);

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
