import test from "node:test";
import assert from "node:assert/strict";
import { boot, everyPermission, flush, manifest, plain, FAKE_DOCUMENT } from "./harness.test.mjs";

function grantedWithout(...ids) {
  const all = everyPermission();
  return {
    permissions: all.permissions.filter((id) => !ids.includes(id)),
    origins: all.origins.filter((id) => !ids.includes(id)),
  };
}

test("a page tool without site access fails with permission_required and queues the request", async () => {
  const context = await boot({ granted: { permissions: [...manifest.permissions], origins: [] } });
  const result = await context.call("local_browser_snapshot", { tabId: 7 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_permission_required");
  assert.equal(result.error.retryable, true);
  assert.deepEqual([...result.error.permissions].sort(), ["<all_urls>", "scripting"]);
  assert.equal(context.rpcs.length, 0, "nothing reaches the page before the permission exists");
  const pending = context.stored["lb.pending"].map((entry) => entry.permission).sort();
  assert.deepEqual(pending, ["<all_urls>", "scripting"]);
  assert.equal(context.stored["lb.pending"][0].tool, "local_browser_snapshot");
});

test("downloads need the downloads permission", async () => {
  const context = await boot({ granted: grantedWithout("downloads") });
  const result = await context.call("local_browser_download", { op: "list" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_permission_required");
  assert.deepEqual(result.error.permissions, ["downloads"]);
});

test("the download list keeps downloads from every origin", async () => {
  const context = await boot({
    downloads: {
      search: async () => [
        { id: 1, filename: "/tmp/a.pdf", url: "https://p.test/a.pdf", referrer: "https://p.test/", state: "complete" },
        { id: 2, filename: "C:\\dl\\b.zip", url: "https://elsewhere.test/b.zip", state: "complete" },
      ],
    },
  });
  const result = await context.call("local_browser_download", { op: "list" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.total, 2);
  assert.deepEqual(result.result.downloads.map((row) => row.name), ["a.pdf", "b.zip"]);
});

test("local_browser_context reports tab, container, cookies without values, document, network and access", async () => {
  const context = await boot({
    cookies: {
      getAll: async (query) => {
        assert.deepEqual({ ...query }, { url: "https://p.test/", storeId: "0" });
        return [
          { name: "sid", value: "secret", domain: "p.test", path: "/", secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: "lax", storeId: "0" },
          { name: "pref", value: "x", domain: ".p.test", path: "/", secure: false, httpOnly: false, hostOnly: false, session: false, expirationDate: 1893456000, sameSite: "unspecified", storeId: "0" },
        ];
      },
      getAllCookieStores: async () => [{ id: "0", tabIds: [7] }],
    },
  });
  const result = await context.call("local_browser_context", { tabId: 7 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const value = result.result;
  assert.deepEqual(Object.keys(value).sort(), ["access", "container", "contentScript", "cookies", "document", "network", "tab"]);
  assert.equal(value.tab.tabId, 7);
  assert.equal(value.tab.cookieStoreId, "0");
  assert.deepEqual(value.container, { cookieStoreId: "0", name: "Default", isDefault: true });
  assert.equal(value.cookies.storeId, "0");
  assert.equal(value.cookies.url, "https://p.test/");
  assert.equal(value.cookies.count, 2);
  for (const item of value.cookies.items) assert.equal("value" in item, false, "context never returns cookie values");
  assert.deepEqual(value.cookies.items[0], { name: "sid", domain: "p.test", path: "/", session: true, httpOnly: true, secure: true, sameSite: "lax", hostOnly: true });
  assert.equal(value.cookies.items[1].expirationDate, 1893456000);
  assert.deepEqual(value.document, FAKE_DOCUMENT);
  assert.equal(value.contentScript, "connected");
  assert.equal(value.network.capturing, true);
  assert.equal(value.access.siteAccess, "all");
  assert.deepEqual(value.access.missing, []);
});

test("local_browser_context marks a restricted page as blocked without failing", async () => {
  const context = await boot({ tab: { url: "chrome://settings/" }, onRpc: () => "missing" });
  const result = await context.call("local_browser_context", { tabId: 7, cookies: false });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.contentScript, "blocked");
  assert.equal(result.result.document, null);
  assert.equal(result.result.cookies.count, 0);
});

test("local_browser_api routes a dotted path to the browser API and returns a JSON-safe value", async () => {
  const context = await boot();
  const result = await context.call("local_browser_api", { path: "history.search", args: [{ text: "news" }] });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.type, "object");
  assert.deepEqual(result.result.value, [{ url: "https://h.test/", title: "H", text: "news" }]);
});

test("local_browser_api refuses the extension's own storage", async () => {
  const context = await boot();
  const result = await context.call("local_browser_api", { path: "storage.local.get", args: ["lb.pairing"] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_unsupported");
});

test("local_browser_api asks for the permission behind a namespace that is not granted", async () => {
  const context = await boot({ granted: grantedWithout("bookmarks") });
  const result = await context.call("local_browser_api", { path: "bookmarks.getTree" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_permission_required");
  assert.deepEqual(result.error.permissions, ["bookmarks"]);
  assert.equal(context.stored["lb.pending"][0].permission, "bookmarks");
});

test("local_browser_permissions status lists what is granted and missing", async () => {
  const context = await boot({ granted: grantedWithout("history") });
  const result = await context.call("local_browser_permissions", { op: "status" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(result.result.missing, ["history"]);
  assert.equal(result.result.granted.includes("cookies"), true);
  assert.equal(result.result.siteAccess, "all");
  assert.equal(typeof result.result.note, "string");
});

test("local_browser_permissions request queues ids and tells the agent to ask the user", async () => {
  const context = await boot({ granted: grantedWithout("history") });
  const result = await context.call("local_browser_permissions", { op: "request", permissions: ["history", "cookies"], reason: "Read the visit history" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(result.result.requested, ["history"]);
  assert.deepEqual(result.result.alreadyGranted, ["cookies"]);
  assert.match(result.result.note, /press Allow/);
  assert.equal(result.result.pending[0].permission, "history");
  assert.equal(result.result.pending[0].reason, "Read the visit history");
});

test("local_browser_ui opens the control center on the permissions section", async () => {
  const context = await boot();
  const result = await context.call("local_browser_ui", { op: "open_permissions" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const created = context.callsOf("tabs.create").map((entry) => entry[1].url);
  assert.equal(created.some((url) => /ui\/control\.html#permissions$/.test(url)), true, JSON.stringify(created));
});

test("opening incognito when the extension is not allowed there says how to enable it", async () => {
  const context = await boot({ incognitoAllowed: false });
  const result = await context.call("local_browser_open", { url: "https://example.test/", incognito: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_unsupported");
  assert.match(result.error.hint, /Allow in Incognito/);
  assert.equal(context.created.length, 0, "no tab may open in the wrong jar");
});

test("opening incognito when allowed creates a private window in store 1", async () => {
  const context = await boot({ incognitoAllowed: true });
  const result = await context.call("local_browser_open", { url: "https://example.test/", cookieStoreId: "1" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const windows = context.callsOf("windows.create");
  assert.equal(windows.length, 1);
  assert.equal(windows[0][1].incognito, true);
  assert.equal(result.result.tab.incognito, true);
  assert.equal(result.result.tab.cookieStoreId, "1");
});

test("a cookie store Chromium does not have is refused", async () => {
  const context = await boot();
  const result = await context.call("local_browser_open", { url: "https://example.test/", cookieStoreId: "firefox-container-1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_unsupported");
  assert.match(result.error.message, /store 0 and the incognito store 1/);
});

test("newWindow opens the url in a fresh regular window", async () => {
  const context = await boot();
  const result = await context.call("local_browser_open", { url: "https://example.test/", newWindow: true });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const windows = context.callsOf("windows.create");
  assert.equal(windows.length, 1);
  assert.equal(windows[0][1].incognito, false);
  assert.equal(windows[0][1].url, "https://example.test/");
});

test("turning off the focused-tab guard lets navigate drive the tab the user is on", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://app.test/x", active: true, status: "complete" });
  const refused = await context.call("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test/" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "local_browser_navigation_blocked");
  const answer = await context.control("guards.set", { patch: { protectFocusedTab: false } });
  assert.equal(answer.ok, true);
  assert.equal(answer.status.guards.protectFocusedTab, false);
  const allowed = await context.call("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test/" });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error || {}));
  assert.equal(context.tabsById.get(8).url, "https://elsewhere.test/");
});

test("turning off the Paperclip-tab guard lets navigate move the Paperclip tab", async () => {
  const context = await boot({ storage: { "lb.guards": { protectPaperclipTab: false, protectFocusedTab: true, networkBufferSize: 1000 } } });
  context.tabsById.get(7).active = false;
  context.tabsById.set(55, { id: 55, windowId: 1, title: "P", url: "https://p.test/apps", active: false, status: "complete" });
  context.tabsById.set(56, { id: 56, windowId: 1, title: "O", url: "https://other.test/", active: true, status: "complete" });
  const result = await context.call("local_browser_navigate", { tabId: 55, url: "https://elsewhere.test/" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
});

function actPage(prepared, extra = {}) {
  return (payload) => {
    if (payload.op === "actPrepare") return { ok: true, result: { url: "https://p.test/", mutations: 3, covered: false, ...prepared } };
    if (payload.op === "actSettle") return { ok: true, result: { ok: true, url: "https://p.test/next", title: "Next", changed: true } };
    if (payload.op === "act") return { ok: true, result: { ok: true, url: "https://p.test/", title: "P", changed: true } };
    return extra[payload.op];
  };
}

function cdp(context, method) {
  return context.calls.filter((entry) => entry[0] === "debugger.sendCommand" && (!method || entry[2] === method)).map((entry) => plain(entry[3]));
}

test("act with force on a covered target runs page events on the target and says so", async () => {
  const context = await boot({ onRpc: actPage({ covered: true }) });
  const result = await context.call("local_browser_act", { tabId: 7, action: "click", selector: "button", force: true });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.forced, true);
  assert.equal(result.result.input, "synthetic");
  assert.match(result.result.note, /covers this target/);
  const act = context.rpcs.find((entry) => entry.op === "act");
  assert.equal(act.args.force, true);
  assert.equal(cdp(context).length, 0, "no trusted click lands on the cover");
});

test("act click sends trusted mouse events at the element centre in CSS pixels", async () => {
  const context = await boot({ onRpc: actPage({ x: 60, y: 25 }), viewport: { width: 800, height: 600, dpr: 2 } });
  const result = await context.call("local_browser_act", { tabId: 7, action: "click", ref: "e3" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(plain(result.result), { ok: true, url: "https://p.test/next", title: "Next", changed: true, input: "trusted" });
  assert.deepEqual(cdp(context, "Input.dispatchMouseEvent"), [
    { type: "mouseMoved", x: 60, y: 25, button: "none", buttons: 0 },
    { type: "mousePressed", x: 60, y: 25, button: "left", clickCount: 1, buttons: 1 },
    { type: "mouseReleased", x: 60, y: 25, button: "left", clickCount: 1, buttons: 0 },
  ]);
  assert.equal(context.rpcs.some((entry) => entry.op === "act"), false, "no synthetic events after a trusted click");
  const settle = context.rpcs.find((entry) => entry.op === "actSettle");
  assert.deepEqual(plain(settle.args), { url: "https://p.test/", mutations: 3 });
  assert.equal(context.calls.filter((entry) => entry[0] === "debugger.attach").length, 1);
  await context.call("local_browser_act", { tabId: 7, action: "hover", ref: "e3" });
  assert.equal(context.calls.filter((entry) => entry[0] === "debugger.attach").length, 1, "the debugger stays attached between acts");
  assert.deepEqual(cdp(context, "Input.dispatchMouseEvent").slice(3), [{ type: "mouseMoved", x: 60, y: 25, button: "none", buttons: 0 }]);
});

test("act dblclick sends two presses with rising click counts", async () => {
  const context = await boot({ onRpc: actPage({ x: 5, y: 9 }) });
  await context.call("local_browser_act", { tabId: 7, action: "dblclick", ref: "e3" });
  const presses = cdp(context, "Input.dispatchMouseEvent").filter((event) => event.type === "mousePressed");
  assert.deepEqual(presses.map((event) => event.clickCount), [1, 2]);
});

test("act type focuses with a trusted click, selects all and inserts the text", async () => {
  const context = await boot({ onRpc: actPage({ x: 40, y: 12 }) });
  const result = await context.call("local_browser_act", { tabId: 7, action: "type", ref: "e2", text: "hello", submit: true });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.input, "trusted");
  const commands = context.calls.filter((entry) => entry[0] === "debugger.sendCommand").map((entry) => [entry[2], plain(entry[3])]);
  assert.deepEqual(commands.slice(0, 3).map(([, params]) => params.type), ["mouseMoved", "mousePressed", "mouseReleased"]);
  const selectAll = commands[3][1];
  assert.equal(selectAll.type, "rawKeyDown");
  assert.equal(selectAll.key, "a");
  assert.deepEqual(selectAll.commands, ["selectAll"]);
  assert.equal(selectAll.modifiers, 2);
  assert.equal(commands[4][1].type, "keyUp");
  assert.deepEqual(commands[5], ["Input.insertText", { text: "hello" }]);
  assert.deepEqual(commands.slice(6).map(([, params]) => [params.type, params.key]), [
    ["rawKeyDown", "Enter"],
    ["char", "Enter"],
    ["keyUp", "Enter"],
  ]);
});

test("act press sends trusted key events with modifiers from the key string", async () => {
  const context = await boot({ onRpc: actPage({}) });
  const result = await context.call("local_browser_act", { tabId: 7, action: "press", ref: "e2", key: "Shift+Tab" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.input, "trusted");
  assert.deepEqual(
    cdp(context, "Input.dispatchKeyEvent").map((event) => [event.type, event.key, event.code, event.modifiers]),
    [
      ["rawKeyDown", "Tab", "Tab", 8],
      ["keyUp", "Tab", "Tab", 8],
    ],
  );
  assert.equal(cdp(context, "Input.dispatchMouseEvent").length, 0);
});

test("act check on an already checked box sends no click", async () => {
  const context = await boot({ onRpc: actPage({ x: 1, y: 1, done: true }) });
  const result = await context.call("local_browser_act", { tabId: 7, action: "check", ref: "e2" });
  assert.equal(result.result.input, "trusted");
  assert.equal(cdp(context).length, 0);
});

test("act in auto falls back to page events with a note when Chrome refuses the debugger", async () => {
  const context = await boot({ onRpc: actPage({ x: 60, y: 25 }), debuggerRefuses: true });
  const result = await context.call("local_browser_act", { tabId: 7, action: "click", ref: "e3" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.input, "synthetic");
  assert.match(result.result.note, /Trusted input is off/);
  assert.ok(context.rpcs.some((entry) => entry.op === "act"));
});

test("act with input trusted fails unsupported when Chrome refuses the debugger", async () => {
  const context = await boot({ onRpc: actPage({ x: 60, y: 25 }), debuggerRefuses: true });
  const result = await context.call("local_browser_act", { tabId: 7, action: "click", ref: "e3", input: "trusted" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_unsupported");
  assert.equal(context.rpcs.some((entry) => entry.op === "act"), false);
});

test("act with input synthetic and non-pointer actions never touch the debugger", async () => {
  const context = await boot({ onRpc: actPage({ x: 60, y: 25 }) });
  const synthetic = await context.call("local_browser_act", { tabId: 7, action: "click", ref: "e3", input: "synthetic" });
  assert.equal(synthetic.result.input, "synthetic");
  assert.equal("note" in synthetic.result, false);
  const scroll = await context.call("local_browser_act", { tabId: 7, action: "scroll", ref: "e3", deltaY: 200 });
  assert.equal(scroll.result.input, "synthetic");
  assert.equal(context.rpcs.some((entry) => entry.op === "actPrepare"), false);
  assert.equal(context.calls.filter((entry) => entry[0] === "debugger.attach").length, 0);
});

test("key strings parse into a key and modifiers", async () => {
  const context = await boot();
  const parse = (text) => plain(context.LB.bg.input.parseCombo(text));
  assert.deepEqual(parse("Control+a"), { key: "a", alt: false, ctrl: true, meta: false, shift: false });
  assert.deepEqual(parse("Meta+Shift+enter"), { key: "Enter", alt: false, ctrl: false, meta: true, shift: true });
  assert.deepEqual(parse("Control++"), { key: "+", alt: false, ctrl: true, meta: false, shift: false });
  assert.deepEqual(parse("+"), { key: "+", alt: false, ctrl: false, meta: false, shift: false });
  assert.deepEqual(parse("a+b"), { key: "a+b", alt: false, ctrl: false, meta: false, shift: false });
});

test("tabs report container, incognito, discarded, frozen, pinned and audible", async () => {
  const context = await boot({
    tabs: [{ id: 12, windowId: 3, title: "Muted", url: "https://m.test/", active: false, status: "unloaded", discarded: true, frozen: true, pinned: true, audible: true, incognito: true }],
  });
  const result = await context.call("local_browser_sessions", {});
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const tab = result.result.tabs.find((entry) => entry.tabId === 12);
  assert.deepEqual(tab, {
    tabId: 12,
    windowId: 3,
    title: "Muted",
    url: "https://m.test/",
    active: false,
    status: "unloaded",
    cookieStoreId: "1",
    incognito: true,
    discarded: true,
    pinned: true,
    audible: true,
    frozen: true,
  });
  await flush();
});
