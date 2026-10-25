import test from "node:test";
import assert from "node:assert/strict";
import { createFakeApi, loadShared } from "./test-ext.mjs";

function setup(options = {}) {
  const fake = createFakeApi(options);
  const sandbox = loadShared(["lib/contract.js", "lib/ext-api.js", "lib/access.js", "lib/api-call.js"], { api: fake.api, client: options.client || "chromium" });
  return { fake, LB: sandbox.LB };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("calls a nested browser API with the given args and this binding", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["history"], origins: [] } });
  fake.api.history = {
    async search(query) {
      assert.equal(this, fake.api.history);
      return [{ url: "https://a.test", visitCount: query.maxResults }];
    },
  };
  const result = await LB.apiCall.invoke(fake.api, "history.search", [{ text: "", maxResults: 3 }]);
  assert.deepEqual(plain(result), { value: [{ url: "https://a.test", visitCount: 3 }], type: "object" });
});

test("reads deep settings objects such as privacy.websites.thirdPartyCookiesAllowed.get", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["privacy"], origins: [] } });
  fake.api.privacy = { websites: { thirdPartyCookiesAllowed: { get: async () => ({ value: false, levelOfControl: "controllable_by_this_extension" }) } } };
  const result = await LB.apiCall.invoke(fake.api, "privacy.websites.thirdPartyCookiesAllowed.get", [{}]);
  assert.equal(result.value.value, false);
});

test("non-function targets are read when no args are given", async () => {
  const { LB, fake } = setup();
  fake.api.windows.count = 2;
  const result = await LB.apiCall.invoke(fake.api, "windows.count");
  assert.deepEqual(plain(result), { value: 2, type: "number" });
  await assert.rejects(LB.apiCall.invoke(fake.api, "windows.count", [1]), (error) => error.code === "local_browser_protocol_error");
});

const STORAGE_HINT = "Use local_browser_storage for page storage and cookies.";
const INJECTION_HINT = "Use local_browser_evaluate to run code in a page";

const BLOCKED_PATHS = [
  ["storage.local.get", STORAGE_HINT],
  ["storage.session.get", STORAGE_HINT],
  ["storage.sync.set", STORAGE_HINT],
  ["Storage.local.get", STORAGE_HINT],
  ["STORAGE.local.get", STORAGE_HINT],
  [" storage.local.get", STORAGE_HINT],
  ["storage.local.get ", STORAGE_HINT],
  ["storage .local.get", STORAGE_HINT],
  ["\tstorage.local.get", STORAGE_HINT],
  ["storage", STORAGE_HINT],
  ["scripting.executeScript", INJECTION_HINT],
  ["scripting.registerContentScripts", INJECTION_HINT],
  ["SCRIPTING.executeScript", INJECTION_HINT],
  [" scripting.executeScript", INJECTION_HINT],
  ["tabs.executeScript", INJECTION_HINT],
  ["Tabs.ExecuteScript", INJECTION_HINT],
  ["tabs. executeScript", INJECTION_HINT],
  ["contentScripts.register", INJECTION_HINT],
  ["contentscripts.register", INJECTION_HINT],
  ["CONTENTSCRIPTS.register", INJECTION_HINT],
  ["userScripts.register", INJECTION_HINT],
  ["userscripts.configureWorld", INJECTION_HINT],
  ["runtime.getBackgroundPage", INJECTION_HINT],
  ["runtime.sendMessage", INJECTION_HINT],
  ["runtime.id", INJECTION_HINT],
  ["Runtime.reload", INJECTION_HINT],
  [" runtime.getURL ", INJECTION_HINT],
  ["extension.getBackgroundPage", INJECTION_HINT],
  ["extension.getViews", INJECTION_HINT],
  ["EXTENSION.getViews", INJECTION_HINT]
];

test("storage and code-injection namespaces are refused for every spelling", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["tabs", "scripting"], origins: ["<all_urls>"] } });
  const reached = [];
  const trap = (name) => (...args) => { reached.push([name, args]); return "reached"; };
  fake.api.storage.local.get = trap("storage.local.get");
  fake.api.scripting = { executeScript: trap("scripting.executeScript"), registerContentScripts: trap("scripting.registerContentScripts") };
  fake.api.tabs.executeScript = trap("tabs.executeScript");
  fake.api.contentScripts = { register: trap("contentScripts.register") };
  fake.api.userScripts = { register: trap("userScripts.register"), configureWorld: trap("userScripts.configureWorld") };
  fake.api.extension = { getBackgroundPage: trap("extension.getBackgroundPage"), getViews: trap("extension.getViews") };
  fake.api.runtime.getBackgroundPage = trap("runtime.getBackgroundPage");
  for (const [path, hint] of BLOCKED_PATHS) {
    assert.equal(LB.apiCall.isBlocked(path), true, path);
    await assert.rejects(LB.apiCall.invoke(fake.api, path, [{ code: "browser.storage.local.get('lb.pairing')" }]), (error) => {
      assert.equal(error.code, "local_browser_unsupported", path);
      assert.equal(error.hint, hint, path);
      return true;
    });
  }
  assert.deepEqual(reached, []);
});

