import test from "node:test";
import assert from "node:assert/strict";

import { bootBackground, flush, plain } from "./harness.test.mjs";

const PAPERCLIP_TAB = {
  id: 12,
  windowId: 1,
  title: "Local Browser",
  url: "https://paperclip.test/apps/conn-1",
  active: true,
  status: "complete",
};

function boot(options = {}) {
  const marker = options.marker === undefined ? null : options.marker;
  return bootBackground({
    tabs: [options.tab || PAPERCLIP_TAB],
    executeScript: () => [marker],
    ...options,
  });
}

function send(harness, op, payload = {}) {
  return harness.control({ ...payload, channel: "lb-control", op });
}

test("status answers with the documented envelope and status object", async () => {
  const harness = boot();
  const response = await send(harness, "status");
  assert.equal(response.ok, true);
  const status = response.status;
  assert.equal(status.client, "firefox");
  assert.equal(status.version, "1.1.0");
  assert.equal(status.state, "unpaired");
  assert.equal(status.sessionId, null);
  assert.ok(Array.isArray(status.tabs));
  assert.equal(status.tabs[0].tabId, 12);
  assert.equal(status.access.siteAccess, "all");
  assert.deepEqual(status.access.missing, []);
  assert.deepEqual(status.guards, { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 });
  assert.equal(status.trustedInput.mode, "synthetic");
  assert.match(status.trustedInput.command, /--remote-debugging-port 9222/);
});

test("status reports narrowed site access and the missing ids", async () => {
  const harness = boot({ origins: [], permissions: ["storage", "activeTab", "contextualIdentities"] });
  const response = await send(harness, "status");
  assert.equal(response.status.access.siteAccess, "limited");
  assert.ok(response.status.access.missing.includes("<all_urls>"));
  assert.ok(response.status.access.missing.includes("cookies"));
  assert.equal(response.status.access.missing.includes("storage"), false);
});

test("detect offers the pairing link found in the open Paperclip tab", async () => {
  const harness = boot({ marker: { origin: "https://paperclip.test", code: "F6BX2X8R" } });
  const response = await send(harness, "detect");
  assert.equal(response.ok, true);
  assert.deepEqual(response.detected, { input: "https://paperclip.test/?code=F6BX2X8R" });
  assert.equal(harness.callsOf("tabs.executeScript").length, 1, "the page is read once");
  assert.equal(harness.callsOf("tabs.executeScript")[0][1], 12);
});

test("the detected input pairs as it is", async () => {
  const harness = boot({ marker: { origin: "https://paperclip.test", code: "F6BX2X8R" } });
  const detected = await send(harness, "detect");
  const paired = await send(harness, "pair", { input: detected.detected.input });
  assert.equal(paired.ok, true);
  assert.equal(harness.store.get("lb.pairing").origin, "https://paperclip.test");
  assert.match(harness.sockets.at(-1).url, /^wss:\/\/paperclip\.test\/api\/local-browser\/bridge\?code=F6BX2X8R$/);
  assert.equal(paired.status.state, "connecting");
});

test("detect falls back to the tab origin when the page gives none", async () => {
  const harness = boot({ marker: { origin: "", code: "F6BX2X8R" } });
  const response = await send(harness, "detect");
  assert.deepEqual(response.detected, { input: "https://paperclip.test/?code=F6BX2X8R" });
});

test("detect returns null when the tab has no pairing marker", async () => {
  const harness = boot();
  const response = await send(harness, "detect");
  assert.equal(response.ok, true);
  assert.equal(response.detected, null);
});

test("detect ignores a tab that is not an http page", async () => {
  const harness = boot({ tab: { ...PAPERCLIP_TAB, url: "about:addons" }, marker: { code: "F6BX2X8R" } });
  const response = await send(harness, "detect");
  assert.equal(response.detected, null);
  assert.equal(harness.callsOf("tabs.executeScript").length, 0);
});

test("pair accepts a bare host link and stores a normalised origin", async () => {
  const harness = boot();
  const response = await send(harness, "pair", { input: "app.paperclip.example/?code=F6BX2X8R" });
  assert.equal(response.ok, true);
  assert.equal(harness.store.get("lb.pairing").origin, "https://app.paperclip.example");
  assert.equal(harness.sockets.at(-1).url.includes("code=F6BX2X8R"), true);
});

