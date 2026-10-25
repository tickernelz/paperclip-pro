import test from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./test-ext.mjs";

const { uiState } = loadShared(["lib/contract.js", "lib/ui-state.js"]).LB;
const contract = loadShared(["lib/contract.js"]).LB.contract;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const connected = {
  client: "chromium",
  version: "1.1.0",
  state: "connected",
  label: "Work laptop",
  origin: "https://paperclip.test",
  sessionId: "abcdef1234567890",
  tier: "refine",
  allowedOrigins: ["https://a.test"],
  tabs: [{ tabId: 1 }, { tabId: 2 }],
  access: { siteAccess: "limited", granted: ["debugger", "storage", "alarms", "activeTab", "tabs"], missing: [], pending: [] },
  guards: { protectPaperclipTab: true, protectFocusedTab: false, networkBufferSize: 2000 },
  trustedInput: { mode: "cdp" },
};

test("connection view covers every state", () => {
  const view = uiState.connection(connected);
  assert.equal(view.title, "Connected");
  assert.equal(view.tone, "ok");
  assert.equal(view.detail, "Work laptop \u00b7 https://paperclip.test");
  assert.equal(view.session, "abcdef12");
  assert.equal(view.tier, "Refine");
  assert.equal(view.tabs, "2");
  assert.equal(view.origins, "Allowed sites: https://a.test");
  assert.equal(view.showPairForm, false);
  assert.equal(view.canDisconnect, true);
  assert.equal(view.version, "Version 1.1.0");

  assert.equal(uiState.connection({ ...connected, tier: "full" }).origins, "Full tier: agents can reach every site this browser allows.");
  assert.match(uiState.connection({ ...connected, allowedOrigins: [] }).origins, /no allowed sites/);

  const retired = uiState.connection({ state: "retired", retiredReason: "revoked in Paperclip" });
  assert.equal(retired.title, "Pairing ended");
  assert.equal(retired.showPairForm, true);
  assert.match(retired.detail, /revoked in Paperclip/);

  const down = uiState.connection({ state: "disconnected", origin: "https://p.test", lastError: "socket closed" });
  assert.equal(down.canReconnect, true);
  assert.equal(down.detail, "socket closed");

  const none = uiState.connection(null);
  assert.equal(none.state, "unpaired");
  assert.equal(none.showPairForm, true);
  assert.equal(none.canDisconnect, false);
  assert.equal(uiState.connection({ state: "bogus" }).state, "unpaired");
});

test("permission rows list every supported catalog entry with status and actions", () => {
  const now = Date.now();
  const access = { ...connected.access, pending: [{ permission: "cookies", reason: "read the session cookie", tool: "local_browser_storage", at: now - 120000 }] };
  const view = uiState.permissions(access, { catalog: contract.permissions, client: "chromium", now, requestable: ["<all_urls>", "tabs", "cookies", "history"] });
  const ids = view.rows.map((row) => row.id);
  assert.ok(ids.includes("debugger"));
  assert.ok(!ids.includes("proxy"));
  assert.equal(view.total, contract.permissions.filter((entry) => entry.chromium !== "unsupported").length);
  const debuggerRow = view.rows.find((row) => row.id === "debugger");
  assert.equal(debuggerRow.status, "required");
  assert.equal(debuggerRow.canRevoke, false);
  const tabs = view.rows.find((row) => row.id === "tabs");
  assert.equal(tabs.status, "granted");
  assert.equal(tabs.canRevoke, true);
  const cookies = view.rows.find((row) => row.id === "cookies");
  assert.equal(cookies.status, "missing");
  assert.equal(cookies.canAllow, true);
  assert.equal(cookies.statusText, "Requested by an agent");
  assert.ok(cookies.grants.length > 0);
  const bookmarks = view.rows.find((row) => row.id === "bookmarks");
  assert.equal(bookmarks.canAllow, false);
  assert.deepEqual(plain(view.pending), [{ permission: "cookies", label: cookies.label, reason: "read the session cookie", tool: "local_browser_storage", age: "2 min ago" }]);
  assert.deepEqual(plain(view.missingRequestable).sort(), ["<all_urls>", "cookies", "history"]);
  assert.equal(view.allowAllLabel, "Allow all (3)");
  assert.equal(view.badge, "1");
  assert.match(view.siteLine, /limited/);
});

test("firefox rows include firefox-only permissions", () => {
  const view = uiState.permissions({ siteAccess: "all", granted: ["<all_urls>"], missing: [], pending: [] }, { catalog: contract.permissions, client: "firefox" });
  const ids = view.rows.map((row) => row.id);
  assert.ok(ids.includes("proxy") && ids.includes("contextualIdentities") && !ids.includes("debugger"));
  assert.equal(view.siteLine, "Agents can open and read any site.");
});

test("everything granted disables Allow all", () => {
  const view = uiState.permissions({ siteAccess: "all", granted: contract.permissions.map((entry) => entry.id), pending: [] }, { catalog: contract.permissions, client: "chromium" });
  assert.equal(view.allGranted, true);
  assert.equal(view.allowAllLabel, "Everything is allowed");
});

