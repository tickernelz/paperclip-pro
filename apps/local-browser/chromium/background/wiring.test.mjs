import test from "node:test";
import assert from "node:assert/strict";
import { boot, frames, sleep } from "./harness.test.mjs";

test("a dpr 2 capture reports CSS pixels of the viewport", async () => {
  const context = await boot({ viewport: { width: 800, height: 600, dpr: 2 }, bitmapWidth: 1600, bitmapHeight: 1200 });
  await context.call("local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await sleep(400);
  const captured = frames(context.sent, "frame");
  assert.equal(captured.length >= 1, true, "the viewer must emit at least one frame");
  assert.equal(captured[0].data.width, 800);
  assert.equal(captured[0].data.height, 600);
  await context.call("local_browser_viewer", { op: "stop" });
});

test("opening a url uses a fresh tab instead of the tab the user is looking at", async () => {
  const context = await boot();
  const result = await context.call("local_browser_open", { url: "https://example.test/page" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(context.created.length, 1, "a new tab must be created");
  assert.equal(context.created[0].url, "https://example.test/page");
  assert.equal(context.tabsById.get(7).url, "https://p.test/", "the focused tab keeps its url");
  assert.equal(result.result.tab.cookieStoreId, "0");
  assert.equal(result.result.tab.incognito, false);
});

test("navigate refuses the tab the user is looking at and names the way out", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://app.test/x", active: true, status: "complete" });
  const result = await context.call("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_navigation_blocked");
  assert.match(result.error.message, /tab the user is looking at/);
  assert.match(result.error.hint, /local_browser_open/);
  assert.equal(context.tabsById.get(8).url, "https://app.test/x", "the tab keeps its url");
});

test("navigate refuses the Paperclip tab even when it is not focused", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(55, { id: 55, windowId: 1, title: "P", url: "https://p.test/apps", active: false, status: "complete" });
  context.tabsById.set(56, { id: 56, windowId: 1, title: "O", url: "https://other.test/", active: true, status: "complete" });
  const result = await context.call("local_browser_navigate", { tabId: 55, url: "https://elsewhere.test" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_navigation_blocked");
  assert.match(result.error.message, /belongs to Paperclip/);
  assert.equal(context.tabsById.get(55).url, "https://p.test/apps");
});

test("screenshotting a background tab never brings it to the front", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://user.test/", active: true, status: "complete" });
  const result = await context.call("local_browser_screenshot", { tabId: 7 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const activations = context.callsOf("tabs.update").filter((entry) => entry[2] && entry[2].active === true);
  assert.equal(activations.length, 0, "no call may activate a tab");
  assert.equal(context.tabsById.get(8).active, true, "the user tab keeps focus");
  assert.equal(result.result.document.documentId, "doc-1", "the capture carries the document state");
});

test("a viewer frame on a background tab leaves focus alone", async () => {
  const context = await boot();
  context.tabsById.get(7).active = false;
  context.tabsById.set(8, { id: 8, windowId: 1, title: "U", url: "https://user.test/", active: true, status: "complete" });
  await context.call("local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await sleep(500);
  await context.call("local_browser_viewer", { op: "stop" });
  const activations = context.callsOf("tabs.update").filter((entry) => entry[2] && entry[2].active === true);
  assert.equal(activations.length, 0, "the viewer must not activate the watched tab");
});

test("opening a second url reuses the agent tab instead of piling up tabs", async () => {
  const context = await boot();
  await context.call("local_browser_open", { url: "https://example.test/one" });
  await context.call("local_browser_open", { url: "https://example.test/two" });
  assert.equal(context.created.length, 1, "one agent tab serves every open");
  assert.equal(context.tabsById.get(99).url, "https://example.test/two");
});

test("a tab the agent opened stays navigable", async () => {
  const context = await boot();
  const opened = await context.call("local_browser_open", { url: "https://example.test/page" });
  assert.equal(opened.ok, true, JSON.stringify(opened.error || {}));
  const moved = await context.call("local_browser_navigate", { tabId: 99, url: "https://example.test/next" });
  assert.equal(moved.ok, true, JSON.stringify(moved.error || {}));
  assert.equal(context.tabsById.get(99).url, "https://example.test/next");
});

test("a revoked site access answers with the grant hint instead of a raw browser error", async () => {
  const context = await boot({
    executeScript: async () => {
      throw new Error('Cannot access contents of url "https://bank.test/". Extension manifest must request permission to access this host.');
    },
  });
  const result = await context.call("local_browser_evaluate", { tabId: 7, expression: "document.title" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_origin_denied");
  assert.match(result.error.hint, /site access/i);
  assert.equal(/Cannot access contents/.test(result.error.message), false);
});

test("an unanswerable viewport rpc falls back to the page and still reports CSS pixels", async () => {
  const context = await boot({
    viewportRpcFails: true,
    injectionViewport: { width: 800, height: 600, dpr: 2 },
    bitmapWidth: 1600,
    bitmapHeight: 1200,
  });
  await context.call("local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await sleep(400);
  const captured = frames(context.sent, "frame");
  assert.equal(captured.length >= 1, true, "the viewer must emit at least one frame");
  assert.equal(captured[0].data.width, 800, "must not advertise the 1600px device-pixel width");
  assert.equal(captured[0].data.height, 600);
  await context.call("local_browser_viewer", { op: "stop" });
});

test("a wrong dpr is corrected by the viewport instead of scaling takeover coordinates", async () => {
  const context = await boot({ viewport: { width: 800, height: 600, dpr: 1 }, bitmapWidth: 1600, bitmapHeight: 1200 });
  await context.call("local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await sleep(400);
  const captured = frames(context.sent, "frame");
  assert.equal(captured.length >= 1, true);
  assert.equal(captured[0].data.width, 800);
  assert.equal(captured[0].data.height, 600);
  await context.call("local_browser_viewer", { op: "stop" });
});

test("an untrusted injected viewport that lies is refused instead of mislabelling the frame", async () => {
  const context = await boot({
    viewportRpcFails: true,
    injectionViewport: { width: 1600, height: 1200, dpr: 1 },
    bitmapWidth: 1600,
    bitmapHeight: 1200,
  });
  await context.call("local_browser_viewer", { op: "start", tabId: 7, intervalMs: 250 });
  await sleep(400);
  assert.equal(frames(context.sent, "frame").length, 0, "a page must not be able to choose the coordinate space of the frame");
  const states = frames(context.sent, "state");
  assert.equal(states.length >= 1, true);
  assert.equal(states[states.length - 1].data.state, "viewer_unavailable");
  assert.match(String(states[states.length - 1].data.message), /viewport/i);
  await context.call("local_browser_viewer", { op: "stop" });
});

test("close 1008 retires the pairing and never reconnects", async () => {
  const context = await boot();
  const before = context.FakeSocket.instances.length;
  context.socket.emit("close", { code: 1008, reason: "session token is not usable" });
  await sleep(1400);
  assert.equal(context.FakeSocket.instances.length, before, "no reconnect attempt may be made");
  assert.equal(context.stored["lb.pairing"].sessionToken, null);
  assert.equal(context.stored["lb.pairing"].sessionId, null);
  assert.equal(context.stored["lb.pairing"].origin, "https://p.test", "the origin is kept so the user can re-pair");
  assert.equal(context.stored["lb.pairing"].label, "Test browser");
  const answer = await context.control("status");
  assert.equal(answer.status.state, "retired", "the popup must report the ended pairing");
  assert.match(answer.status.retiredReason, /token is not usable/);
});

function retiredSeed() {
  return {
    origin: "https://p.test",
    label: "Test browser",
    sessionToken: null,
    sessionId: null,
    code: null,
    tier: null,
    allowedOrigins: [],
    pairedAt: "2026-01-01T00:00:00.000Z",
    retiredAt: "2026-01-02T00:00:00.000Z",
    retiredReason: "session token is not usable",
  };
}

test("a retired pairing does not reconnect after a service-worker restart", async () => {
  const first = await boot();
  assert.notEqual(first.socket, null, "the seeded pairing must connect once");
  first.socket.emit("close", { code: 1008, reason: "session token is not usable" });
  await sleep(200);
  const retiredRecord = { ...first.stored["lb.pairing"] };
  assert.equal(retiredRecord.sessionToken, null);
  assert.equal(typeof retiredRecord.retiredAt, "string");
  const second = await boot({ seed: retiredRecord });
  await sleep(300);
  assert.equal(second.FakeSocket.instances.length, 0, "a fresh worker must not open a socket for a retired pairing");
  const answer = await second.control("status");
  assert.equal(answer.status.state, "retired");
  assert.match(answer.status.retiredReason, /token is not usable/, "the reason must survive the restart");
});

test("reconnect on a retired pairing is refused and keeps the reason", async () => {
  const context = await boot({ seed: retiredSeed() });
  assert.equal(context.FakeSocket.instances.length, 0, "a retired pairing must not connect on boot");
  const answer = await context.control("reconnect");
  await sleep(300);
  assert.equal(answer.ok, false);
  assert.equal(context.FakeSocket.instances.length, 0, "reconnect must not open a socket without a credential");
  assert.equal(answer.status.state, "retired");
  assert.match(String(answer.status.retiredReason || ""), /token is not usable/, "reconnect must not erase why the session ended");
  assert.equal(context.stored["lb.pairing"].sessionToken, null);
});

test("close 1006 still reconnects", async () => {
  const context = await boot();
  const before = context.FakeSocket.instances.length;
  context.socket.emit("close", { code: 1006, reason: "" });
  await sleep(1600);
  assert.ok(context.FakeSocket.instances.length > before, "a network drop must schedule a reconnect");
  assert.equal(context.stored["lb.pairing"].sessionToken, "tok-1", "a network drop must not discard the token");
});
