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

  assert.equal(uiState.trustedInput({ mode: "cdp" }, "chromium").tone, "ok");
  const synthetic = uiState.trustedInput({ mode: "synthetic", hint: "Start Firefox like this", command: "firefox --remote-debugging-port 9222" }, "firefox");
  assert.equal(synthetic.showCommand, true);
  assert.equal(synthetic.showPort, true);
  assert.equal(uiState.trustedInput({ mode: "bidi", command: "x" }, "firefox").showCommand, false);

  assert.equal(uiState.section("#permissions"), "permissions");
  assert.equal(uiState.section("#welcome"), "welcome");
  assert.equal(uiState.section("#nope"), "overview");
  assert.equal(uiState.section(""), "overview");
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
  assert.equal(control.guards.networkBufferSize, 2000);
  assert.equal(uiState.control(null, options).ready, false);
});

test("the view honours a live access snapshot over the status copy", () => {
  const view = uiState.control(connected, { catalog: contract.permissions, client: "chromium", access: { siteAccess: "all", granted: ["<all_urls>"], pending: [] } });
  assert.equal(view.permissions.siteAccess, "all");
});
