import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
export const contract = JSON.parse(readFileSync(root + "lib/protocol.contract.json", "utf8"));

export const ALL_OPTIONAL = contract.permissions.filter((entry) => entry.firefox === "optional").map((entry) => entry.id);
export const REQUIRED = contract.permissions.filter((entry) => entry.firefox === "required").map((entry) => entry.id);

export function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function flush(rounds = 8) {
  let chain = Promise.resolve();
  for (let index = 0; index < rounds; index += 1) chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  return chain;
}

export function event() {
  const listeners = [];
  return {
    listeners,
    addListener(fn, ...rest) {
      listeners.push({ fn, rest });
    },
    removeListener(fn) {
      const index = listeners.findIndex((entry) => entry.fn === fn);
      if (index !== -1) listeners.splice(index, 1);
    },
    hasListener(fn) {
      return listeners.some((entry) => entry.fn === fn);
    },
    fire(...args) {
      return listeners.slice().map((entry) => entry.fn(...args));
    },
  };
}

export function createClock() {
  let now = 1_700_000_000_000;
  let seq = 1;
  const timers = new Map();

  function schedule(fn, delay, repeat) {
    const id = seq;
    seq += 1;
    timers.set(id, { fn, at: now + Math.max(0, delay || 0), repeat: repeat ? Math.max(1, delay || 1) : null });
    return id;
  }

  return {
    now: () => now,
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const target = now + ms;
      for (let guard = 0; guard < 100000; guard += 1) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, timer] of timers) {
          if (timer.at < nextAt) {
            nextAt = timer.at;
            nextId = id;
          }
        }
        if (nextId === null || nextAt > target) break;
        now = nextAt;
        const timer = timers.get(nextId);
        if (timer.repeat === null) timers.delete(nextId);
        else timer.at = now + timer.repeat;
        timer.fn();
      }
      now = target;
    },
  };
}

function defaultTab(overrides = {}) {
  return {
    id: 7,
    windowId: 1,
    title: "Example",
    url: "https://example.test/",
    active: true,
    status: "complete",
    cookieStoreId: "firefox-default",
    incognito: false,
    discarded: false,
    pinned: false,
    audible: false,
    ...overrides,
  };
}