test("pair refuses a non-web address with a message that names the problem", async () => {
  const harness = boot();
  const response = await send(harness, "pair", { input: "ftp://paperclip.test/?code=F6BX2X8R" });
  assert.equal(response.ok, false);
  assert.match(response.error, /http or https/);
  assert.equal(response.status.state, "unpaired");
  assert.equal(harness.sockets.length, 0);
});

test("a bare code needs a Paperclip address the browser already knows", async () => {
  const fresh = boot();
  const refused = await send(fresh, "pair", { input: "F6BX2X8R" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /whole pairing link/);

  const known = boot({ storage: { "lb.pairing": { origin: "https://paperclip.test", label: "Work", sessionToken: null, retiredAt: "2026-10-01T00:00:00Z", retiredReason: "expired" } } });
  await known.LB.bridge.start();
  const paired = await send(known, "pair", { input: "F6BX2X8R" });
  assert.equal(paired.ok, true);
  assert.equal(known.store.get("lb.pairing").origin, "https://paperclip.test");
  assert.equal(known.store.get("lb.pairing").label, "Work");
});

test("a link without a code asks for the whole link", async () => {
  const harness = boot();
  const response = await send(harness, "pair", { input: "https://paperclip.test" });
  assert.equal(response.ok, false);
  assert.match(response.error, /no pairing code/);
});

test("guards.set persists the patch and the status shows it", async () => {
  const harness = boot();
  const response = await send(harness, "guards.set", { patch: { protectFocusedTab: false, networkBufferSize: 99999 } });
  assert.equal(response.ok, true);
  assert.equal(response.status.guards.protectFocusedTab, false);
  assert.equal(response.status.guards.networkBufferSize, 20000, "the buffer is clamped to the guard bounds");
  assert.equal(harness.store.get("lb.guards").protectFocusedTab, false);
  assert.equal(harness.LB.guards.current().protectFocusedTab, false);
});

test("pending.clear dismisses queued agent requests", async () => {
  const harness = boot({ permissions: ["storage", "activeTab", "contextualIdentities"] });
  await harness.LB.access.queue(["cookies", "history"], { tool: "local_browser_permissions", reason: "Read the jar" });
  let status = (await send(harness, "status")).status;
  assert.deepEqual(status.access.pending.map((item) => item.permission).sort(), ["cookies", "history"]);
  status = (await send(harness, "pending.clear", { permissions: ["cookies"] })).status;
  assert.deepEqual(status.access.pending.map((item) => item.permission), ["history"]);
  status = (await send(harness, "pending.clear")).status;
  assert.deepEqual(status.access.pending, []);
});

test("bidi.set stores the port and the launch command follows it", async () => {
  const harness = boot();
  const response = await send(harness, "bidi.set", { port: 9333 });
  assert.equal(response.ok, true);
  assert.deepEqual(plain(harness.store.get("lb.bidi")), { port: 9333 });
  assert.match(response.status.trustedInput.command, /--remote-debugging-port 9333/);
  const refused = await send(harness, "bidi.set", { port: 70000 });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /1 and 65535/);
});

test("an unknown op fails with a sentence and the status", async () => {
  const harness = boot();
  const response = await send(harness, "ops");
  assert.equal(response.ok, false);
  assert.match(response.error, /Unknown control op ops/);
  assert.equal(response.status.state, "unpaired");
});

test("state changes broadcast lb-status with the full status", async () => {
  const harness = boot();
  await flush();
  harness.calls.length = 0;
  await send(harness, "pair", { input: "https://paperclip.test/?code=F6BX2X8R" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  await flush();
  const broadcasts = harness.callsOf("runtime.sendMessage").map((entry) => entry[1]).filter((message) => message.channel === "lb-status");
  assert.ok(broadcasts.length >= 1);
  assert.equal(broadcasts.at(-1).status.state, "connecting");
  assert.equal(broadcasts.at(-1).status.origin, "https://paperclip.test");
  assert.equal("state" in broadcasts.at(-1), false, "the old state field is gone");
});

test("the background answers lb-control messages through runtime.onMessage", async () => {
  const harness = boot();
  const listeners = harness.browser.runtime.onMessage.listeners.map((entry) => entry.fn);
  const answers = listeners.map((fn) => fn({ channel: "lb-control", op: "status" })).filter(Boolean);
  assert.equal(answers.length, 1);
  assert.equal((await answers[0]).ok, true);
  assert.equal(listeners.map((fn) => fn({ channel: "other", op: "status" })).filter(Boolean).length, 0);
});