test("guards, trusted input and sections", () => {
  const guards = uiState.guards(connected.guards, { min: 50, max: 20000 });
  assert.equal(guards.networkBufferSize, 2000);
  assert.deepEqual(plain(guards.toggles).map((toggle) => [toggle.key, toggle.checked]), [["protectPaperclipTab", true], ["protectFocusedTab", false]]);

  assert.equal(uiState.section("#permissions"), "permissions");
  assert.equal(uiState.section("#welcome"), "welcome");
  assert.equal(uiState.section("#nope"), "overview");
  assert.equal(uiState.section(""), "overview");
});

test("trusted input view for Chromium", () => {
  const view = uiState.trustedInput({ mode: "cdp" }, "chromium");
  assert.equal(view.tone, "ok");
  assert.equal(view.ready, true);
  assert.equal(view.title, "Trusted input is ready (Chrome DevTools Protocol).");
  assert.equal(view.showSetup, false);
  assert.equal(view.showPort, false);
  assert.equal(view.showCheck, false);
  assert.equal(view.popupLine, "");
});

test("trusted input view for Firefox names the reason in plain words", () => {
  const now = 1000000000;
  const reasons = {
    not_running: /not started with remote debugging/,
    origin_refused: /not in --remote-allow-origins \(wrong or old id\)/,
    busy: /another automation tool is connected/i,
  };
  for (const [reason, pattern] of Object.entries(reasons)) {
    const view = uiState.trustedInput({ mode: "synthetic", port: 9333, origin: "moz-extension://u", reason, checkedAt: now - 5000 }, "firefox", now);
    assert.equal(view.title, "Not active");
    assert.equal(view.tone, "warn");
    assert.equal(view.ready, false);
    assert.equal(view.reason, reason);
    assert.match(view.detail, pattern);
    assert.equal(view.port, 9333);
    assert.equal(view.origin, "moz-extension://u");
    assert.equal(view.checked, "Last checked just now.");
    assert.equal(view.showSetup, true);
    assert.equal(view.showCheck, true);
    assert.equal(view.showPort, true);
    assert.equal(view.popupLine, "Trusted input: off");
    assert.match(view.benefit, /synthetic events/);
  }
  const unknown = uiState.trustedInput({ mode: "synthetic", reason: "weird" }, "firefox", now);
  assert.equal(unknown.reason, "");
  assert.equal(unknown.detail, "Not checked yet.");
  assert.equal(unknown.checked, "");
  assert.equal(unknown.port, null);
  const ready = uiState.trustedInput({ mode: "bidi", port: 9333, checkedAt: now - 120000 }, "firefox", now);
  assert.equal(ready.title, "Ready");
  assert.equal(ready.detail, "WebDriver BiDi, port 9333.");
  assert.equal(ready.tone, "ok");
  assert.equal(ready.checked, "Last checked 2 min ago.");
  assert.equal(ready.popupLine, "Trusted input: on");
  assert.equal(uiState.trustedInput({ mode: "synthetic", port: 70000 }, "firefox").port, null);
  assert.equal(uiState.control({ ...connected, client: "firefox", trustedInput: { mode: "bidi", port: 9222, checkedAt: now } }, { client: "firefox", now }).trustedInput.checked, "Last checked just now.");
});

test("age text and response unwrapping", () => {
  const now = 1000000000;
  assert.equal(uiState.ageText(now - 10000, now), "just now");
  assert.equal(uiState.ageText(now - 3 * 3600000, now), "3 h ago");
  assert.equal(uiState.ageText(now - 4 * 86400000, now), "4 days ago");
  assert.equal(uiState.ageText(undefined, now), "");
  assert.deepEqual(plain(uiState.unwrap({ ok: false, error: "nope" })), { ok: false, error: "nope", status: null });
  assert.equal(uiState.unwrap(undefined).ok, false);
  assert.equal(uiState.unwrap({ status: connected }).ok, true);
});

test("popup and control views compose the same pieces", () => {
  const options = { catalog: contract.permissions, client: "chromium" };
  const popup = uiState.popup(connected, options);
  assert.equal(popup.ready, true);
  assert.equal(popup.showAllowAll, true);
  assert.equal(popup.showPending, false);
  const control = uiState.control(connected, options);
  assert.equal(control.trustedInput.mode, "cdp");
  assert.equal(popup.trusted.show, false);
  const firefox = uiState.popup({ ...connected, client: "firefox", trustedInput: { mode: "synthetic", reason: "busy" } }, { ...options, client: "firefox" });
  assert.deepEqual(plain(firefox.trusted), { show: true, text: "Trusted input: off", showSetup: true });
  const on = uiState.popup({ ...connected, client: "firefox", trustedInput: { mode: "bidi", port: 9222 } }, { ...options, client: "firefox" });
  assert.deepEqual(plain(on.trusted), { show: true, text: "Trusted input: on", showSetup: false });
  assert.equal(uiState.popup(null, { ...options, client: "firefox" }).trusted.show, false);
  assert.equal(control.guards.networkBufferSize, 2000);
  assert.equal(uiState.control(null, options).ready, false);
});

test("the view honours a live access snapshot over the status copy", () => {
  const view = uiState.control(connected, { catalog: contract.permissions, client: "chromium", access: { siteAccess: "all", granted: ["<all_urls>"], pending: [] } });
  assert.equal(view.permissions.siteAccess, "all");
});
