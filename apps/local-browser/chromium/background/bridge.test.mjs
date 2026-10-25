import test from "node:test";
import assert from "node:assert/strict";
import { boot, flush, frames, manifest, sleep } from "./harness.test.mjs";

test("hello advertises every implemented capability with access and guards", async () => {
  const context = await boot();
  const hello = context.sent.find((frame) => frame.type === "hello");
  assert.ok(hello, "the extension must say hello once the socket opens");
  assert.deepEqual(hello.capabilities, [...context.LB.contract.capabilities]);
  assert.equal(hello.clientVersion, manifest.version);
  assert.equal(hello.access.siteAccess, "all");
  assert.deepEqual(hello.access.missing, []);
  assert.deepEqual(hello.guards, { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 });
  assert.equal(hello.tabs[0].cookieStoreId, "0");
});

test("a permission change sends an access event to the server", async () => {
  const context = await boot();
  context.sent.length = 0;
  await context.api.permissions.remove({ permissions: ["history"] });
  await flush(20);
  const events = frames(context.sent, "access");
  assert.equal(events.length >= 1, true, "an access event must follow the change");
  assert.deepEqual(events[events.length - 1].data.missing, ["history"]);
});

test("guards.set persists the guards and sends a guards event", async () => {
  const context = await boot();
  context.sent.length = 0;
  const answer = await context.control("guards.set", { patch: { networkBufferSize: 5000, protectFocusedTab: false } });
  assert.equal(answer.ok, true);
  assert.equal(answer.status.guards.networkBufferSize, 5000);
  await flush(10);
  const events = frames(context.sent, "guards");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { protectPaperclipTab: true, protectFocusedTab: false, networkBufferSize: 5000 });
  assert.equal(context.stored["lb.guards"].networkBufferSize, 5000);
});

test("pending.clear empties the pending permission list", async () => {
  const context = await boot({ storage: { "lb.pending": [{ permission: "history", reason: "r", at: 1 }] }, granted: { permissions: ["debugger", "storage", "alarms", "activeTab"], origins: [] } });
  const before = await context.control("status");
  assert.equal(before.status.access.pending.length, 1);
  const answer = await context.control("pending.clear", {});
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.status.access.pending, []);
});

test("status describes the connection for the popup and control center", async () => {
  const context = await boot();
  const answer = await context.control("status");
  assert.equal(answer.ok, true);
  const status = answer.status;
  assert.equal(status.client, "chromium");
  assert.equal(status.version, manifest.version);
  assert.equal(status.state, "connected");
  assert.equal(status.origin, "https://p.test");
  assert.equal(status.sessionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(status.tier, "full");
  assert.equal(status.tabs, 1);
  assert.equal(status.trustedInput.mode, "cdp");
  assert.equal(status.access.siteAccess, "all");
  assert.equal(status.guards.networkBufferSize, 1000);
});

test("state changes are broadcast on the lb-status channel", async () => {
  const context = await boot();
  await context.control("guards.set", { patch: { protectPaperclipTab: false } });
  await sleep(120);
  const broadcasts = context.callsOf("runtime.sendMessage").map((entry) => entry[1]).filter((message) => message.channel === "lb-status");
  assert.equal(broadcasts.length >= 1, true);
  assert.equal(broadcasts[broadcasts.length - 1].status.guards.protectPaperclipTab, false);
});

test("detect offers the pairing link found on the active Paperclip page", async () => {
  const context = await boot({ seed: null, executeScript: async () => [{ result: { origin: "https://p.test", code: "ABCD1234" } }] });
  const answer = await context.control("detect");
  assert.equal(answer.ok, true);
  assert.equal(answer.detected.input, "https://p.test/?code=ABCD1234");
  const parsed = context.LB.pairing.parsePairingInput(answer.detected.input);
  assert.equal(parsed.origin, "https://p.test");
  assert.equal(parsed.code, "ABCD1234");
});

test("pair stores the code and opens a socket with it", async () => {
  const context = await boot({ seed: null });
  assert.equal(context.FakeSocket.instances.length, 0);
  const answer = await context.control("pair", { input: "https://p.test/?code=abcd1234" });
  assert.equal(answer.ok, true, answer.error);
  assert.equal(context.stored["lb.pairing"].code, "ABCD1234");
  assert.equal(context.FakeSocket.instances.length, 1);
  assert.match(context.FakeSocket.instances[0].url, /^wss:\/\/p\.test\/api\/local-browser\/bridge\?code=ABCD1234$/);
  assert.equal(answer.status.state, "connecting");
});

test("pair with junk answers a sentence instead of throwing", async () => {
  const context = await boot({ seed: null });
  const answer = await context.control("pair", { input: "ftp://nope" });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /http or https/);
  assert.equal(answer.status.state, "unpaired");
});

test("disconnect forgets the pairing", async () => {
  const context = await boot();
  const answer = await context.control("disconnect");
  assert.equal(answer.ok, true);
  assert.equal(answer.status.state, "unpaired");
  assert.equal("lb.pairing" in context.stored, false);
});

test("an unknown control op is answered, not ignored", async () => {
  const context = await boot();
  const answer = await context.control("explode");
  assert.equal(answer.ok, false);
  assert.match(answer.error, /Unknown control operation/);
});

test("install opens the welcome page, and an update without site access opens it again", async () => {
  const context = await boot();
  context.api.runtime.onInstalled.fire({ reason: "install" });
  await flush(20);
  const welcome = context.callsOf("tabs.create").map((entry) => entry[1].url);
  assert.equal(welcome.some((url) => url.endsWith("ui/control.html#welcome")), true);

  const limited = await boot({ granted: { permissions: ["debugger", "storage", "alarms", "activeTab"], origins: [] } });
  limited.api.runtime.onInstalled.fire({ reason: "update" });
  await flush(20);
  assert.equal(limited.callsOf("tabs.create").some((entry) => entry[1].url.endsWith("#welcome")), true);

  const full = await boot();
  full.api.runtime.onInstalled.fire({ reason: "update" });
  await flush(20);
  assert.equal(full.callsOf("tabs.create").length, 0, "an update with full site access stays quiet");
});

test("a call honours budgetMs instead of the static timeout table", async () => {
  const context = await boot({ onRpc: (payload) => (payload.op === "wait" ? "hang" : undefined) });
  const started = Date.now();
  const result = await context.call("local_browser_wait", { tabId: 7, selector: "#late", timeoutMs: 60000 }, { budgetMs: 4000, waitMs: 6000 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_timeout");
  assert.ok(elapsed < 3600, "the call must end inside budgetMs minus the margin, took " + elapsed);
  const wait = context.rpcs.find((entry) => entry.op === "wait");
  assert.equal(wait.args.timeoutMs, 2000, "the page wait shrinks to fit the server budget");
});

test("a long server budget lets a wait outlive the old 120 s clamp", async () => {
  const context = await boot({ onRpc: (payload) => (payload.op === "wait" ? { ok: true, result: { matched: true } } : undefined) });
  const result = await context.call("local_browser_wait", { tabId: 7, selector: "#x", timeoutMs: 300000 }, { budgetMs: 400000 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const wait = context.rpcs.find((entry) => entry.op === "wait");
  assert.equal(wait.args.timeoutMs, 300000);
  assert.equal(context.LB.budget.callBudget("local_browser_wait", { timeoutMs: 300000 }, 400000), 399000);
});

test("an unknown tool is refused with an update hint", async () => {
  const context = await boot();
  const result = await context.call("local_browser_teleport", {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_unsupported");
});
