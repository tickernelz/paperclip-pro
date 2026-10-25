import test from "node:test";
import assert from "node:assert/strict";
import { createFakeApi, loadShared, flush } from "./test-ext.mjs";

function setup(options = {}) {
  const fake = createFakeApi(options);
  const sandbox = loadShared(["lib/contract.js", "lib/ext-api.js"], { api: fake.api, client: options.client || "chromium" });
  return { fake, LB: sandbox.LB };
}

test("api is browser on Firefox and chrome on Chromium", () => {
  const chromium = setup();
  const firefox = setup({ client: "firefox" });
  assert.equal(chromium.LB.ext.api, chromium.fake.api);
  assert.equal(firefox.LB.ext.api, firefox.fake.api);
});

test("client comes from the manifest, then the extension URL scheme", () => {
  assert.equal(setup().LB.ext.client, "chromium");
  assert.equal(setup({ client: "firefox" }).LB.ext.client, "firefox");
  const plain = createFakeApi({ client: "firefox", manifest: { version: "1", permissions: [] } });
  assert.equal(loadShared(["lib/ext-api.js"], { api: plain.api, client: "firefox" }).LB.ext.client, "firefox");
});

test("action resolves to action on MV3 and browserAction on MV2", () => {
  const chromium = setup();
  const firefox = setup({ client: "firefox" });
  assert.equal(chromium.LB.ext.action(), chromium.fake.api.action);
  assert.equal(firefox.LB.ext.action(), firefox.fake.api.browserAction);
});

test("declared maps manifest permissions and host patterns to catalog ids", () => {
  const { LB } = setup();
  const declared = LB.ext.declared();
  assert.ok(declared.required.includes("debugger"));
  assert.ok(declared.optional.includes("<all_urls>"));
  assert.ok(declared.optional.includes("cookies"));
  assert.ok(!declared.optional.includes("debugger"));
});

test("version reads the manifest", () => {
  assert.equal(setup().LB.ext.version(), "1.1.0");
});

test("openControlCenter creates a tab at the section, or focuses an existing one", async () => {
  const fresh = setup();
  await fresh.LB.ext.openControlCenter("permissions");
  assert.equal(fresh.fake.callsOf("tabs.create")[0][1].url, "chrome-extension://ext-id/ui/control.html#permissions");

  const open = setup({ tabs: [{ id: 4, windowId: 2, url: "chrome-extension://ext-id/ui/control.html#overview" }] });
  await open.LB.ext.openControlCenter("permissions");
  await flush();
  assert.equal(open.fake.callsOf("tabs.create").length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(open.fake.callsOf("tabs.update")[0].slice(1))), [4, { url: "chrome-extension://ext-id/ui/control.html#permissions", active: true }]);
  assert.equal(open.fake.callsOf("windows.update")[0][1], 2);
});

test("sendControl tags the lb-control channel", async () => {
  const { LB, fake } = setup();
  await LB.ext.sendControl("guards.set", { patch: { protectFocusedTab: false } });
  const sent = fake.callsOf("runtime.sendMessage")[0][1];
  assert.equal(sent.channel, "lb-control");
  assert.equal(sent.op, "guards.set");
  assert.equal(sent.patch.protectFocusedTab, false);
});
