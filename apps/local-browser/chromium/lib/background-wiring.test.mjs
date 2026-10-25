import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

after(() => {
  setTimeout(() => process.exit(0), 50);
});

function createHarness(options = {}) {
  const listeners = { message: [], startup: [], installed: [], alarm: [], tabs: [], windows: [], debugger: [], debuggerEvent: [] };
  const addTo = (bucket) => (fn) => listeners[bucket].push(fn);
  const sent = [];
  const stored = {
    "lb.pairing": options.seed || {
      origin: "https://p.test",
      label: "Test browser",
      sessionToken: "tok-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      tier: "full",
      allowedOrigins: [],
    },
  };

  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.handlers = {};
      FakeSocket.instances.push(this);
    }
    addEventListener(type, handler) {
      (this.handlers[type] ||= []).push(handler);
    }
    emit(type, event) {
      for (const handler of this.handlers[type] || []) handler(event);
    }
    send(data) {
      sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.emit("close", { code: 1000, reason: "client closing" });
    }
  }

  const tab = { id: 7, windowId: 1, title: "T", url: "https://p.test/", active: true, status: "complete" };
  const created = [];
  const tabsById = new Map([[tab.id, tab]]);
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      onMessage: { addListener: addTo("message") },
      onStartup: { addListener: addTo("startup") },
      onInstalled: { addListener: addTo("installed") },
      lastError: undefined,
    },
    alarms: { create: () => Promise.resolve(), onAlarm: { addListener: addTo("alarm") } },
    tabs: {
      query: async (query) => {
        const all = [...tabsById.values()];
        if (query && query.active === true) {
          const active = all.filter((entry) => entry.active);
          return active.length ? active : [all[0] || tab];
        }
        return all;
      },
      get: async (id) => (tabsById.has(id) ? { ...tabsById.get(id) } : null),
      update: async (id, props) => {
        const next = { ...(tabsById.get(id) || tab), id, ...props };
        tabsById.set(id, next);
        return { ...next };
      },
      create: async (props) => {
        const next = { ...tab, id: 99, url: props.url, active: props.active === true, status: "complete" };
        tabsById.set(next.id, next);
        created.push(next);
        return { ...next };
      },
      captureVisibleTab: async () => options.captureDataUrl || "data:image/jpeg;base64,AA",
      sendMessage: (tabId, payload, opts, callback) => {
        const respond = typeof opts === "function" ? opts : callback;
        if (options.viewportRpcFails) {
          respond(undefined);
          return;
        }
        if (payload.op === "viewport") {
          respond({ ok: true, result: options.viewport || { width: 800, height: 600, dpr: 2 } });
          return;
        }
        respond({ ok: true, result: {} });
      },
      onCreated: { addListener: addTo("tabs") },
      onRemoved: { addListener: addTo("tabs") },
      onActivated: { addListener: addTo("tabs") },
      onMoved: { addListener: addTo("tabs") },
      onUpdated: { addListener: addTo("tabs") },
    },
    windows: { onRemoved: { addListener: addTo("windows") } },
    debugger: {
      attach: async () => undefined,
      detach: async () => undefined,
      sendCommand: async () => ({}),
      onEvent: { addListener: addTo("debuggerEvent"), removeListener: () => undefined },
      onDetach: { addListener: addTo("debugger") },
    },
    storage: {
      local: {
        get: async (key) => (stored[key] ? { [key]: stored[key] } : {}),
        set: async (value) => Object.assign(stored, value),
        remove: async (key) => {
          delete stored[key];
        },
      },
    },
    scripting: {
      executeScript: async (injection) => {
        if (injection && injection.func === undefined) return [{ result: null }];
        if (options.injectionViewport) return [{ result: options.injectionViewport }];
        return [{ result: null }];
      },
    },
    cookies: options.cookies || { getAll: async () => [], set: async () => null, remove: async () => null },
    downloads: { search: async () => [] },
  };

  return { listeners, sent, stored, chrome, FakeSocket, tab, created, tabsById };
}

