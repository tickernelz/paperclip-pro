import test from "node:test";
import assert from "node:assert/strict";

import { REQUIRED, bootBackground, flush, plain } from "./harness.test.mjs";

const DOC = {
  documentId: "doc-1",
  url: "https://example.test/",
  readyState: "complete",
  visibilityState: "visible",
  navigationType: "back_forward",
  restoredFromBfcache: true,
  wasDiscarded: false,
  prerendering: false,
  loadedAt: 1,
  ageMs: 2,
  requestsSinceLoad: 3,
  xhrSinceLoad: 1,
  stale: true,
  staleReasons: ["restored_from_bfcache"],
};

function page(options = {}) {
  const docHeight = options.docHeight ?? 1000;
  const height = 1000;
  const seen = [];
  function viewport(scrollY = 0) {
    return { width: 800, height, dpr: 1, scrollX: 0, scrollY, docWidth: 800, docHeight };
  }
  const handler = (message) => {
    seen.push({ op: message.op, args: message.args });
    if (options.silent) throw new Error("Could not establish connection. Receiving end does not exist.");
    switch (message.op) {
      case "ping":
        return { ok: true, result: { ok: true } };
      case "documentState":
        return { ok: true, result: DOC };
      case "viewport":
        return { ok: true, result: viewport() };
      case "scrollTo":
        return { ok: true, result: viewport(Math.max(0, Math.min(message.args.y, docHeight - height))) };
      case "stitch":
        return { ok: true, result: { dataUrl: "data:image/png;base64,BBBB", width: message.args.width, height: message.args.height } };
      case "wait":
        return { ok: true, result: { matched: true, condition: "idle" } };
      default:
        return { ok: true, result: { url: "https://example.test/", nodes: [] } };
    }
  };
  return { handler, seen };
}

function boot(options = {}) {
  const content = page(options.page);
  const harness = bootBackground({ content: content.handler, ...options });
  return { ...harness, seen: content.seen };
}

const ONLY_REQUIRED = { permissions: REQUIRED, origins: [] };

test("full-tier tools run whatever tier the context says; the server owns the tier gate", async () => {
  const harness = boot();
  for (const tool of ["local_browser_evaluate", "local_browser_storage", "local_browser_network", "local_browser_download", "local_browser_api"]) {
    const args = {
      local_browser_evaluate: { expression: "1" },
      local_browser_storage: { kind: "cookies", op: "get", allDomains: true },
      local_browser_network: { op: "list" },
      local_browser_download: { op: "list" },
      local_browser_api: { path: "history.search", args: [{ text: "" }] },
    }[tool];
    const outcome = await harness.call(tool, args);
    assert.equal(outcome.ok, true, tool + " must not be refused by the extension: " + JSON.stringify(outcome.error));
  }
  assert.equal("requiresFullTier" in harness.LB.protocol, false);
});

test("a page tool without site access refuses with the missing ids and queues them for the user", async () => {
  const harness = boot({ permissions: [...REQUIRED, "scripting"], origins: [] });
  const { ok, error } = await harness.call("local_browser_snapshot", {});
  assert.equal(ok, false);
  assert.equal(error.code, "local_browser_permission_required");
  assert.deepEqual(error.permissions, ["<all_urls>"]);
  assert.equal(error.retryable, true);
  assert.equal(harness.callsOf("tabs.sendMessage").length, 0, "the page is never touched");
  const pending = plain(harness.store.get("lb.pending"));
  assert.equal(pending[0].permission, "<all_urls>");
  assert.equal(pending[0].tool, "local_browser_snapshot");
  assert.ok(harness.callsOf("badge.text").some((entry) => entry[1] === "1"), "the badge shows the pending count");
});

test("each tool asks for the permissions its browser APIs need", () => {
  const harness = boot();
  const needs = (tool, args = {}) => [...harness.LB.tools.requirementsFor(tool, args)].sort();
  assert.deepEqual(needs("local_browser_open"), ["<all_urls>", "scripting"]);
  assert.deepEqual(needs("local_browser_storage", { kind: "cookies" }), ["<all_urls>", "cookies"]);
  assert.deepEqual(needs("local_browser_storage", { kind: "local" }), ["<all_urls>", "scripting"]);
  assert.deepEqual(needs("local_browser_network", { op: "list" }), ["<all_urls>", "webRequest"]);
  assert.deepEqual(needs("local_browser_network", { op: "list", includeBodies: true }), ["<all_urls>", "webRequest", "webRequestBlocking"]);
  assert.deepEqual(needs("local_browser_network", { op: "clear" }), []);
  assert.deepEqual(needs("local_browser_download", { op: "list" }), ["downloads"]);
  assert.deepEqual(needs("local_browser_context", {}), ["cookies"]);
  assert.deepEqual(needs("local_browser_context", { cookies: false }), []);
  assert.deepEqual(needs("local_browser_permissions", { op: "status" }), []);
  assert.deepEqual(needs("local_browser_api", { path: "history.search" }), []);
  assert.deepEqual(needs("local_browser_sessions"), []);
});

