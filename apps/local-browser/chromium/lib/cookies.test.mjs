import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const tab = { id: 7, url: "https://app.test/dashboard", active: true, title: "App", status: "complete" };

after(() => {
  setTimeout(() => process.exit(0), 50);
});

async function boot(options = {}) {
  const calls = { getAll: [], set: [], remove: [] };
  const jar = [];
  const refusedRemovals = new Set();
  const listeners = { message: [] };

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
    }
  }

  const sent = [];
  const stored = {
    "lb.pairing": {
      origin: "https://p.test",
      label: "Test browser",
      sessionToken: "tok-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      tier: "full",
      allowedOrigins: [],
    },
  };

  const cookies = {
    getAll: async (query) => {
      calls.getAll.push(query);
      return jar.map((cookie) => ({ ...cookie }));
    },
    set: async (details) => {
      calls.set.push(details);
      const cookie = {
        name: details.name,
        value: details.value,
        domain: details.domain || new URL(details.url).hostname,
        path: details.path || "/",
        secure: details.secure === true,
        httpOnly: details.httpOnly === true,
        session: details.expirationDate === undefined,
        sameSite: details.sameSite || "unspecified",
        storeId: details.storeId || "0",
      };
      if (details.expirationDate !== undefined) cookie.expirationDate = details.expirationDate;
      return cookie;
    },
    remove: async (details) => {
      calls.remove.push(details);
      return refusedRemovals.has(details.name) ? null : { url: details.url, name: details.name };
    },
  };

  const chrome = {
    runtime: {
      getManifest: () => ({ version: "1.0.8" }),
      getPlatformInfo: async () => ({ os: "linux" }),
      sendMessage: async () => undefined,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onStartup: { addListener: () => undefined },
      onInstalled: { addListener: () => undefined },
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
    alarms: { create: () => Promise.resolve(), onAlarm: { addListener: () => undefined } },
    tabs: {
      query: async () => [tab],
      get: async (id) => (id === tab.id ? { ...tab } : null),
      update: async (id, props) => ({ ...tab, ...props }),
      create: async (props) => ({ ...tab, id: 99, url: props.url }),
      captureVisibleTab: async () => "data:image/jpeg;base64,AA",
      sendMessage: (_tabId, _payload, opts, callback) => {
        const respond = typeof opts === "function" ? opts : callback;
        respond({ ok: true, result: { width: 800, height: 600, dpr: 1 } });
      },
      onCreated: { addListener: () => undefined },
      onRemoved: { addListener: () => undefined },
      onActivated: { addListener: () => undefined },
      onMoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
    },
    windows: { onRemoved: { addListener: () => undefined } },
    debugger: {
      attach: async () => undefined,
      detach: async () => undefined,
      sendCommand: async () => ({}),
      onEvent: { addListener: () => undefined, removeListener: () => undefined },
      onDetach: { addListener: () => undefined },
    },
    scripting: { executeScript: async () => [{ result: { width: 800, height: 600, dpr: 1 } }] },
    cookies,
    downloads: { search: async () => [] },
    permissions: { contains: async () => options.siteAccess !== "limited", request: async () => true },
  };

  globalThis.chrome = chrome;
  globalThis.WebSocket = FakeSocket;
  globalThis.fetch = async () => ({ blob: async () => new Blob([new Uint8Array([1])], { type: "image/jpeg" }) });
  globalThis.createImageBitmap = async () => ({ width: 800, height: 600, close: () => undefined });
  FakeSocket.instances = [];
  await import(pathToFileURL(join(here, "..", "background.js")).href + "?case=" + Math.random());
  await new Promise((resolve) => setTimeout(resolve, 30));
  const socket = FakeSocket.instances[0];
  socket.readyState = FakeSocket.OPEN;
  socket.emit("open", {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { socket, sent, calls, jar, refusedRemovals, cookies };
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
      if (Date.now() - started > 3000) {
        clearInterval(timer);
        resolve({ timeout: true });
      }
    }, 5);
  });
}

test("reading cookies by url is scoped to that url", async () => {
  const h = await boot();
  h.jar.push({ name: "sid", value: "abc", domain: "app.test", path: "/", secure: true, httpOnly: true, session: true, sameSite: "lax", storeId: "0" });
  const result = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "get" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(h.calls.getAll[0]), { url: tab.url });
  assert.equal(result.result.cookies.length, 1);
  assert.equal(result.result.cookies[0].httpOnly, true);
});

test("reading by domain reaches subdomains without a tab url", async () => {
  const h = await boot();
  await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "get", domain: ".example.com", name: "sid" });
  assert.deepEqual(plain(h.calls.getAll[0]), { domain: "example.com", name: "sid" });
});

test("reading the whole jar honours a cookie store and a name filter", async () => {
  const h = await boot();
  await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "get", allDomains: true, storeId: "2", name: "sid" });
  assert.deepEqual(plain(h.calls.getAll[0]), { storeId: "2", name: "sid" });
});

