import test from "node:test";
import assert from "node:assert/strict";
import { createFakeApi, loadShared, flush } from "./test-ext.mjs";

const FILES = ["lib/contract.js", "lib/ext-api.js", "lib/access.js"];

function setup(options = {}) {
  const fake = createFakeApi(options);
  const sandbox = loadShared(FILES, { api: fake.api, client: options.client || "chromium" });
  return { fake, LB: sandbox.LB };
}

test("the catalog for each client drops entries the browser cannot support", () => {
  const chromium = setup().LB.access.catalog().map((entry) => entry.id);
  const firefox = setup({ client: "firefox" }).LB.access.catalog().map((entry) => entry.id);
  assert.ok(chromium.includes("debugger"));
  assert.ok(!chromium.includes("proxy"));
  assert.ok(firefox.includes("proxy"));
  assert.ok(!firefox.includes("debugger"));
  assert.ok(chromium.includes("<all_urls>") && firefox.includes("<all_urls>"));
});

test("requestable ids are the optional catalog ids the manifest declares", () => {
  const { LB } = setup();
  assert.deepEqual([...LB.access.requestableIds()].sort(), ["<all_urls>", "cookies", "downloads", "history", "notifications", "scripting", "tabs"].sort());
});

test("a snapshot reports granted, missing, site access and pending", async () => {
  const { LB } = setup({ granted: { permissions: ["debugger", "storage", "alarms", "activeTab", "tabs"], origins: [] } });
  const snapshot = await LB.access.snapshot();
  assert.equal(snapshot.siteAccess, "limited");
  assert.ok(snapshot.granted.includes("tabs"));
  assert.ok(snapshot.missing.includes("<all_urls>"));
  assert.ok(snapshot.missing.includes("cookies"));
  assert.ok(!snapshot.missing.includes("tabs"));
  assert.deepEqual([...snapshot.pending], []);
});

test("site access reads all once <all_urls> is granted", async () => {
  const { LB } = setup({ granted: { permissions: ["storage"], origins: ["<all_urls>"] } });
  const snapshot = await LB.access.snapshot();
  assert.equal(snapshot.siteAccess, "all");
  assert.ok(snapshot.granted.includes("<all_urls>"));
});

test("ensure passes when everything is granted", async () => {
  const { LB } = setup({ granted: { permissions: ["cookies"], origins: [] } });
  const result = await LB.access.ensure(["cookies"], { tool: "local_browser_storage" });
  assert.deepEqual([...result.granted], ["cookies"]);
});

test("ensure queues the missing ids, paints the badge and throws permission_required", async () => {
  const { LB, fake } = setup();
  await assert.rejects(LB.access.ensure(["cookies", "storage"], { tool: "local_browser_storage", reason: "read cookies" }), (error) => {
    assert.equal(error.code, "local_browser_permission_required");
    assert.deepEqual([...error.permissions], ["cookies"]);
    assert.equal(error.retryable, true);
    assert.match(error.hint, /Allow/);
    return true;
  });
  const pending = fake.store["lb.pending"];
  assert.equal(pending.length, 1);
  assert.equal(pending[0].permission, "cookies");
  assert.equal(pending[0].tool, "local_browser_storage");
  assert.equal(pending[0].reason, "read cookies");
  assert.equal(typeof pending[0].at, "number");
  assert.deepEqual(fake.callsOf("badge.text").at(-1), ["badge.text", "1"]);
});

test("ensure refuses ids the client cannot support and unknown ids", async () => {
  const { LB } = setup();
  await assert.rejects(LB.access.ensure(["proxy"]), (error) => error.code === "local_browser_unsupported");
  await assert.rejects(LB.access.ensure(["teleport"]), (error) => error.code === "local_browser_protocol_error");
});

test("queue dedupes, trims reasons to 300 chars, keeps at most 50 and reports already granted ids", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["tabs"], origins: [] } });
  const first = await LB.access.queue(["cookies", "tabs", "nope", "proxy"], { reason: "x".repeat(400), tool: "t" });
  assert.deepEqual([...first.queued], ["cookies"]);
  assert.deepEqual([...first.alreadyGranted], ["tabs"]);
  assert.deepEqual([...first.unknown], ["nope"]);
  assert.deepEqual([...first.unsupported], ["proxy"]);
  assert.equal(fake.store["lb.pending"][0].reason.length, 300);
  await LB.access.queue(["cookies"], { reason: "again" });
  assert.equal(fake.store["lb.pending"].length, 1);
  assert.equal(fake.store["lb.pending"][0].reason, "again");
  fake.store["lb.pending"] = Array.from({ length: 60 }, (_, index) => ({ permission: "p" + index, reason: "", at: index }));
  await LB.access.queue(["history"], {});
  assert.equal(fake.store["lb.pending"].length, 50);
  assert.equal(fake.store["lb.pending"].at(-1).permission, "history");
});

