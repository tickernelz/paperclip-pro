import test from "node:test";
import assert from "node:assert/strict";
import { createFakeApi, loadShared, flush } from "./test-ext.mjs";

function setup(options = {}) {
  const fake = createFakeApi(options);
  const sandbox = loadShared(["lib/contract.js", "lib/ext-api.js", "lib/guards.js"], { api: fake.api, client: options.client || "chromium" });
  return { fake, LB: sandbox.LB };
}

test("defaults come from the contract", async () => {
  const { LB } = setup();
  assert.deepEqual({ ...(await LB.guards.get()) }, { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 });
  assert.deepEqual({ ...LB.guards.bounds() }, { min: 50, max: 20000 });
});

test("set merges a patch, clamps the buffer to its bounds and persists under lb.guards", async () => {
  const { LB, fake } = setup();
  const next = await LB.guards.set({ protectFocusedTab: false, networkBufferSize: 999999 });
  assert.equal(next.protectFocusedTab, false);
  assert.equal(next.protectPaperclipTab, true);
  assert.equal(next.networkBufferSize, 20000);
  assert.deepEqual(fake.store["lb.guards"], { protectPaperclipTab: true, protectFocusedTab: false, networkBufferSize: 20000 });
  assert.equal((await LB.guards.set({ networkBufferSize: 3 })).networkBufferSize, 50);
});

test("junk values fall back to defaults", () => {
  const { LB } = setup();
  assert.deepEqual({ ...LB.guards.normalize({ protectPaperclipTab: "no", networkBufferSize: "big" }) }, { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 });
});

test("onChange fires for local sets and for writes from another context", async () => {
  const { LB, fake } = setup();
  const seen = [];
  LB.guards.onChange((value) => seen.push(value.networkBufferSize));
  await LB.guards.set({ networkBufferSize: 500 });
  fake.api.storage.onChanged.fire({ "lb.guards": { newValue: { networkBufferSize: 700 } } }, "local");
  fake.api.storage.onChanged.fire({ "lb.guards": { newValue: { networkBufferSize: 700 } } }, "sync");
  await flush();
  assert.deepEqual(seen, [500, 700]);
  assert.equal(LB.guards.current().networkBufferSize, 700);
});

test("a slow boot read does not overwrite a newer value published while it was in flight", async () => {
  const { LB, fake } = setup();
  const boot = LB.guards.get();
  fake.api.storage.onChanged.fire({ "lb.guards": { newValue: { networkBufferSize: 700 } } }, "local");
  const value = await boot;
  assert.equal(value.networkBufferSize, 700);
  assert.equal(LB.guards.current().networkBufferSize, 700);
});

test("a read that started before set() keeps the value set() wrote", async () => {
  const { LB } = setup();
  const boot = LB.guards.get();
  const written = LB.guards.set({ protectFocusedTab: false });
  await Promise.all([boot, written]);
  assert.equal(LB.guards.current().protectFocusedTab, false);
});