export function bootBackground(options = {}) {
  const clock = options.clock ? createClock() : null;
  const calls = [];
  const sockets = [];
  const store = new Map(Object.entries(options.storage || {}));
  const granted = {
    permissions: new Set(options.permissions ?? [...REQUIRED, ...ALL_OPTIONAL.filter((id) => id !== "<all_urls>")]),
    origins: new Set(options.origins ?? ["<all_urls>"]),
  };
  const tabs = new Map((options.tabs || [defaultTab()]).map((tab) => [tab.id, defaultTab(tab)]));
  const windows = new Map((options.windows || [{ id: 1, incognito: false, type: "normal" }]).map((win) => [win.id, win]));
  const containers = options.containers || [
    { cookieStoreId: "firefox-container-1", name: "Work", color: "blue", icon: "briefcase" },
  ];
  const cookieJar = options.cookies || [];
  let nextTabId = 100;
  let nextWindowId = 50;

  function record(name, ...args) {
    calls.push([name, ...args]);
  }

  function has(query) {
    return (query.permissions || []).every((id) => granted.permissions.has(id)) && (query.origins || []).every((id) => granted.origins.has(id));
  }

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(payload) {
      this.sent.push(JSON.parse(payload));
    }
    close(code, reason) {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: typeof code === "number" ? code : 1006, reason: reason || "" });
    }
    open() {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    deliver(frame) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) });
    }
  }
  FakeSocket.OPEN = 1;

  const storageChanged = event();
  const permissionsEvents = { onAdded: event(), onRemoved: event() };
  const webRequest = {
    onBeforeRequest: event(),
    onBeforeSendHeaders: event(),
    onHeadersReceived: event(),
    onCompleted: event(),
    onErrorOccurred: event(),
    filterResponseData(requestId) {
      record("webRequest.filterResponseData", requestId);
      const filter = { write() {}, close() {}, disconnect() {} };
      if (options.onFilter) options.onFilter(requestId, filter);
      return filter;
    },
  };

  const content = options.content || ((message) => ({ ok: true, result: { ok: true, url: "https://example.test/", title: "Example" } }));

  const browser = {
    runtime: {
      id: "local-browser@paperclip.app",
      getManifest: () => manifest,
      getURL: (file) => "moz-extension://uuid/" + String(file).replace(/^\//, ""),
      getPlatformInfo: async () => ({ os: "linux" }),
      onMessage: event(),
      onStartup: event(),
      onInstalled: event(),
      sendMessage: async (message) => {
        record("runtime.sendMessage", message);
        return undefined;
      },
    },
    permissions: {
      ...permissionsEvents,
      contains: async (query) => has(query),
      getAll: async () => ({ permissions: [...granted.permissions], origins: [...granted.origins] }),
      request: async (query) => {
        record("permissions.request", query);
        return false;
      },
      remove: async (query) => {
        for (const id of query.permissions || []) granted.permissions.delete(id);
        for (const id of query.origins || []) granted.origins.delete(id);
        permissionsEvents.onRemoved.fire(query);
        return true;
      },
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return store.has(key) ? { [key]: structuredClone(store.get(key)) } : {};
          if (Array.isArray(key)) return Object.fromEntries(key.filter((name) => store.has(name)).map((name) => [name, structuredClone(store.get(name))]));
          return Object.fromEntries([...store.entries()].map(([name, value]) => [name, structuredClone(value)]));
        },
        async set(values) {
          const changes = {};
          for (const [name, value] of Object.entries(values)) {
            changes[name] = { oldValue: store.get(name), newValue: structuredClone(value) };
            store.set(name, structuredClone(value));
          }
          storageChanged.fire(changes, "local");
        },
        async remove(key) {
          const names = Array.isArray(key) ? key : [key];
          const changes = {};
          for (const name of names) {
            changes[name] = { oldValue: store.get(name) };
            store.delete(name);
          }
          storageChanged.fire(changes, "local");
        },
      },
      onChanged: storageChanged,
    },
    browserAction: {
      setBadgeText: async (details) => record("badge.text", details.text),
      setBadgeBackgroundColor: async (details) => record("badge.color", details.color),
      setTitle: async (details) => record("badge.title", details.title),
    },
    notifications: {
      onClicked: event(),
      create: async (id, details) => {
        record("notifications.create", id, details);
        return id;
      },
      clear: async () => true,
    },
    extension: {
      isAllowedIncognitoAccess: async () => options.privateAllowed === true,
    },
    contextualIdentities: {
      onCreated: event(),
      onUpdated: event(),
      onRemoved: event(),
      query: async () => containers.map((entry) => ({ ...entry })),
      get: async (id) => {
        const found = containers.find((entry) => entry.cookieStoreId === id);
        if (!found) throw new Error("Invalid contextual identity: " + id);
        return { ...found };
      },
    },
    tabs: {
      onCreated: event(),
      onRemoved: event(),
      onUpdated: event(),
      onActivated: event(),
      async query(query = {}) {
        record("tabs.query", query);
        let list = [...tabs.values()];
        if (query.active === true) list = list.filter((tab) => tab.active);
        if (typeof query.windowId === "number") list = list.filter((tab) => tab.windowId === query.windowId);
        if (typeof query.url === "string") list = list.filter((tab) => tab.url.startsWith(query.url.replace(/\*$/, "")));
        return list.map((tab) => ({ ...tab }));
      },
      async get(id) {
        const tab = tabs.get(id);
        if (!tab) throw new Error("Invalid tab ID: " + id);
        return { ...tab };
      },
      async create(props) {
        record("tabs.create", props);
        const tab = defaultTab({
          id: nextTabId++,
          url: props.url || "about:blank",
          active: props.active === true,
          windowId: typeof props.windowId === "number" ? props.windowId : 1,
          cookieStoreId: props.cookieStoreId || (windows.get(props.windowId)?.incognito ? "firefox-private" : "firefox-default"),
          incognito: Boolean(windows.get(props.windowId)?.incognito),
        });
        tabs.set(tab.id, tab);
        return { ...tab };
      },
      async update(id, props) {
        record("tabs.update", id, props);
        const tab = tabs.get(id);
        if (tab) Object.assign(tab, props.url ? { url: props.url } : {}, props.active ? { active: true } : {});
        return tab ? { ...tab } : { id, ...props };
      },
      async remove(id) {
        record("tabs.remove", id);
        tabs.delete(id);
      },
      goBack: async (id) => record("tabs.goBack", id),
      goForward: async (id) => record("tabs.goForward", id),
      reload: async (id) => record("tabs.reload", id),
      async sendMessage(tabId, message) {
        record("tabs.sendMessage", tabId, message.op, message.args);
        return content(message, tabId);
      },
      async executeScript(tabId, details) {
        record("tabs.executeScript", tabId, details);
        if (options.executeScript) return options.executeScript(tabId, details);
        return [null];
      },
      captureVisibleTab: async () => "data:image/png;base64,AAAA",
    },
    windows: {
      async getAll() {
        return [...windows.values()].map((win) => ({ ...win }));
      },
      async create(props) {
        record("windows.create", props);
        const id = nextWindowId++;
        windows.set(id, { id, incognito: props.incognito === true, type: "normal" });
        const tab = defaultTab({
          id: nextTabId++,
          windowId: id,
          url: props.url || "about:blank",
          active: true,
          incognito: props.incognito === true,
          cookieStoreId: props.incognito ? "firefox-private" : props.cookieStoreId || "firefox-default",
        });
        tabs.set(tab.id, tab);
        return { id, incognito: props.incognito === true, tabs: [{ ...tab }] };
      },
      update: async (id, props) => {
        record("windows.update", id, props);
        return { id };
      },
    },
    webRequest,
    cookies: {
      async getAll(query) {
        record("cookies.getAll", query);
        if (options.getAllCookies) return options.getAllCookies(query);
        return cookieJar.map((cookie) => ({ ...cookie }));
      },
      async set(details) {
        record("cookies.set", details);
        if (options.setCookie) return options.setCookie(details);
        return { name: details.name, value: details.value, domain: details.domain || "example.test", path: details.path || "/", secure: details.secure === true, httpOnly: details.httpOnly === true, sameSite: details.sameSite || "no_restriction", session: details.expirationDate === undefined, hostOnly: !details.domain, storeId: details.storeId || "firefox-default", expirationDate: details.expirationDate };
      },
      async remove(details) {
        record("cookies.remove", details);
        if (options.removeCookie) return options.removeCookie(details);
        return { name: details.name };
      },
    },
    downloads: { search: async (query) => (record("downloads.search", query), options.downloads || []) },
    scripting: { executeScript: async () => [{ result: { value: 1, type: "number" } }] },
    history: { search: async (query) => (record("history.search", query), [{ url: "https://example.test/", title: "Example", visitCount: 3 }]) },
    profiles: { getProfileName: async () => "work" },
  };
  if (options.browser) options.browser(browser);

  const sandbox = {
    browser,
    console,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    TextEncoder,
    structuredClone,
    btoa,
    atob,
    WebSocket: FakeSocket,
    fetch: async () => {
      throw new Error("offline");
    },
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    setTimeout: clock ? clock.setTimeout : setTimeout,
    clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    setInterval: clock ? clock.setInterval : setInterval,
    clearInterval: clock ? clock.clearInterval : clearInterval,
  };
  if (clock) {
    sandbox.Date = class FakeDate extends Date {
      constructor(...args) {
        if (args.length === 0) super(clock.now());
        else super(...args);
      }
      static now() {
        return clock.now();
      }
    };
  }
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of manifest.background.scripts) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }

  return {
    sandbox,
    LB: sandbox.LB,
    browser,
    clock,
    calls,
    sockets,
    store,
    tabs,
    windows,
    granted,
    webRequest,
    callsOf: (name) => calls.filter((entry) => entry[0] === name),
    grant(ids) {
      for (const id of ids) {
        if (id === "<all_urls>") granted.origins.add(id);
        else granted.permissions.add(id);
      }
      const query = { permissions: ids.filter((id) => id !== "<all_urls>"), origins: ids.filter((id) => id === "<all_urls>") };
      permissionsEvents.onAdded.fire(query);
    },
    revoke(ids) {
      for (const id of ids) {
        if (id === "<all_urls>") granted.origins.delete(id);
        else granted.permissions.delete(id);
      }
      const query = { permissions: ids.filter((id) => id !== "<all_urls>"), origins: ids.filter((id) => id === "<all_urls>") };
      permissionsEvents.onRemoved.fire(query);
    },
    async call(tool, args = {}, budgetMs) {
      try {
        return { ok: true, result: plain(await sandbox.LB.tools.dispatch(tool, args, { sessionId: "s", clientVersion: "1.1.0", label: "Firefox", tier: "refine", budgetMs: budgetMs ?? 30000, deadline: Date.now() + (budgetMs ?? 30000) })) };
      } catch (error) {
        return { ok: false, error: plain(error) };
      }
    },
    control(message) {
      return sandbox.LB.bridge.control(message).then(plain);
    },
  };
}

export async function pairAndAck(harness, ack = {}) {
  const { sandbox, sockets } = harness;
  await flush();
  await sandbox.LB.bridge.pair({ origin: "https://app.example", code: "ABC12345", label: "Work" });
  const socket = sockets[sockets.length - 1];
  socket.open();
  await flush();
  socket.deliver({
    type: "hello_ack",
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionToken: "tok",
    tier: "refine",
    allowedOrigins: [],
    ...ack,
  });
  await flush();
  if (harness.clock) harness.clock.advance(1);
  return socket;
}

const runDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (runDirectly) test("the harness boots every background script of the manifest", async () => {
  const harness = bootBackground();
  await flush();
  for (const name of ["contract", "ext", "access", "guards", "headers", "apiCall", "protocol", "network", "tabs", "cookies", "tools", "bridge", "background"]) {
    assert.ok(harness.LB[name], "LB." + name + " is missing after boot");
  }
});