test("network bodies need webRequestBlocking on top of webRequest", async () => {
  const harness = boot({ permissions: [...REQUIRED, "webRequest"] });
  const { error } = await harness.call("local_browser_network", { op: "list", includeBodies: true });
  assert.equal(error.code, "local_browser_permission_required");
  assert.deepEqual(error.permissions, ["webRequestBlocking"]);
});

test("permissions status reports the access snapshot with a note", async () => {
  const harness = boot(ONLY_REQUIRED);
  const { result } = await harness.call("local_browser_permissions", { op: "status" });
  assert.deepEqual(Object.keys(result).sort(), ["granted", "missing", "note", "pending", "siteAccess"]);
  assert.equal(result.siteAccess, "limited");
  assert.deepEqual([...result.granted].sort(), [...REQUIRED].sort());
  assert.ok(result.missing.includes("<all_urls>"));
  assert.ok(result.missing.includes("proxy"));
  assert.equal(result.missing.includes("debugger"), false, "chromium-only ids are not missing in firefox");
});

test("permissions request queues the ids for the user and never grants by itself", async () => {
  const harness = boot(ONLY_REQUIRED);
  const { result } = await harness.call("local_browser_permissions", { op: "request", permissions: ["history", "storage"], reason: "Find the page the user visited yesterday" });
  assert.deepEqual(result.requested, ["history"]);
  assert.deepEqual(result.alreadyGranted, ["storage"]);
  assert.match(result.note, /press Allow/);
  assert.equal(result.pending[0].permission, "history");
  assert.equal(result.pending[0].reason, "Find the page the user visited yesterday");
  assert.equal(result.pending[0].tool, "local_browser_permissions");
  assert.equal(harness.callsOf("permissions.request").length, 0, "only a user click may call permissions.request");
  assert.equal(harness.granted.permissions.has("history"), false);
});

test("permissions request names ids firefox cannot grant", async () => {
  const harness = boot(ONLY_REQUIRED);
  const { result } = await harness.call("local_browser_permissions", { op: "request", permissions: ["debugger"] });
  assert.deepEqual(result.requested, []);
  assert.match(result.note, /Not available in Firefox: debugger/);
});

test("the api tool calls the browser API by dotted path and returns a JSON-safe value", async () => {
  const harness = boot();
  const { ok, result } = await harness.call("local_browser_api", { path: "history.search", args: [{ text: "example" }] });
  assert.equal(ok, true);
  assert.equal(result.type, "object");
  assert.equal(result.value[0].url, "https://example.test/");
  assert.deepEqual(plain(harness.callsOf("history.search")[0][1]), { text: "example" });
});

test("the api tool refuses the extension's own storage", async () => {
  const harness = boot();
  const { error } = await harness.call("local_browser_api", { path: "storage.local.get", args: ["lb.pairing"] });
  assert.equal(error.code, "local_browser_unsupported");
});

test("the api tool asks for the permission behind a namespace the user has not granted", async () => {
  const harness = boot(ONLY_REQUIRED);
  const { error } = await harness.call("local_browser_api", { path: "history.search", args: [{ text: "" }] });
  assert.equal(error.code, "local_browser_permission_required");
  assert.deepEqual(error.permissions, ["history"]);
  assert.equal(plain(harness.store.get("lb.pending"))[0].tool, "local_browser_api");
});

