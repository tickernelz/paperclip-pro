import test from "node:test";
import assert from "node:assert/strict";

import { bootBackground, plain } from "./harness.test.mjs";

function boot(options = {}) {
  const jar = [];
  const refused = new Set();
  const harness = bootBackground({
    tabs: [{ id: 7, url: "https://app.test/dashboard", cookieStoreId: options.store || "firefox-default" }],
    getAllCookies: () => jar.map((cookie) => ({ ...cookie })),
    removeCookie: (details) => (refused.has(details.name) ? null : { name: details.name }),
    ...options,
  });
  return { ...harness, jar, refused };
}

function storage(h, args) {
  return h.call("local_browser_storage", { kind: "cookies", ...args });
}

const getAll = (h) => h.callsOf("cookies.getAll").map((entry) => plain(entry[1]));
const sets = (h) => h.callsOf("cookies.set").map((entry) => plain(entry[1]));
const removes = (h) => h.callsOf("cookies.remove").map((entry) => plain(entry[1]));

test("reading by url asks for that url in the tab's cookie store, every partition included", async () => {
  const h = boot();
  h.jar.push({ name: "sid", value: "abc", domain: "app.test", path: "/", secure: true, httpOnly: true, session: true, hostOnly: true, sameSite: "lax", storeId: "firefox-default" });
  const { result } = await storage(h, { op: "get" });
  assert.deepEqual(getAll(h)[0], { partitionKey: {}, storeId: "firefox-default", url: "https://app.test/dashboard" });
  assert.equal(result.cookies.length, 1);
  assert.equal(result.cookies[0].httpOnly, true);
  assert.equal(result.storeId, "firefox-default");
});

test("a cookie reports session, hostOnly, storeId and partitionKey, and a session cookie has no expiry", async () => {
  const h = boot();
  h.jar.push(
    { name: "sid", value: "a", domain: "app.test", path: "/", secure: true, httpOnly: true, sameSite: "lax", session: true, hostOnly: true, storeId: "firefox-default", expirationDate: 1 },
    { name: "pref", value: "b", domain: ".app.test", path: "/", secure: false, httpOnly: false, sameSite: "no_restriction", session: false, hostOnly: false, storeId: "firefox-default", expirationDate: 1893456000, partitionKey: { topLevelSite: "https://top.test" } },
  );
  const { result } = await storage(h, { op: "get" });
  assert.deepEqual(result.cookies[0], { name: "sid", value: "a", domain: "app.test", path: "/", secure: true, httpOnly: true, sameSite: "lax", session: true, hostOnly: true, storeId: "firefox-default" });
  assert.equal(result.cookies[1].session, false);
  assert.equal(result.cookies[1].hostOnly, false);
  assert.equal(result.cookies[1].expirationDate, 1893456000);
  assert.deepEqual(result.cookies[1].partitionKey, { topLevelSite: "https://top.test" });
});

test("a container tab reads its own jar unless the call names another store", async () => {
  const h = boot({ store: "firefox-container-1" });
  await storage(h, { op: "get" });
  await storage(h, { op: "get", storeId: "firefox-default" });
  assert.equal(getAll(h)[0].storeId, "firefox-container-1");
  assert.equal(getAll(h)[1].storeId, "firefox-default");
});

test("reading by domain asks for the whole domain instead of the tab url", async () => {
  const h = boot();
  await storage(h, { op: "get", domain: ".test", name: "sid" });
  assert.deepEqual(getAll(h)[0], { partitionKey: {}, storeId: "firefox-default", name: "sid", domain: "test" });
});

test("reading the whole jar asks for every cookie without a scope", async () => {
  const h = boot();
  await storage(h, { op: "get", allDomains: true, storeId: "firefox-container-2" });
  assert.deepEqual(getAll(h)[0], { partitionKey: {}, storeId: "firefox-container-2" });
});

test("a get returns every cookie unless a limit is given", async () => {
  const h = boot();
  for (let index = 0; index < 450; index += 1) h.jar.push({ name: "c" + index, value: "v", domain: "app.test", path: "/", storeId: "firefox-default" });
  const all = await storage(h, { op: "get", domain: "app.test" });
  assert.equal(all.result.cookies.length, 450, "the old 200 default is gone");
  const some = await storage(h, { op: "get", domain: "app.test", limit: 2 });
  assert.equal(some.result.cookies.length, 2);
  assert.equal(some.result.total, 450);
});