async function boot(options = {}) {
  const harness = createHarness(options);
  globalThis.chrome = harness.chrome;
  globalThis.WebSocket = harness.FakeSocket;
  globalThis.fetch = async () => ({ blob: async () => new Blob([new Uint8Array([1])], { type: "image/jpeg" }) });
  globalThis.createImageBitmap = async () => ({
    width: options.bitmapWidth || 1600,
    height: options.bitmapHeight || 1200,
    close: () => undefined,
  });

  await import(pathToFileURL(join(here, "..", "background.js")).href + "?case=" + Math.random());
  await new Promise((resolve) => setTimeout(resolve, 30));
  const socket = harness.FakeSocket.instances[0] || null;
  if (socket) {
    socket.readyState = harness.FakeSocket.OPEN;
    socket.emit("open", {});
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return { ...harness, socket };
}

function call(socket, sent, tool, args) {
  const id = "call-" + Math.random().toString(36).slice(2);
  sent.length = 0;
  socket.emit("message", { data: JSON.stringify({ type: "call", id, tool, args }) });
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const frame = sent.find((item) => item.type === "result" && item.id === id);
      if (frame) {
        clearInterval(timer);
        resolve(frame);
        return;
      }
      if (Date.now() - started > 2500) {
        clearInterval(timer);
        resolve({ timeout: true });
      }
    }, 5);
  });
}

function frames(sent) {
  return sent.filter((item) => item.type === "event" && item.event === "frame");
}