test("context reports the tab, its container, cookies without values, the document and access", async () => {
  const harness = boot({
    tabs: [{ id: 7, url: "https://example.test/", cookieStoreId: "firefox-container-1" }],
    cookies: [{ name: "sid", value: "secret", domain: "example.test", path: "/", session: true, httpOnly: true, secure: true, sameSite: "lax", hostOnly: true, storeId: "firefox-container-1" }],
  });
  await flush();
  const { ok, result } = await harness.call("local_browser_context", {});
  assert.equal(ok, true);
  assert.equal(result.tab.tabId, 7);
  assert.equal(result.tab.cookieStoreId, "firefox-container-1");
  assert.equal(result.tab.containerName, "Work");
  assert.deepEqual(result.container, { cookieStoreId: "firefox-container-1", isDefault: false, name: "Work", color: "blue" });
  assert.equal(result.cookies.storeId, "firefox-container-1");
  assert.equal(result.cookies.url, "https://example.test/");
  assert.equal(result.cookies.count, 1);
  assert.deepEqual(result.cookies.items[0], { name: "sid", domain: "example.test", path: "/", session: true, httpOnly: true, secure: true, sameSite: "lax", hostOnly: true });
  assert.equal(JSON.stringify(result.cookies).includes("secret"), false, "cookie values never leave through context");
  assert.equal(plain(harness.callsOf("cookies.getAll")[0][1]).storeId, "firefox-container-1");
  assert.equal(result.contentScript, "connected");
  assert.deepEqual(result.document, DOC);
  assert.equal(result.network.capturing, true);
  assert.equal(result.access.siteAccess, "all");
});

test("context in the default jar says so and reports a page the extension cannot reach", async () => {
  const harness = boot({ tabs: [{ id: 7, url: "about:addons" }], page: { silent: true } });
  const { result } = await harness.call("local_browser_context", {});
  assert.deepEqual(result.container, { cookieStoreId: "firefox-default", isDefault: true });
  assert.equal(result.contentScript, "blocked");
  assert.equal(result.document, null);
  assert.deepEqual(result.cookies, { storeId: "firefox-default", url: "about:addons", count: 0, items: [] });
});

test("context reports a missing content script on a reachable page without injecting one", async () => {
  const harness = boot({ page: { silent: true } });
  const { result } = await harness.call("local_browser_context", { cookies: false });
  assert.equal(result.contentScript, "missing");
  assert.equal(result.document, null);
  assert.equal(harness.callsOf("tabs.executeScript").length, 0);
  assert.equal(harness.callsOf("cookies.getAll").length, 0);
});

test("context without site access reports the script as blocked", async () => {
  const harness = boot({ origins: [], page: { silent: true } });
  const { result } = await harness.call("local_browser_context", {});
  assert.equal(result.contentScript, "blocked");
  assert.equal(result.access.siteAccess, "limited");
});

test("open with a cookieStoreId creates the tab in that container", async () => {
  const harness = boot();
  const { ok, result } = await harness.call("local_browser_open", { url: "https://example.test/a", cookieStoreId: "firefox-container-1" });
  assert.equal(ok, true);
  assert.equal(plain(harness.callsOf("tabs.create")[0][1]).cookieStoreId, "firefox-container-1");
  assert.equal(result.tab.cookieStoreId, "firefox-container-1");
});

test("an agent tab is reused only inside the same cookie store", async () => {
  const harness = boot();
  await harness.call("local_browser_open", { url: "https://example.test/a" });
  await harness.call("local_browser_open", { url: "https://example.test/b", cookieStoreId: "firefox-container-1" });
  await harness.call("local_browser_open", { url: "https://example.test/c", cookieStoreId: "firefox-container-1" });
  const created = harness.callsOf("tabs.create").map((entry) => plain(entry[1]));
  assert.equal(created.length, 2);
  assert.equal(created[1].cookieStoreId, "firefox-container-1");
  assert.equal(harness.tabs.get(101).url, "https://example.test/c");
  assert.equal(harness.tabs.get(100).url, "https://example.test/a");
});

test("open refuses a cookie store that does not exist", async () => {
  const harness = boot();
  const { error } = await harness.call("local_browser_open", { url: "https://example.test/", cookieStoreId: "firefox-container-9" });
  assert.equal(error.code, "local_browser_protocol_error");
  assert.match(error.hint, /local_browser_context/);
  assert.equal(harness.callsOf("tabs.create").length, 0);
});

test("open refuses to move an existing tab to another jar", async () => {
  const harness = boot();
  const { error } = await harness.call("local_browser_open", { tabId: 7, url: "https://example.test/", cookieStoreId: "firefox-container-1" });
  assert.equal(error.code, "local_browser_protocol_error");
});

test("open incognito explains how to allow private windows when the extension may not run there", async () => {
  const harness = boot();
  const { error } = await harness.call("local_browser_open", { url: "https://example.test/", incognito: true });
  assert.equal(error.code, "local_browser_unsupported");
  assert.match(error.hint, /Run in Private Windows/);
  assert.equal(harness.callsOf("windows.create").length, 0);
});

