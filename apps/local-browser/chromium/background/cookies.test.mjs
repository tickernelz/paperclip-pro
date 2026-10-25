import test from "node:test";
import assert from "node:assert/strict";
import { boot, everyPermission, plain } from "./harness.test.mjs";

const tab = { id: 7, url: "https://app.test/dashboard", active: true, title: "App", status: "complete", windowId: 1 };

function jarFake() {
  const calls = { getAll: [], set: [], remove: [] };
  const jar = [];
  const refusedRemovals = new Set();
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
        hostOnly: !details.domain,
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
    getAllCookieStores: async () => [{ id: "0", tabIds: [7] }],
  };
  return { calls, jar, refusedRemovals, cookies };
}

async function start(options = {}) {
  const fake = jarFake();
  const context = await boot({ tab, cookies: fake.cookies, ...options });
  return { ...context, ...fake };
}

function withoutSiteAccess() {
  const granted = everyPermission();
  return { permissions: granted.permissions, origins: [] };
}

test("reading cookies by url is scoped to that url", async () => {
  const h = await start();
  h.jar.push({ name: "sid", value: "abc", domain: "app.test", path: "/", secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: "lax", storeId: "0" });
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(h.calls.getAll[0]), { url: tab.url });
  assert.equal(result.result.cookies.length, 1);
  assert.equal(result.result.cookies[0].httpOnly, true);
});

test("a cookie reports session, hostOnly, store and partition key, and drops the expiry of a session cookie", async () => {
  const h = await start();
  h.jar.push(
    { name: "sid", value: "a", domain: "app.test", path: "/", secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: "lax", storeId: "0", expirationDate: 99 },
    {
      name: "chip",
      value: "b",
      domain: ".app.test",
      path: "/",
      secure: true,
      httpOnly: false,
      hostOnly: false,
      session: false,
      sameSite: "no_restriction",
      storeId: "0",
      expirationDate: 1893456000,
      partitionKey: { topLevelSite: "https://top.test", hasCrossSiteAncestor: false },
    },
  );
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(result.result.cookies[0], {
    name: "sid",
    value: "a",
    domain: "app.test",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    session: true,
    hostOnly: true,
    storeId: "0",
  });
  assert.equal(result.result.cookies[1].expirationDate, 1893456000);
  assert.equal(result.result.cookies[1].hostOnly, false);
  assert.deepEqual(result.result.cookies[1].partitionKey, { topLevelSite: "https://top.test", hasCrossSiteAncestor: false });
});

test("reading by domain reaches subdomains without a tab url", async () => {
  const h = await start();
  await h.call("local_browser_storage", { kind: "cookies", op: "get", domain: ".example.com", name: "sid" });
  assert.deepEqual(plain(h.calls.getAll[0]), { domain: "example.com", name: "sid" });
});

test("reading the whole jar honours a cookie store and a name filter", async () => {
  const h = await start();
  await h.call("local_browser_storage", { kind: "cookies", op: "get", allDomains: true, storeId: "2", name: "sid" });
  assert.deepEqual(plain(h.calls.getAll[0]), { storeId: "2", name: "sid" });
});

test("a per-entry domain and path drive the write url", async () => {
  const h = await start();
  await h.call("local_browser_storage", {
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
  const h = await start();
  const result = await h.call("local_browser_storage", {
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

test("a session entry writes a cookie without an expiry", async () => {
  const h = await start();
  const result = await h.call("local_browser_storage", {
    kind: "cookies",
    op: "set",
    url: "https://app.test/",
    entries: [{ name: "s", value: "1", session: true, expirationDate: 1893456000 }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal("expirationDate" in h.calls.set[0], false);
  assert.equal(result.result.cookies[0].session, true);
});

test("clearing removes each cookie through its own domain, path and store", async () => {
  const h = await start();
  h.jar.push(
    { name: "parent", value: "1", domain: ".app.test", path: "/", secure: true, storeId: "0" },
    { name: "scoped", value: "2", domain: "app.test", path: "/admin", secure: false, storeId: "0" },
  );
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "clear" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(h.calls.remove.map((entry) => entry.url)), ["https://app.test/", "http://app.test/admin"]);
  assert.deepEqual(plain(h.calls.remove.map((entry) => entry.storeId)), ["0", "0"]);
  assert.equal(result.result.count, 2);
  assert.equal(result.result.matched, 2);
});

test("a call-level domain and store apply to entries that name neither", async () => {
  const h = await start();
  const result = await h.call("local_browser_storage", {
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

test("a get honours limit and reports the total", async () => {
  const h = await start();
  for (const name of ["a", "b", "c"]) h.jar.push({ name, value: "v", domain: "app.test", path: "/", secure: true, storeId: "0" });
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get", domain: "app.test", limit: 2 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.cookies.length, 2);
  assert.equal(result.result.total, 3);
});

test("a get without limit returns every cookie", async () => {
  const h = await start();
  for (let index = 0; index < 250; index += 1) h.jar.push({ name: "c" + index, value: "v", domain: "app.test", path: "/", secure: true, storeId: "0" });
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get", domain: "app.test" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.cookies.length, 250);
  assert.equal(result.result.total, 250);
});

test("a whole-jar clear needs a name or an explicit confirmation", async () => {
  const h = await start();
  for (let index = 0; index < 60; index += 1) h.jar.push({ name: "c" + index, value: "v", domain: "site" + index + ".test", path: "/", secure: true, storeId: "0" });
  const refused = await h.call("local_browser_storage", { kind: "cookies", op: "clear", allDomains: true });
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /Refusing to clear 60 cookies/);
  assert.equal(h.calls.remove.length, 0);
  const confirmed = await h.call("local_browser_storage", { kind: "cookies", op: "clear", allDomains: true, confirmAll: true });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error || {}));
  assert.equal(h.calls.remove.length, 60);
});

test("a host-permission refusal explains how to grant site access", async () => {
  const h = await start();
  h.cookies.set = async () => {
    throw new Error('No host permissions for cookies at url: "https://app.test/".');
  };
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "set", url: "https://app.test/", entries: [{ name: "a", value: "1" }] });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(result.result.failed), ["a"]);
  assert.match(result.result.note, /Allow all/);
});

test("a jar-wide read without site access asks for it instead of returning nothing", async () => {
  const h = await start({ granted: withoutSiteAccess() });
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get", allDomains: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_permission_required");
  assert.deepEqual(result.error.permissions, ["<all_urls>"]);
  assert.equal(h.calls.getAll.length, 0);
});

test("cookies without the cookies permission are refused with the permission to ask for", async () => {
  const granted = everyPermission();
  const h = await start({ granted: { permissions: granted.permissions.filter((id) => id !== "cookies"), origins: granted.origins } });
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_permission_required");
  assert.equal(result.error.retryable, true);
  assert.deepEqual(result.error.permissions, ["cookies"]);
});

test("a jar-wide read does not need a reachable tab", async () => {
  const h = await start();
  h.jar.push({ name: "sid", value: "v", domain: "app.test", path: "/", secure: true, storeId: "0" });
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "get", allDomains: true, tabId: 999 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.cookies.length, 1);
});

test("a refused removal is reported, not counted as cleared", async () => {
  const h = await start();
  h.jar.push({ name: "stuck", value: "1", domain: "app.test", path: "/", secure: true, storeId: "0" });
  h.refusedRemovals.add("stuck");
  const result = await h.call("local_browser_storage", { kind: "cookies", op: "clear", name: "stuck" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.count, 0);
  assert.deepEqual(plain(result.result.failed), ["stuck"]);
});
