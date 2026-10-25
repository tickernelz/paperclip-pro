import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createFakeApi, event, flush } from "../../shared/lib/test-ext.mjs";

export const backgroundDir = path.dirname(fileURLToPath(import.meta.url));
export const chromiumDir = path.join(backgroundDir, "..");
export const manifest = JSON.parse(readFileSync(path.join(chromiumDir, "manifest.json"), "utf8"));
export { event, flush };

export const plain = (value) => JSON.parse(JSON.stringify(value));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function backgroundFiles() {
  const index = readFileSync(path.join(backgroundDir, "index.js"), "utf8");
  return [...index.matchAll(/^import "([^"]+)";$/gm)].map((match) => path.relative(chromiumDir, path.join(backgroundDir, match[1])));
}

export function everyPermission() {
  return {
    permissions: [...manifest.permissions, ...manifest.optional_permissions],
    origins: [...manifest.optional_host_permissions],
  };
}

export const PAIRED = {
  origin: "https://p.test",
  label: "Test browser",
  sessionToken: "tok-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
  tier: "full",
  allowedOrigins: [],
};

export const FAKE_DOCUMENT = {
  documentId: "doc-1",
  url: "https://p.test/",
  readyState: "complete",
  visibilityState: "visible",
  navigationType: "navigate",
  restoredFromBfcache: false,
  wasDiscarded: false,
  prerendering: false,
  loadedAt: 1,
  ageMs: 5,
  requestsSinceLoad: 3,
  xhrSinceLoad: 1,
  stale: false,
  staleReasons: [],
};

function unref(timer) {
  if (timer && typeof timer.unref === "function") timer.unref();
  return timer;
}

function createSocketClass(sent) {
  return class FakeSocket {
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
    emit(type, value) {
      for (const handler of this.handlers[type] || []) handler(value);
    }
    send(data) {
      sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.emit("close", { code: 1000, reason: "client closing" });
    }
  };
}

export function createChrome(options = {}) {
  const fake = createFakeApi({
    manifest,
    granted: options.granted || everyPermission(),
    storage: { "lb.pairing": options.seed === undefined ? PAIRED : options.seed, ...(options.storage || {}) },
  });
  const api = fake.api;
  const calls = fake.calls;
  const tab = { id: 7, windowId: 1, title: "T", url: "https://p.test/", active: true, status: "complete", ...(options.tab || {}) };
  const tabsById = new Map([[tab.id, tab]]);
  for (const extra of options.tabs || []) tabsById.set(extra.id, extra);
  const created = [];
  const rpcs = [];
  let nextId = 99;

  api.storage.local.remove = async (key) => {
    const changes = { [key]: { oldValue: fake.store[key] } };
    delete fake.store[key];
    api.storage.onChanged.fire(changes, "local");
  };
  api.runtime.onStartup = event();
  api.runtime.onInstalled = event();
  api.runtime.lastError = undefined;
  api.alarms = { create: () => Promise.resolve(), onAlarm: event() };
  api.extension = { isAllowedIncognitoAccess: async () => options.incognitoAllowed === true };

  function respond(callback, value, lastError) {
    api.runtime.lastError = lastError ? { message: lastError } : undefined;
    callback(value);
    api.runtime.lastError = undefined;
  }

  api.tabs = {
    query: async (query = {}) => {
      let all = [...tabsById.values()];
      if (typeof query.windowId === "number") all = all.filter((entry) => entry.windowId === query.windowId);
      if (typeof query.url === "string") all = all.filter((entry) => String(entry.url).startsWith(query.url.replace(/\*$/, "")));
      if (query.active === true) {
        const active = all.filter((entry) => entry.active);
        return (active.length ? active : all.slice(0, 1)).map((entry) => ({ ...entry }));
      }
      return all.map((entry) => ({ ...entry }));
    },
    get: async (id) => {
      if (!tabsById.has(id)) throw new Error("No tab with id: " + id);
      return { ...tabsById.get(id) };
    },
    update: async (id, props) => {
      calls.push(["tabs.update", id, props]);
      const next = { ...(tabsById.get(id) || tab), id, ...props };
      tabsById.set(id, next);
      return { ...next };
    },
    create: async (props) => {
      calls.push(["tabs.create", props]);
      const next = { ...tab, id: nextId++, url: props.url || "chrome://newtab/", active: props.active === true, status: "complete" };
      if (typeof props.windowId === "number") next.windowId = props.windowId;
      tabsById.set(next.id, next);
      created.push(next);
      return { ...next };
    },
    remove: async (id) => {
      tabsById.delete(id);
    },
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
    captureVisibleTab: async () => options.captureDataUrl || "data:image/jpeg;base64,AA",
    sendMessage: (tabId, payload, opts, callback) => {
      const done = typeof opts === "function" ? opts : callback;
      rpcs.push({ tabId, op: payload.op, args: payload.args });
      const custom = options.onRpc ? options.onRpc(payload, tabId) : undefined;
      if (custom === "hang") return;
      if (custom === "missing") {
        respond(done, undefined, "Could not establish connection. Receiving end does not exist.");
        return;
      }
      if (custom !== undefined) {
        Promise.resolve(custom).then((value) => respond(done, value));
        return;
      }
      if (options.viewportRpcFails) {
        respond(done, undefined);
        return;
      }
      if (payload.op === "viewport") {
        respond(done, { ok: true, result: options.viewport || { width: 800, height: 600, dpr: 2 } });
        return;
      }
      if (payload.op === "documentState") {
        respond(done, { ok: true, result: { ...FAKE_DOCUMENT } });
        return;
      }
      respond(done, { ok: true, result: {} });
    },
    onCreated: event(),
    onRemoved: event(),
    onActivated: event(),
    onMoved: event(),
    onUpdated: event(),
    onReplaced: event(),
  };
  api.windows = {
    ...api.windows,
    create: async (props) => {
      calls.push(["windows.create", props]);
      const windowId = 50 + created.length;
      const next = { ...tab, id: nextId++, windowId, url: props.url || "chrome://newtab/", incognito: props.incognito === true, active: true };
      tabsById.set(next.id, next);
      created.push(next);
      return { id: windowId, incognito: props.incognito === true, tabs: [{ ...next }] };
    },
    getAll: async () => options.windows || [{ id: 1, incognito: false }],
    onRemoved: event(),
  };
  api.debugger = {
    attach: async (target) => {
      calls.push(["debugger.attach", target.tabId]);
      if (options.debuggerRefuses) throw new Error("Another debugger is already attached");
    },
    detach: async (target) => {
      calls.push(["debugger.detach", target.tabId]);
    },
    sendCommand: async (target, method, params) => {
      calls.push(["debugger.sendCommand", target.tabId, method, params]);
      return options.onCommand ? (await options.onCommand(method, params, target)) || {} : {};
    },
    onEvent: event(),
    onDetach: event(),
  };
  api.scripting = {
    executeScript: async (injection) => {
      calls.push(["scripting.executeScript", injection.files || "func"]);
      if (options.executeScript) return await options.executeScript(injection);
      if (injection && injection.func === undefined) return [{ result: null }];
      if (options.injectionViewport) return [{ result: options.injectionViewport }];
      return [{ result: null }];
    },
  };
  api.cookies = options.cookies || {
    getAll: async () => [],
    set: async () => null,
    remove: async () => null,
    getAllCookieStores: async () => {
      const all = [...tabsById.values()];
      const stores = [{ id: "0", tabIds: all.filter((entry) => entry.incognito !== true).map((entry) => entry.id) }];
      const privateIds = all.filter((entry) => entry.incognito === true).map((entry) => entry.id);
      if (privateIds.length) stores.push({ id: "1", tabIds: privateIds });
      return stores;
    },
  };
  api.downloads = options.downloads || { search: async () => [] };
  api.webRequest = {
    onBeforeRequest: event(),
    onBeforeSendHeaders: event(),
    onHeadersReceived: event(),
    onCompleted: event(),
    onErrorOccurred: event(),
  };
  for (const name of Object.keys(api.webRequest)) {
    const target = api.webRequest[name];
    const add = target.addListener;
    target.extras = [];
    target.addListener = (fn, filter, extra) => {
      target.extras.push(extra);
      add(fn);
    };
  }
  if (options.withoutWebRequest) delete api.webRequest;
  api.history = { search: async (query) => [{ url: "https://h.test/", title: "H", text: query.text }] };
  return { ...fake, api, calls, tab, tabsById, created, rpcs };
}