test("a notification is shown for new requests only when notifications is granted", async () => {
  const quiet = setup();
  await quiet.LB.access.queue(["cookies"], { reason: "r" });
  await flush();
  assert.equal(quiet.fake.callsOf("notifications.create").length, 0);

  const loud = setup({ client: "firefox", granted: { permissions: ["storage", "notifications"], origins: [] } });
  await loud.LB.access.queue(["cookies"], { reason: "r" });
  await flush();
  const created = loud.fake.callsOf("notifications.create");
  assert.equal(created.length, 1);
  assert.equal(created[0][1], "lb-permission-request");
  assert.match(created[0][2].message, /Cookies|cookies/);
  assert.equal(created[0][2].iconUrl, "moz-extension://ext-id/icons/icon.svg");
  loud.fake.api.notifications.onClicked.fire("lb-permission-request");
  await flush();
  assert.equal(loud.fake.callsOf("tabs.create")[0][1].url, "moz-extension://ext-id/ui/control.html#permissions");
});

test("request calls permissions.request synchronously, before any await", () => {
  const { LB, fake } = setup({ client: "firefox" });
  const pending = LB.access.request(["<all_urls>", "cookies", "debugger"]);
  const calls = fake.callsOf("permissions.request");
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0][1].origins], ["<all_urls>"]);
  assert.deepEqual([...calls[0][1].permissions], ["cookies"]);
  return pending.then((result) => {
    assert.equal(result.granted, true);
    assert.deepEqual([...result.skipped], ["debugger"]);
  });
});

test("requestAll asks for every requestable permission in one call", async () => {
  const { LB, fake } = setup();
  const result = await LB.access.requestAll();
  const calls = fake.callsOf("permissions.request");
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0][1].origins], ["<all_urls>"]);
  assert.equal(calls[0][1].permissions.length, LB.access.requestableIds().length - 1);
  assert.equal(result.granted, true);
  assert.equal((await LB.access.snapshot()).siteAccess, "all");
});

test("a granted request clears the matching pending entries", async () => {
  const { LB, fake } = setup();
  await LB.access.queue(["cookies", "history"], { reason: "r" });
  await LB.access.request(["cookies"]);
  await flush();
  assert.deepEqual(fake.store["lb.pending"].map((entry) => entry.permission), ["history"]);
});

test("a dismissed browser prompt keeps the pending entries", async () => {
  const { LB, fake } = setup();
  fake.setAnswer(false);
  await LB.access.queue(["cookies"], { reason: "r" });
  const result = await LB.access.request(["cookies"]);
  assert.equal(result.granted, false);
  assert.equal(fake.store["lb.pending"].length, 1);
});

test("a grant made elsewhere clears pending through permissions.onAdded", async () => {
  const { LB, fake } = setup();
  await LB.access.queue(["cookies"], { reason: "r" });
  fake.granted.permissions.add("cookies");
  fake.api.permissions.onAdded.fire({ permissions: ["cookies"] });
  await flush(10);
  assert.equal(fake.store["lb.pending"].length, 0);
  assert.deepEqual(fake.callsOf("badge.text").at(-1), ["badge.text", ""]);
});

test("revoke removes optional permissions and refuses required ones", async () => {
  const { LB, fake } = setup({ granted: { permissions: ["storage", "cookies"], origins: ["<all_urls>"] } });
  assert.equal(await LB.access.revoke("<all_urls>"), true);
  assert.deepEqual([...fake.callsOf("permissions.remove")[0][1].origins], ["<all_urls>"]);
  await assert.rejects(LB.access.revoke("storage"), (error) => error.code === "local_browser_unsupported");
});

test("clearPending removes named entries or everything", async () => {
  const { LB, fake } = setup();
  await LB.access.queue(["cookies", "history", "tabs"], { reason: "r" });
  await LB.access.clearPending(["history"]);
  assert.deepEqual(fake.store["lb.pending"].map((entry) => entry.permission), ["cookies", "tabs"]);
  await LB.access.clearPending();
  assert.equal(fake.store["lb.pending"].length, 0);
});

test("onChange listeners receive a fresh snapshot after changes and can unsubscribe", async () => {
  const { LB } = setup();
  const seen = [];
  const stop = LB.access.onChange((snapshot) => seen.push(snapshot));
  await LB.access.queue(["cookies"], { reason: "r" });
  await flush(10);
  assert.ok(seen.length >= 1);
  assert.equal(seen.at(-1).pending[0].permission, "cookies");
  stop();
  const count = seen.length;
  await LB.access.clearPending();
  await flush(10);
  assert.equal(seen.length, count);
});

test("an idle badge painter takes over when nothing is pending", async () => {
  const { LB, fake } = setup();
  let painted = 0;
  LB.access.setIdleBadge(() => {
    painted += 1;
  });
  await LB.access.queue(["cookies"], { reason: "r" });
  await LB.access.clearPending();
  assert.equal(painted, 1);
  assert.deepEqual(fake.callsOf("badge.text").at(-1), ["badge.text", "1"]);
});
