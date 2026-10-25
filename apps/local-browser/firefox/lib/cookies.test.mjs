import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const tab = { id: 7, url: "https://app.test/dashboard", active: true, title: "App" };

function boot() {
  const calls = { getAll: [], set: [], remove: [] };
  const store = [];
  const refused = new Set();
  const browser = {
    runtime: {
      getManifest: () => ({ version: "1.0.8" }),
      getPlatformInfo: async () => ({ os: "linux" }),
      onMessage: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      sendMessage: async () => undefined,
    },
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
    browserAction: { setBadgeBackgroundColor: async () => undefined, setBadgeText: async () => undefined },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
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
    cookies: {
      getAll: async (query) => {
        calls.getAll.push(query);
        return store.map((cookie) => ({ ...cookie }));
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
          sameSite: details.sameSite || "no_restriction",
          storeId: details.storeId || "firefox-default",
        };
        if (details.expirationDate !== undefined) cookie.expirationDate = details.expirationDate;
        return cookie;
      },
      remove: async (details) => {
        calls.remove.push(details);
        return refused.has(details.name) ? null : { url: details.url, name: details.name };
      },
    },
    downloads: { search: async () => [] },
  };
  const sandbox = { browser, console, URL, URLSearchParams, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => undefined };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of ["lib/protocol.js", "lib/text.js", "lib/keys.js", "lib/budget.js", "background/tabs.js", "background/tools.js"]) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }
  return { sandbox, calls, store, refused, ctx: { tier: "full", sessionId: "s", label: "FF", clientVersion: "1.0.8" } };
}

const storage = (sandbox, ctx, args) => sandbox.LB.tools.dispatch("local_browser_storage", { kind: "cookies", ...args }, ctx);

test("reading by url asks only for that url", async () => {
  const h = boot();
  h.store.push({ name: "sid", value: "abc", domain: "app.test", path: "/", secure: true, httpOnly: true, session: true, sameSite: "lax" });
  const result = await storage(h.sandbox, h.ctx, { op: "get" });
  assert.deepEqual(plain(h.calls.getAll[0]), { url: "https://app.test/dashboard" });
  assert.equal(result.cookies.length, 1);
  assert.equal(result.cookies[0].httpOnly, true);
});

test("reading by domain asks for the whole domain instead of the tab url", async () => {
  const h = boot();
  await storage(h.sandbox, h.ctx, { op: "get", domain: ".test", name: "sid" });
  assert.deepEqual(plain(h.calls.getAll[0]), { domain: "test", name: "sid" });
});

test("reading the whole jar asks for every cookie without a scope", async () => {
  const h = boot();
  await storage(h.sandbox, h.ctx, { op: "get", allDomains: true, storeId: "firefox-container-2" });
  assert.deepEqual(plain(h.calls.getAll[0]), { storeId: "firefox-container-2" });
});

test("writing honours domain, path, secure, httpOnly, sameSite, expiry and store", async () => {
  const h = boot();
  const result = await storage(h.sandbox, h.ctx, {
    op: "set",
    domain: "app.test",
    entries: [{ name: "sid", value: "v", domain: ".app.test", path: "/admin", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 1893456000, storeId: "firefox-container-3" }],
  });
  assert.deepEqual(plain(h.calls.set[0]), {
    url: "https://app.test/admin",
    name: "sid",
    value: "v",
    storeId: "firefox-container-3",
    domain: ".app.test",
    path: "/admin",
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    expirationDate: 1893456000,
  });
  assert.equal(result.count, 1);
  assert.equal(result.cookies[0].httpOnly, true);
});

test("a per-entry domain drives the write url even when a url is passed", async () => {
  const h = boot();
  await storage(h.sandbox, h.ctx, {
    op: "set",
    url: "https://app.test/",
    entries: [
      { name: "a", value: "1", domain: ".other.test", path: "/deep" },
      { name: "b", value: "2", path: "/elsewhere" },
    ],
  });
  assert.deepEqual(plain(h.calls.set.map((entry) => entry.url)), ["https://other.test/deep", "https://app.test/elsewhere"]);
});

test("clearing removes each cookie through its own domain and path", async () => {
  const h = boot();
  h.store.push(
    { name: "parent", value: "1", domain: ".app.test", path: "/", secure: true, storeId: "firefox-default" },
    { name: "scoped", value: "2", domain: "app.test", path: "/admin", secure: false, storeId: "firefox-default" },
  );
  const result = await storage(h.sandbox, h.ctx, { op: "clear" });
  assert.deepEqual(plain(h.calls.remove.map((entry) => entry.url)), ["https://app.test/", "http://app.test/admin"]);
  assert.equal(result.count, 2);
  assert.equal(result.matched, 2);
});

test("a refused removal is reported instead of counted", async () => {
  const h = boot();
  h.store.push({ name: "stuck", value: "1", domain: "app.test", path: "/", secure: true, storeId: "firefox-default" });
  h.refused.add("stuck");
  const result = await storage(h.sandbox, h.ctx, { op: "clear", name: "stuck" });
  assert.equal(result.count, 0);
  assert.deepEqual(plain(result.failed), ["stuck"]);
});

test("a call-level domain and store apply to entries that name neither", async () => {
  const h = boot();
  const result = await storage(h.sandbox, h.ctx, { op: "set", domain: ".app.test", storeId: "7", entries: [{ name: "a", value: "1" }] });
  assert.equal(result.count, 1);
  assert.equal(h.calls.set[0].domain, ".app.test");
  assert.equal(h.calls.set[0].storeId, "7");
  assert.equal(h.calls.set[0].url, "https://app.test/");
});

test("a get caps the list and reports the total", async () => {
  const h = boot();
  for (const name of ["a", "b", "c"]) h.store.push({ name, value: "v", domain: "app.test", path: "/", secure: true, storeId: "firefox-default" });
  const result = await storage(h.sandbox, h.ctx, { op: "get", domain: "app.test", limit: 2 });
  assert.equal(result.cookies.length, 2);
  assert.equal(result.total, 3);
});

test("a whole-jar clear needs a name or an explicit confirmation", async () => {
  const h = boot();
  for (let index = 0; index < 60; index += 1) h.store.push({ name: "c" + index, value: "v", domain: "site" + index + ".test", path: "/", secure: true, storeId: "firefox-default" });
  const refused = await storage(h.sandbox, h.ctx, { op: "clear", allDomains: true }).catch((failure) => failure);
  assert.match(refused.message, /Refusing to clear 60 cookies/);
  assert.equal(h.calls.remove.length, 0);
  const confirmed = await storage(h.sandbox, h.ctx, { op: "clear", allDomains: true, confirmAll: true });
  assert.equal(confirmed.count, 60);
});

test("a tab without a website still needs an explicit scope for cookies", async () => {
  const h = boot();
  h.sandbox.LB.tabs.state = h.sandbox.LB.tabs.state || {};
  const error = await storage({ ...h.sandbox, LB: h.sandbox.LB }, h.ctx, { op: "get", url: "about:blank" }).catch((failure) => failure);
  assert.equal(error.code, "local_browser_protocol_error");
});