export async function boot(options = {}) {
  const sent = [];
  const FakeSocket = createSocketClass(sent);
  const harness = createChrome(options);
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    Promise,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Error,
    TypeError,
    RegExp,
    Symbol,
    Object,
    Array,
    Number,
    String,
    Boolean,
    ArrayBuffer,
    Uint8Array,
    DataView,
    Blob,
    TextEncoder,
    TextDecoder,
    structuredClone,
    btoa,
    atob,
    navigator: { userAgent: "Chrome/130" },
    setTimeout: (...args) => unref(setTimeout(...args)),
    clearTimeout,
    setInterval: (...args) => unref(setInterval(...args)),
    clearInterval,
    WebSocket: FakeSocket,
    fetch: options.fetch || (async () => ({ blob: async () => new Blob([new Uint8Array([1])], { type: "image/jpeg" }) })),
    createImageBitmap: async () => ({ width: options.bitmapWidth || 1600, height: options.bitmapHeight || 1200, close: () => undefined }),
    chrome: harness.api,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of backgroundFiles()) {
    new vm.Script(readFileSync(path.join(chromiumDir, file), "utf8"), { filename: file }).runInContext(sandbox);
  }
  await sleep(30);
  const socket = FakeSocket.instances[0] || null;
  if (socket && options.open !== false) {
    socket.readyState = FakeSocket.OPEN;
    socket.emit("open", {});
    await sleep(30);
  }
  const context = { ...harness, sandbox, LB: sandbox.LB, FakeSocket, socket, sent, stored: harness.store };
  context.call = (tool, args = {}, extra = {}) => callTool(context, tool, args, extra);
  context.control = (op, payload = {}) => control(context, op, payload);
  return context;
}

export function callTool(context, tool, args, extra = {}) {
  const id = "call-" + Math.random().toString(36).slice(2);
  context.sent.length = 0;
  context.socket.emit("message", { data: JSON.stringify({ type: "call", id, tool, args, ...extra }) });
  const limit = extra.waitMs || 3000;
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const frame = context.sent.find((item) => item.type === "result" && item.id === id);
      if (frame) {
        clearInterval(timer);
        resolve(frame);
        return;
      }
      if (Date.now() - started > limit) {
        clearInterval(timer);
        resolve({ timeout: true });
      }
    }, 5);
  });
}

export function control(context, op, payload = {}) {
  return new Promise((resolve) => {
    const message = { ...payload, channel: "lb-control", op };
    for (const listener of context.api.runtime.onMessage.listeners) {
      const returned = listener(message, {}, (value) => resolve(plain(value)));
      if (returned === true) return;
    }
    resolve(null);
  });
}

export function frames(sent, name) {
  return sent.filter((item) => item.type === "event" && item.event === name);
}
