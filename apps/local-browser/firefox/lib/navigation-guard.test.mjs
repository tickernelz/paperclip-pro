import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const PAPERCLIP_ORIGIN = "https://p.test";

function boot(options = {}) {
  const tabs = new Map();
  const created = [];
  const stored = { "lb.pairing": { origin: PAPERCLIP_ORIGIN, label: "FF", hasToken: true } };
  const put = (entry) => {
    tabs.set(entry.id, { status: "complete", windowId: 1, title: "T", ...entry });
    return tabs.get(entry.id);
  };
  put({ id: 7, url: PAPERCLIP_ORIGIN + "/", active: true });
  if (options.tabs) for (const entry of options.tabs) put(entry);

  const browser = {
    storage: { local: { get: async (key) => (stored[key] ? { [key]: stored[key] } : {}), set: async () => undefined } },
    runtime: { getManifest: () => ({ version: "1.0.0" }), getPlatformInfo: async () => ({ os: "linux" }), sendMessage: async () => undefined },
    tabs: {
      query: async (query) => {
        const all = [...tabs.values()];
        if (query && query.active === true) {
          const active = all.filter((entry) => entry.active);
          return active.length ? active : [all[0]];
        }
        return all;
      },
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("no tab " + id);
        return { ...tabs.get(id) };
      },
      create: async (props) => {
        const entry = put({ id: 99, url: props.url, active: props.active === true });
        created.push({ ...entry });
        return { ...entry };
      },
      update: async (id, props) => {
        const next = { ...(tabs.get(id) || { id }), ...props };
        tabs.set(id, next);
        return { ...next };
      },
      reload: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      sendMessage: async () => ({ ok: true, result: {} }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onCreated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onActivated: { addListener: () => {} },
      onMoved: { addListener: () => {} },
    },
    webRequest: {
      onBeforeRequest: { addListener: () => {} },
      onHeadersReceived: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
      filterResponseData: () => ({}),
    },
    cookies: { getAll: async () => [] },
    downloads: { search: async () => [] },
  };

  const sandbox = { browser, console, URL, URLSearchParams, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => undefined };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of ["lib/protocol.js", "lib/text.js", "lib/keys.js", "lib/budget.js", "background/tabs.js", "background/tools.js"]) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }
  return { sandbox, tabs, created };
}

const ctx = { tier: "full", sessionId: "s", label: "FF", clientVersion: "1.0.0" };

test("open with a url uses a fresh tab and leaves the Paperclip tab alone", async () => {
  const harness = boot();
  const result = await harness.sandbox.LB.tools.dispatch("local_browser_open", { url: "https://example.test/page" }, ctx);
  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].url, "https://example.test/page");
  assert.equal(harness.tabs.get(7).url, PAPERCLIP_ORIGIN + "/", "the Paperclip tab keeps its url");
  assert.equal(result.tab.tabId, 99);
});

test("navigate refuses the tab the user is looking at", async () => {
  const harness = boot({ tabs: [{ id: 8, url: "https://app.test/x", active: true }] });
  harness.tabs.get(7).active = false;
  const error = await harness.sandbox.LB.tools
    .dispatch("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test" }, ctx)
    .catch((failure) => failure);
  assert.equal(error.code, "local_browser_navigation_blocked");
  assert.match(error.message, /tab the user is looking at/);
  assert.match(error.hint, /local_browser_open/);
  assert.equal(harness.tabs.get(8).url, "https://app.test/x");
});

test("navigate refuses the Paperclip tab even when another tab is focused", async () => {
  const harness = boot({ tabs: [{ id: 9, url: "https://other.test/", active: true }] });
  harness.tabs.get(7).active = false;
  const error = await harness.sandbox.LB.tools
    .dispatch("local_browser_navigate", { tabId: 7, url: "https://elsewhere.test" }, ctx)
    .catch((failure) => failure);
  assert.equal(error.code, "local_browser_navigation_blocked");
  assert.match(error.message, /belongs to Paperclip/);
  assert.equal(harness.tabs.get(7).url, PAPERCLIP_ORIGIN + "/");
});

test("opening a second url reuses the agent tab", async () => {
  const harness = boot();
  await harness.sandbox.LB.tools.dispatch("local_browser_open", { url: "https://example.test/one" }, ctx);
  await harness.sandbox.LB.tools.dispatch("local_browser_open", { url: "https://example.test/two" }, ctx);
  assert.equal(harness.created.length, 1, "one agent tab serves every open");
  assert.equal(harness.tabs.get(99).url, "https://example.test/two");
});

test("a tab the agent opened stays navigable", async () => {
  const harness = boot();
  await harness.sandbox.LB.tools.dispatch("local_browser_open", { url: "https://example.test/page" }, ctx);
  const moved = await harness.sandbox.LB.tools.dispatch("local_browser_navigate", { tabId: 99, url: "https://example.test/next" }, ctx);
  assert.equal(moved.tab.url, "https://example.test/next");
});