test("writing honours domain, path, secure, httpOnly, sameSite, expiry and store", async () => {
  const h = boot();
  const { result } = await storage(h, {
    op: "set",
    domain: "app.test",
    entries: [{ name: "sid", value: "v", domain: ".app.test", path: "/admin", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 1893456000, storeId: "firefox-container-3" }],
  });
  assert.deepEqual(sets(h)[0], {
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

test("a session entry is written without an expiry", async () => {
  const h = boot();
  const { result } = await storage(h, { op: "set", url: "https://app.test/", entries: [{ name: "sid", value: "v", session: true }] });
  assert.equal("expirationDate" in sets(h)[0], false);
  assert.equal(result.cookies[0].session, true);
  assert.equal("expirationDate" in result.cookies[0], false);
});

test("a write without a store goes to the tab's cookie store", async () => {
  const h = boot({ store: "firefox-container-1" });
  await storage(h, { op: "set", entries: [{ name: "a", value: "1" }] });
  assert.equal(sets(h)[0].storeId, "firefox-container-1");
  assert.equal(sets(h)[0].url, "https://app.test/dashboard");
});

test("a per-entry domain drives the write url even when a url is passed", async () => {
  const h = boot();
  await storage(h, {
    op: "set",
    url: "https://app.test/",
    entries: [
      { name: "a", value: "1", domain: ".other.test", path: "/deep" },
      { name: "b", value: "2", path: "/elsewhere" },
    ],
  });
  assert.deepEqual(sets(h).map((entry) => entry.url), ["https://other.test/deep", "https://app.test/elsewhere"]);
});

test("clearing removes each cookie through its own domain, path, store and partition", async () => {
  const h = boot();
  h.jar.push(
    { name: "parent", value: "1", domain: ".app.test", path: "/", secure: true, storeId: "firefox-default" },
    { name: "scoped", value: "2", domain: "app.test", path: "/admin", secure: false, storeId: "firefox-default", partitionKey: { topLevelSite: "https://top.test" } },
  );
  const { result } = await storage(h, { op: "clear" });
  assert.deepEqual(removes(h), [
    { url: "https://app.test/", name: "parent", storeId: "firefox-default" },
    { url: "http://app.test/admin", name: "scoped", storeId: "firefox-default", partitionKey: { topLevelSite: "https://top.test" } },
  ]);
  assert.equal(result.count, 2);
  assert.equal(result.matched, 2);
});

test("a refused removal is reported instead of counted", async () => {
  const h = boot();
  h.jar.push({ name: "stuck", value: "1", domain: "app.test", path: "/", secure: true, storeId: "firefox-default" });
  h.refused.add("stuck");
  const { result } = await storage(h, { op: "clear", name: "stuck" });
  assert.equal(result.count, 0);
  assert.deepEqual(result.failed, ["stuck"]);
});

test("a call-level domain and store apply to entries that name neither", async () => {
  const h = boot();
  const { result } = await storage(h, { op: "set", domain: ".app.test", storeId: "7", entries: [{ name: "a", value: "1" }] });
  assert.equal(result.count, 1);
  assert.equal(sets(h)[0].domain, ".app.test");
  assert.equal(sets(h)[0].storeId, "7");
  assert.equal(sets(h)[0].url, "https://app.test/");
});

test("a whole-jar clear needs a name or an explicit confirmation", async () => {
  const h = boot();
  for (let index = 0; index < 60; index += 1) h.jar.push({ name: "c" + index, value: "v", domain: "site" + index + ".test", path: "/", secure: true, storeId: "firefox-default" });
  const refused = await storage(h, { op: "clear", allDomains: true });
  assert.match(refused.error.message, /Refusing to clear 60 cookies/);
  assert.equal(removes(h).length, 0);
  const confirmed = await storage(h, { op: "clear", allDomains: true, confirmAll: true });
  assert.equal(confirmed.result.count, 60);
});

test("a url that is not a website still needs an explicit scope for cookies", async () => {
  const h = boot();
  const { ok, error } = await storage(h, { op: "get", url: "about:blank" });
  assert.equal(ok, false);
  assert.equal(error.code, "local_browser_protocol_error");
});

test("cookies need the cookies permission and site access, and the refusal names both", async () => {
  const h = boot({ origins: [], permissions: ["storage", "activeTab", "contextualIdentities"] });
  const { ok, error } = await storage(h, { op: "get" });
  assert.equal(ok, false);
  assert.equal(error.code, "local_browser_permission_required");
  assert.deepEqual([...error.permissions].sort(), ["<all_urls>", "cookies"]);
  assert.equal(getAll(h).length, 0);
  const pending = plain(h.store.get("lb.pending"));
  assert.deepEqual(pending.map((item) => item.permission).sort(), ["<all_urls>", "cookies"]);
  assert.equal(pending[0].tool, "local_browser_storage");
});