test("neighbouring paths that cannot inject code stay callable", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["history", "tabs"], origins: ["<all_urls>"] } });
  fake.api.history = { search: async () => [{ url: "https://a.test" }] };
  fake.api.tabs.insertCSS = async (tabId, details) => ({ tabId, details });
  for (const path of ["history.search", "tabs.query", "tabs.insertCSS", "tabs.executeScriptLater", "storageArea.get"]) {
    assert.equal(LB.apiCall.isBlocked(path), false, path);
  }
  assert.deepEqual(plain(await LB.apiCall.invoke(fake.api, "history.search", [{ text: "" }])), { value: [{ url: "https://a.test" }], type: "object" });
  assert.deepEqual(plain(await LB.apiCall.invoke(fake.api, "tabs.query", [{}])), { value: [], type: "object" });
  assert.deepEqual(plain(await LB.apiCall.invoke(fake.api, "tabs.insertCSS", [7, { code: "body{}" }])), { value: { tabId: 7, details: { code: "body{}" } }, type: "object" });
});

test("bad paths and too many args are protocol errors", async () => {
  const { LB, fake } = setup();
  for (const path of ["history", "history..search", "1x.y", "a.b-c", ""]) {
    await assert.rejects(LB.apiCall.invoke(fake.api, path, []), (error) => error.code === "local_browser_protocol_error");
  }
  await assert.rejects(LB.apiCall.invoke(fake.api, "tabs.query", Array(21).fill(0)), (error) => error.code === "local_browser_protocol_error");
  await assert.rejects(LB.apiCall.invoke(fake.api, "tabs.query", "nope"), (error) => error.code === "local_browser_protocol_error");
});

test("a namespace whose permission is missing is queued and reported as permission_required", async () => {
  const { LB, fake } = setup();
  await assert.rejects(LB.apiCall.invoke(fake.api, "bookmarks.getTree", []), (error) => {
    assert.equal(error.code, "local_browser_permission_required");
    assert.deepEqual([...error.permissions], ["bookmarks"]);
    return true;
  });
  assert.equal(fake.store["lb.pending"][0].permission, "bookmarks");
  assert.equal(fake.store["lb.pending"][0].tool, "local_browser_api");
});

test("two-segment permission ids map before the namespace", () => {
  const { LB } = setup();
  assert.equal(LB.apiCall.permissionFor("downloads.open"), "downloads.open");
  assert.equal(LB.apiCall.permissionFor("downloads.search"), "downloads");
  assert.equal(LB.apiCall.permissionFor("runtime.getPlatformInfo"), null);
});

test("a missing API without a catalog permission is unsupported", async () => {
  const { LB, fake } = setup();
  await assert.rejects(LB.apiCall.invoke(fake.api, "sidePanel.open", []), (error) => error.code === "local_browser_unsupported");
});

test("browser errors are wrapped with the path", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["history"], origins: [] } });
  fake.api.history = { search: async () => { throw new Error("bad query"); } };
  await assert.rejects(LB.apiCall.invoke(fake.api, "history.search", [{}]), (error) => {
    assert.equal(error.code, "local_browser_protocol_error");
    assert.match(error.message, /history\.search failed: bad query/);
    return true;
  });
});

test("serialisation is JSON-safe for cycles, functions, Map, Set, dates, bigints and binary", () => {
  const { LB } = setup();
  const cyclic = { name: "a" };
  cyclic.self = cyclic;
  const shared = { n: 1 };
  const value = {
    cyclic,
    twice: [shared, shared],
    fn: function named() {},
    map: new Map([["k", 1]]),
    set: new Set([1, 2]),
    date: new Date("2026-01-02T03:04:05Z"),
    big: 10n,
    bytes: new Uint8Array([1, 2]),
    nan: NaN,
    skip: undefined,
    error: new Error("boom"),
  };
  const result = LB.apiCall.serialize(value);
  assert.equal(result.type, "object");
  assert.deepEqual(plain(result.value), {
    cyclic: { name: "a", self: "[Circular]" },
    twice: [{ n: 1 }, { n: 1 }],
    fn: "[Function named]",
    map: [["k", 1]],
    set: [1, 2],
    date: "2026-01-02T03:04:05.000Z",
    big: "10",
    bytes: [1, 2],
    nan: "NaN",
    error: { name: "Error", message: "boom" },
  });
  assert.deepEqual(plain(LB.apiCall.serialize(undefined)), { value: null, type: "undefined" });
});

test("depth and size guards stop runaway values instead of crashing", () => {
  const { LB } = setup();
  let deep = {};
  const top = deep;
  for (let index = 0; index < 200; index += 1) {
    deep.next = {};
    deep = deep.next;
  }
  assert.match(JSON.stringify(LB.apiCall.serialize(top).value), /\[MaxDepth\]/);
  const wide = LB.apiCall.serialize(Array.from({ length: 50 }, (_, index) => index), { maxNodes: 10 });
  assert.equal(wide.value.at(-1), "[Truncated]");
  assert.ok(wide.value.length <= 12);
});
