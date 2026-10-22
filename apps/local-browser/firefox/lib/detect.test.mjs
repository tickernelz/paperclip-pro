import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));

function boot(tab, pageAttributes) {
  const storage = new Map();
  const sockets = [];
  const scripts = [];

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }
    send() {}
    close(code) {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: typeof code === "number" ? code : 1006, reason: "" });
    }
  }
  FakeSocket.OPEN = 1;

  const browser = {
    runtime: {
      getManifest: () => ({ version: manifest.version }),
      getPlatformInfo: async () => ({ os: "linux" }),
      onMessage: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      sendMessage: async () => undefined,
    },
    storage: {
      local: {
        get: async (key) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
        set: async (value) => Object.entries(value).forEach(([k, v]) => storage.set(k, v)),
        remove: async (key) => storage.delete(key),
      },
    },
    browserAction: { setBadgeBackgroundColor: async () => undefined, setBadgeText: async () => undefined },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      onCreated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      onActivated: { addListener: () => {} },
      sendMessage: async () => ({ ok: true, result: {} }),
      executeScript: async (tabId, options) => {
        scripts.push({ tabId, options });
        return [pageAttributes];
      },
    },
    webRequest: {
      onBeforeRequest: { addListener: () => {} },
      onHeadersReceived: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
      filterResponseData: () => ({}),
    },
    cookies: { getAll: async () => [], set: async () => ({}), remove: async () => ({}) },
    downloads: { search: async () => [] },
    scripting: { executeScript: async () => [] },
    windows: { update: async () => undefined },
    profiles: { getProfileName: async () => "work" },
  };

  const sandbox = {
    browser,
    console,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    btoa,
    atob,
    WebSocket: FakeSocket,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => undefined,
    fetch: async () => {
      throw new Error("offline");
    },
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of manifest.background.scripts) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }
  return { sandbox, storage, sockets, scripts };
}

const PAPERCLIP_TAB = {
  id: 12,
  windowId: 1,
  title: "Local Browser",
  url: "https://paperclip.test/apps/conn-1",
  active: true,
  status: "complete",
};

test("detect reads the pairing attributes from the open Paperclip tab", async () => {
  const harness = boot(PAPERCLIP_TAB, { origin: "https://paperclip.test", code: "F6BX2X8R" });
  const response = await harness.sandbox.LB.bridge.control({ op: "detect" });
  assert.equal(response.ok, true);
  assert.equal(response.pairing.origin, "https://paperclip.test");
  assert.equal(response.pairing.code, "F6BX2X8R");
  assert.equal(harness.scripts.length, 1, "the page is read once");
  assert.equal(harness.scripts[0].tabId, 12);
});

test("detect falls back to the tab origin when the page gives none", async () => {
  const harness = boot(PAPERCLIP_TAB, { origin: "", code: "F6BX2X8R" });
  const response = await harness.sandbox.LB.bridge.control({ op: "detect" });
  assert.equal(response.pairing.origin, "https://paperclip.test");
  assert.equal(response.pairing.code, "F6BX2X8R");
});

test("detect returns nothing when the tab has no pairing marker", async () => {
  const harness = boot(PAPERCLIP_TAB, null);
  const response = await harness.sandbox.LB.bridge.control({ op: "detect" });
  assert.equal(response.ok, true);
  assert.equal(response.pairing, null);
});

test("detect ignores a tab that is not an http page", async () => {
  const harness = boot({ ...PAPERCLIP_TAB, url: "about:addons" }, { code: "F6BX2X8R" });
  const response = await harness.sandbox.LB.bridge.control({ op: "detect" });
  assert.equal(response.pairing, null);
  assert.equal(harness.scripts.length, 0);
});

test("pair accepts a bare host and stores a normalised origin", async () => {
  const harness = boot(PAPERCLIP_TAB, null);
  await harness.sandbox.LB.bridge.control({ op: "pair", origin: "app.paperclip.example", code: "F6BX2X8R" });
  const stored = harness.storage.get("lb.pairing");
  assert.equal(stored.origin, "https://app.paperclip.example");
  assert.equal(harness.sockets[harness.sockets.length - 1].url.includes("code=F6BX2X8R"), true);
});

test("pair refuses a non-web address with a message that names the problem", async () => {
  const harness = boot(PAPERCLIP_TAB, null);
  const response = await harness.sandbox.LB.bridge.control({ op: "pair", origin: "ftp://paperclip.test", code: "F6BX2X8R" });
  assert.equal(response.ok, false);
  assert.match(response.error, /http or https/);
  assert.equal(harness.sockets.length, 0);
});
