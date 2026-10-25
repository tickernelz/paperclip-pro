import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const libDir = path.dirname(fileURLToPath(import.meta.url));
export const sharedDir = path.join(libDir, "..");

export function event() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    },
    fire(...args) {
      for (const fn of listeners.slice()) fn(...args);
    },
  };
}

export function chromiumManifest() {
  return {
    manifest_version: 3,
    version: "1.1.1",
    permissions: ["debugger", "storage", "alarms", "activeTab", "webRequest"],
    optional_permissions: ["tabs", "scripting", "cookies", "downloads", "notifications", "history"],
    optional_host_permissions: ["<all_urls>"],
  };
}

export function firefoxManifest() {
  return {
    manifest_version: 2,
    version: "1.1.1",
    browser_specific_settings: { gecko: { id: "local-browser@paperclip.app" } },
    permissions: ["contextualIdentities", "storage", "activeTab"],
    optional_permissions: ["<all_urls>", "tabs", "scripting", "cookies", "webRequest", "webRequestBlocking", "notifications", "history", "proxy"],
    icons: { 48: "icons/icon.svg", 96: "icons/icon.svg" },
  };
}

export function createFakeApi(options = {}) {
  const client = options.client || "chromium";
  const manifest = options.manifest || (client === "firefox" ? firefoxManifest() : chromiumManifest());
  const granted = {
    permissions: new Set(options.granted?.permissions ?? manifest.permissions.filter((id) => !id.includes("://") && id !== "<all_urls>")),
    origins: new Set(options.granted?.origins ?? []),
  };
  const store = { ...(options.storage || {}) };
  const calls = [];
  const scheme = client === "firefox" ? "moz-extension" : "chrome-extension";
  const permissionsEvents = { onAdded: event(), onRemoved: event() };
  const storageChanged = event();
  let answer = options.requestResult ?? true;

  function has(query) {
    return (query.permissions || []).every((id) => granted.permissions.has(id)) && (query.origins || []).every((id) => granted.origins.has(id));
  }

  const api = {
    runtime: {
      id: "ext-id",
      getManifest: () => manifest,
      getURL: (file) => scheme + "://ext-id/" + file,
      sendMessage: async (message) => {
        calls.push(["runtime.sendMessage", message]);
        return options.onMessage ? options.onMessage(message) : { ok: true };
      },
      onMessage: event(),
      ...(options.browserInfo ? { getBrowserInfo: async () => ({ ...options.browserInfo }) } : {}),
      ...(options.platformInfo ? { getPlatformInfo: async () => ({ ...options.platformInfo }) } : {}),
    },
    permissions: {
      ...permissionsEvents,
      contains: async (query) => has(query),
      getAll: async () => ({ permissions: [...granted.permissions], origins: [...granted.origins] }),
      request(query) {
        calls.push(["permissions.request", query]);
        return Promise.resolve().then(() => {
          if (!answer) return false;
          for (const id of query.permissions || []) granted.permissions.add(id);
          for (const id of query.origins || []) granted.origins.add(id);
          permissionsEvents.onAdded.fire(query);
          return true;
        });
      },
      async remove(query) {
        calls.push(["permissions.remove", query]);
        for (const id of query.permissions || []) granted.permissions.delete(id);
        for (const id of query.origins || []) granted.origins.delete(id);
        permissionsEvents.onRemoved.fire(query);
        return true;
      },
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return key in store ? { [key]: structuredClone(store[key]) } : {};
          return structuredClone(store);
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: structuredClone(value) };
            store[key] = structuredClone(value);
          }
          storageChanged.fire(changes, "local");
        },
      },
      onChanged: storageChanged,
    },
    notifications: {
      onClicked: event(),
      async create(id, details) {
        calls.push(["notifications.create", id, details]);
        return id;
      },
      async clear(id) {
        calls.push(["notifications.clear", id]);
        return true;
      },
    },
    tabs: {
      query: async (query) => {
        calls.push(["tabs.query", query]);
        return options.tabs || [];
      },
      create: async (props) => {
        calls.push(["tabs.create", props]);
        return { id: 9, ...props };
      },
      update: async (id, props) => {
        calls.push(["tabs.update", id, props]);
        return { id, ...props };
      },
    },
    windows: {
      update: async (id, props) => {
        calls.push(["windows.update", id, props]);
        return { id };
      },
    },
  };
  const badge = {
    setBadgeText: async (details) => calls.push(["badge.text", details.text]),
    setBadgeBackgroundColor: async (details) => calls.push(["badge.color", details.color]),
    setTitle: async (details) => calls.push(["badge.title", details.title]),
  };
  if (client === "firefox") api.browserAction = badge;
  else api.action = badge;

  return {
    api,
    calls,
    store,
    granted,
    manifest,
    setAnswer(value) {
      answer = value;
    },
    callsOf(name) {
      return calls.filter((call) => call[0] === name);
    },
  };
}

export function loadShared(files, { api, client = "chromium", globals = {} } = {}) {
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
    setTimeout,
    clearTimeout,
    structuredClone,
    Error,
    RegExp,
    ArrayBuffer,
    Uint8Array,
    DataView,
    ...globals,
  };
  sandbox.globalThis = sandbox;
  if (api) {
    if (client === "firefox") sandbox.browser = api;
    else sandbox.chrome = api;
  }
  vm.createContext(sandbox);
  for (const file of files) {
    const full = path.join(sharedDir, file);
    new vm.Script(readFileSync(full, "utf8"), { filename: file }).runInContext(sandbox);
  }
  return sandbox;
}

export async function flush(rounds = 5) {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
}