test("a per-entry domain and path drive the write url", async () => {
  const h = await boot();
  await call(h.socket, h.sent, "local_browser_storage", {
    kind: "cookies",
    op: "set",
    url: "https://app.test/",
    entries: [
      { name: "a", value: "1", domain: ".other.test", path: "/deep" },
      { name: "b", value: "2", path: "/elsewhere" },
    ],
  });
  assert.deepEqual(plain(h.calls.set.map((entry) => entry.url)), ["https://other.test/deep", "https://app.test/elsewhere"]);
});

test("writing keeps every cookie attribute and derives the url from the domain", async () => {
  const h = await boot();
  const result = await call(h.socket, h.sent, "local_browser_storage", {
    kind: "cookies",
    op: "set",
    domain: "app.test",
    entries: [{ name: "sid", value: "v", domain: ".app.test", path: "/admin", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 1893456000, storeId: "3" }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(h.calls.set[0]), {
    url: "https://app.test/admin",
    name: "sid",
    value: "v",
    storeId: "3",
    domain: ".app.test",
    path: "/admin",
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    expirationDate: 1893456000,
  });
  assert.equal(result.result.count, 1);
});

test("clearing removes each cookie through its own domain, path and store", async () => {
  const h = await boot();
  h.jar.push(
    { name: "parent", value: "1", domain: ".app.test", path: "/", secure: true, storeId: "0" },
    { name: "scoped", value: "2", domain: "app.test", path: "/admin", secure: false, storeId: "0" },
  );
  const result = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "clear" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(h.calls.remove.map((entry) => entry.url)), ["https://app.test/", "http://app.test/admin"]);
  assert.deepEqual(plain(h.calls.remove.map((entry) => entry.storeId)), ["0", "0"]);
  assert.equal(result.result.count, 2);
  assert.equal(result.result.matched, 2);
});

test("a call-level domain and store apply to entries that name neither", async () => {
  const h = await boot();
  const result = await call(h.socket, h.sent, "local_browser_storage", {
    kind: "cookies",
    op: "set",
    domain: ".app.test",
    storeId: "7",
    entries: [{ name: "a", value: "1" }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(h.calls.set[0].domain, ".app.test");
  assert.equal(h.calls.set[0].storeId, "7");
  assert.equal(h.calls.set[0].url, "https://app.test/");
});

test("a get caps the list and reports the total", async () => {
  const h = await boot();
  for (const name of ["a", "b", "c"]) h.jar.push({ name, value: "v", domain: "app.test", path: "/", secure: true, storeId: "0" });
  const result = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "get", domain: "app.test", limit: 2 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.cookies.length, 2);
  assert.equal(result.result.total, 3);
});

test("a whole-jar clear needs a name or an explicit confirmation", async () => {
  const h = await boot();
  for (let index = 0; index < 60; index += 1) h.jar.push({ name: "c" + index, value: "v", domain: "site" + index + ".test", path: "/", secure: true, storeId: "0" });
  const refused = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "clear", allDomains: true });
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /Refusing to clear 60 cookies/);
  assert.equal(h.calls.remove.length, 0);
  const confirmed = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "clear", allDomains: true, confirmAll: true });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error || {}));
  assert.equal(h.calls.remove.length, 60);
});

test("a host-permission refusal explains how to grant site access", async () => {
  const h = await boot();
  h.cookies.set = async () => {
    throw new Error('No host permissions for cookies at url: "https://app.test/".');
  };
  const result = await call(h.socket, h.sent, "local_browser_storage", {
    kind: "cookies",
    op: "set",
    url: "https://app.test/",
    entries: [{ name: "a", value: "1" }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(result.result.failed), ["a"]);
  assert.match(result.result.note, /Allow all sites/);
});

test("a jar-wide read without site access says so instead of returning nothing", async () => {
  const h = await boot({ siteAccess: "limited" });
  const result = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "get", allDomains: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_origin_denied");
  assert.match(result.error.message, /needs site access/);
});

test("a jar-wide read does not need a reachable tab", async () => {
  const h = await boot();
  h.jar.push({ name: "sid", value: "v", domain: "app.test", path: "/", secure: true, storeId: "0" });
  const result = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "get", allDomains: true, tabId: 999 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.cookies.length, 1);
});

test("a refused removal is reported, not counted as cleared", async () => {
  const h = await boot();
  h.jar.push({ name: "stuck", value: "1", domain: "app.test", path: "/", secure: true, storeId: "0" });
  h.refusedRemovals.add("stuck");
  const result = await call(h.socket, h.sent, "local_browser_storage", { kind: "cookies", op: "clear", name: "stuck" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.count, 0);
  assert.deepEqual(plain(result.result.failed), ["stuck"]);
});