test("a dpr 2 capture reports CSS pixels of the viewport", async () => {
  const context = await boot({ viewport: { width: 800, height: 600, dpr: 2 }, bitmapWidth: 1600, bitmapHeight: 1200 });
  await call(context.socket, context.sent, "local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const captured = frames(context.sent);
  assert.equal(captured.length >= 1, true, "the viewer must emit at least one frame");
  assert.equal(captured[0].data.width, 800);
  assert.equal(captured[0].data.height, 600);
  await call(context.socket, context.sent, "local_browser_viewer", { op: "stop" });
});

test("opening a url uses a fresh tab instead of the tab the user is looking at", async () => {
  const context = await boot();
  const result = await call(context.socket, context.sent, "local_browser_open", { url: "https://example.test/page" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(context.created.length, 1, "a new tab must be created");
  assert.equal(context.created[0].url, "https://example.test/page");
  assert.equal(context.tabsById.get(7).url, "https://p.test/", "the focused tab keeps its url");
});

test("navigate refuses the tab the user is looking at and names the way out", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://app.test/x", active: true, status: "complete" });
  const result = await call(context.socket, context.sent, "local_browser_navigate", { tabId: 8, url: "https://elsewhere.test" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_navigation_blocked");
  assert.match(result.error.message, /tab the user is looking at/);
  assert.match(result.error.hint, /local_browser_open/);
  assert.equal(context.tabsById.get(8).url, "https://app.test/x", "the tab keeps its url");
});

test("navigate refuses the Paperclip tab even when it is not focused", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(55, { id: 55, windowId: 1, title: "P", url: "https://p.test/apps", active: false, status: "complete" });
  context.tabsById.set(56, { id: 56, windowId: 1, title: "O", url: "https://other.test/", active: true, status: "complete" });
  const result = await call(context.socket, context.sent, "local_browser_navigate", { tabId: 55, url: "https://elsewhere.test" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_navigation_blocked");
  assert.match(result.error.message, /belongs to Paperclip/);
  assert.equal(context.tabsById.get(55).url, "https://p.test/apps");
});

test("screenshotting a background tab never brings it to the front", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://user.test/", active: true, status: "complete" });
  const updates = [];
  context.chrome.tabs.update = async (id, props) => {
    updates.push({ id, props });
    return { ...context.tabsById.get(id), ...props };
  };
  const result = await call(context.socket, context.sent, "local_browser_screenshot", { tabId: 7 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(
    updates.some((entry) => entry.props && entry.props.active === true),
    false,
    "no call may activate a tab",
  );
  assert.equal(context.tabsById.get(8).active, true, "the user tab keeps focus");
});

test("a viewer frame on a background tab leaves focus alone", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://user.test/", active: true, status: "complete" });
  const updates = [];
  context.chrome.tabs.update = async (id, props) => {
    updates.push({ id, props });
    return { ...context.tabsById.get(id), ...props };
  };
  await call(context.socket, context.sent, "local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await call(context.socket, context.sent, "local_browser_viewer", { op: "stop" });
  assert.equal(
    updates.some((entry) => entry.props && entry.props.active === true),
    false,
    "the viewer must not activate the watched tab",
  );
});

test("opening a second url reuses the agent tab instead of piling up tabs", async () => {
  const context = await boot();
  await call(context.socket, context.sent, "local_browser_open", { url: "https://example.test/one" });
  await call(context.socket, context.sent, "local_browser_open", { url: "https://example.test/two" });
  assert.equal(context.created.length, 1, "one agent tab serves every open");
  assert.equal(context.tabsById.get(99).url, "https://example.test/two");
});

test("a tab the agent opened stays navigable", async () => {
  const context = await boot();
  const opened = await call(context.socket, context.sent, "local_browser_open", { url: "https://example.test/page" });
  assert.equal(opened.ok, true, JSON.stringify(opened.error || {}));
  const moved = await call(context.socket, context.sent, "local_browser_navigate", { tabId: 99, url: "https://example.test/next" });
  assert.equal(moved.ok, true, JSON.stringify(moved.error || {}));
  assert.equal(context.tabsById.get(99).url, "https://example.test/next");
});

test("a revoked site access answers with the grant hint instead of a raw browser error", async () => {
  const context = await boot();
  context.chrome.scripting.executeScript = async () => {
    throw new Error(
      'Cannot access contents of url "https://bank.test/". Extension manifest must request permission to access this host.',
    );
  };
  const result = await call(context.socket, context.sent, "local_browser_evaluate", {
    tabId: 7,
    expression: "document.title",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_origin_denied");
  assert.match(result.error.hint, /site access/i);
  assert.equal(/Cannot access contents/.test(result.error.message), false);
});

test("an unanswerable viewport rpc falls back to the page and still reports CSS pixels", async () => {
  const context = await boot({
    viewportRpcFails: true,
    injectionViewport: { width: 800, height: 600, dpr: 2 },
    bitmapWidth: 1600,
    bitmapHeight: 1200,
  });
  await call(context.socket, context.sent, "local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const captured = frames(context.sent);
  assert.equal(captured.length >= 1, true, "the viewer must emit at least one frame");
  assert.equal(captured[0].data.width, 800, "must not advertise the 1600px device-pixel width");
  assert.equal(captured[0].data.height, 600);
  await call(context.socket, context.sent, "local_browser_viewer", { op: "stop" });
});

test("a wrong dpr is corrected by the viewport instead of scaling takeover coordinates", async () => {
  const context = await boot({ viewport: { width: 800, height: 600, dpr: 1 }, bitmapWidth: 1600, bitmapHeight: 1200 });
  await call(context.socket, context.sent, "local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const captured = frames(context.sent);
  assert.equal(captured.length >= 1, true);
  assert.equal(captured[0].data.width, 800);
  assert.equal(captured[0].data.height, 600);
  await call(context.socket, context.sent, "local_browser_viewer", { op: "stop" });
});

test("an untrusted injected viewport that lies is refused instead of mislabelling the frame", async () => {
  const context = await boot({
    viewportRpcFails: true,
    injectionViewport: { width: 1600, height: 1200, dpr: 1 },
    bitmapWidth: 1600,
    bitmapHeight: 1200,
  });
  await call(context.socket, context.sent, "local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 400));

  const captured = frames(context.sent);
  assert.equal(captured.length, 0, "a page must not be able to choose the coordinate space of the frame");
  const states = context.sent.filter((item) => item.type === "event" && item.event === "state");
  assert.equal(states.length >= 1, true);
  assert.equal(states[states.length - 1].data.state, "viewer_unavailable");
  assert.match(String(states[states.length - 1].data.message), /viewport/i);
  await call(context.socket, context.sent, "local_browser_viewer", { op: "stop" });
});

test("an honest injected viewport still produces a correctly labelled frame", async () => {
  const context = await boot({
    viewportRpcFails: true,
    injectionViewport: { width: 800, height: 600, dpr: 2 },
    bitmapWidth: 1600,
    bitmapHeight: 1200,
  });
  await call(context.socket, context.sent, "local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 400));

  const captured = frames(context.sent);
  assert.equal(captured.length >= 1, true);
  assert.equal(captured[0].data.width, 800);
  assert.equal(captured[0].data.height, 600);
  await call(context.socket, context.sent, "local_browser_viewer", { op: "stop" });
});

test("close 1008 retires the pairing and never reconnects", async () => {
  const context = await boot({});
  const before = context.FakeSocket.instances.length;
  context.socket.emit("close", { code: 1008, reason: "session token is not usable" });
  await new Promise((resolve) => setTimeout(resolve, 1400));

  assert.equal(context.FakeSocket.instances.length, before, "no reconnect attempt may be made");
  assert.equal(context.stored["lb.pairing"].sessionToken, null);
  assert.equal(context.stored["lb.pairing"].sessionId, null);
  assert.equal(context.stored["lb.pairing"].origin, "https://p.test", "the origin is kept so the user can re-pair");
  assert.equal(context.stored["lb.pairing"].label, "Test browser");

  const status = await new Promise((resolve) => {
    for (const listener of context.listeners.message) {
      const returned = listener({ type: "lb:status" }, {}, resolve);
      if (returned === true) return;
    }
    resolve(null);
  });
  assert.equal(status.paired, false, "the popup must report Not paired");
  assert.equal(status.connected, false);
  assert.match(status.retiredReason, /token is not usable/);
});

test("a retired pairing does not reconnect after a service-worker restart", async () => {
  const first = await boot({});
  assert.notEqual(first.socket, null, "the seeded pairing must connect once");
  first.socket.emit("close", { code: 1008, reason: "session token is not usable" });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const retiredRecord = { ...first.stored["lb.pairing"] };
  assert.equal(retiredRecord.sessionToken, null);
  assert.equal(typeof retiredRecord.retiredAt, "string");

  const socketsBefore = first.FakeSocket.instances.length;
  const second = await boot({ seed: retiredRecord });
  if (second.socket) second.socket.emit("close", { code: 1006, reason: "" });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  assert.equal(
    second.FakeSocket.instances.length,
    0,
    "a fresh worker must not open a socket for a retired pairing",
  );
  assert.ok(socketsBefore >= 1);

  const status = await new Promise((resolve) => {
    for (const listener of second.listeners.message) {
      const returned = listener({ type: "lb:status" }, {}, resolve);
      if (returned === true) return;
    }
    resolve(null);
  });
  assert.equal(status.paired, false);
  assert.match(status.retiredReason, /token is not usable/, "the reason must survive the restart");
});

function retiredSeed() {
  return {
    origin: "https://p.test",
    label: "Test browser",
    sessionToken: null,
    sessionId: null,
    code: null,
    tier: null,
    allowedOrigins: [],
    pairedAt: "2026-01-01T00:00:00.000Z",
    retiredAt: "2026-01-02T00:00:00.000Z",
    retiredReason: "session token is not usable",
  };
}

function askStatus(context) {
  return new Promise((resolve) => {
    for (const listener of context.listeners.message) {
      const returned = listener({ type: "lb:status" }, {}, resolve);
      if (returned === true) return;
    }
    resolve(null);
  });
}

function askReconnect(context) {
  return new Promise((resolve) => {
    for (const listener of context.listeners.message) {
      const returned = listener({ type: "lb:reconnect" }, {}, resolve);
      if (returned === true) return;
    }
    resolve(null);
  });
}

test("reconnect on a retired pairing is refused and keeps the reason", async () => {
  const context = await boot({ seed: retiredSeed() });
  const before = context.FakeSocket.instances.length;
  assert.equal(before, 0, "a retired pairing must not connect on boot");

  const answer = await askReconnect(context);
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(context.FakeSocket.instances.length, 0, "reconnect must not open a socket without a credential");
  assert.equal(answer.paired, false);
  assert.match(
    String(answer.retiredReason || ""),
    /token is not usable/,
    "reconnect must not erase why the session ended",
  );
  assert.equal(context.stored["lb.pairing"].sessionToken, null);
});

test("close 1006 still reconnects", async () => {
  const context = await boot({});
  const before = context.FakeSocket.instances.length;
  context.socket.emit("close", { code: 1006, reason: "" });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.ok(context.FakeSocket.instances.length > before, "a network drop must schedule a reconnect");
  assert.equal(context.stored["lb.pairing"].sessionToken, "tok-1", "a network drop must not discard the token");
});