test("open incognito opens a private window when none exists, and reuses one when it does", async () => {
  const fresh = boot({ privateAllowed: true });
  const first = await fresh.call("local_browser_open", { url: "https://example.test/", incognito: true });
  assert.equal(first.ok, true);
  assert.equal(plain(fresh.callsOf("windows.create")[0][1]).incognito, true);
  assert.equal(first.result.tab.incognito, true);
  assert.equal(first.result.tab.cookieStoreId, "firefox-private");

  const existing = boot({ privateAllowed: true, windows: [{ id: 1, incognito: false }, { id: 3, incognito: true }] });
  const second = await existing.call("local_browser_open", { url: "https://example.test/", incognito: true });
  assert.equal(second.ok, true);
  assert.equal(existing.callsOf("windows.create").length, 0);
  assert.equal(plain(existing.callsOf("tabs.create")[0][1]).windowId, 3);
});

test("open newWindow opens a window in the requested container", async () => {
  const harness = boot();
  const { ok, result } = await harness.call("local_browser_open", { url: "https://example.test/", newWindow: true, cookieStoreId: "firefox-container-1" });
  assert.equal(ok, true);
  assert.deepEqual(plain(harness.callsOf("windows.create")[0][1]), { url: "https://example.test/", focused: false, cookieStoreId: "firefox-container-1" });
  assert.equal(result.tab.cookieStoreId, "firefox-container-1");
});

test("wait honours the requested timeout but never outlives the call budget", async () => {
  const harness = boot();
  await harness.call("local_browser_wait", { selector: "#x", timeoutMs: 200000 }, 240000);
  await harness.call("local_browser_wait", { selector: "#x", timeoutMs: 200000 }, 20000);
  const waits = harness.seen.filter((entry) => entry.op === "wait").map((entry) => entry.args.timeoutMs);
  assert.deepEqual(waits, [200000, 19500]);
});

test("snapshot forwards maxNodes untouched", async () => {
  const harness = boot();
  await harness.call("local_browser_snapshot", { maxNodes: 15000 });
  assert.equal(harness.seen.find((entry) => entry.op === "snapshot").args.maxNodes, 15000);
});

test("read forwards maxChars untouched", async () => {
  const harness = boot();
  await harness.call("local_browser_read", { maxChars: 1500000 });
  assert.equal(harness.seen.find((entry) => entry.op === "read").args.maxChars, 1500000);
});

test("a screenshot carries the document state", async () => {
  const harness = boot();
  const { result } = await harness.call("local_browser_screenshot", {});
  assert.deepEqual(result.document, DOC);
  assert.equal(result.fullPage, false);
});

test("a full-page screenshot goes past the old eight viewport cap", async () => {
  const harness = boot({ page: { docHeight: 12000 } });
  const { result } = await harness.call("local_browser_screenshot", { fullPage: true }, 60000);
  const scrolls = harness.seen.filter((entry) => entry.op === "scrollTo");
  assert.equal(scrolls.length, 13, "twelve frames plus the scroll back");
  assert.equal(result.height, 12000);
  assert.equal(result.truncated, undefined);
});

test("a full-page screenshot stops at the call budget and says how far it got", async () => {
  const harness = boot({ page: { docHeight: 100000 } });
  const { result } = await harness.call("local_browser_screenshot", { fullPage: true }, 1900);
  assert.equal(result.truncated, true);
  assert.equal(result.pageHeight, 100000);
  assert.ok(result.capturedHeight >= 1000 && result.capturedHeight < 100000);
  assert.match(result.note, /budget/);
});

test("local_browser_ui opens the control center on the permissions section", async () => {
  const harness = boot();
  const { ok, result } = await harness.call("local_browser_ui", { op: "open_permissions" });
  assert.equal(ok, true);
  assert.equal(result.opened, "permissions");
  assert.equal(plain(harness.callsOf("tabs.create")[0][1]).url, "moz-extension://uuid/ui/control.html#permissions");
  const overview = await harness.call("local_browser_ui", { op: "open_control_center" });
  assert.equal(overview.result.opened, "overview");
});

test("an unknown tool is refused as unsupported", async () => {
  const harness = boot();
  const { error } = await harness.call("local_browser_teleport", {});
  assert.equal(error.code, "local_browser_unsupported");
});
