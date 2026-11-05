import test from "node:test";
import assert from "node:assert/strict";
import { boot, plain, sleep } from "./harness.test.mjs";

function agentTab(context, id) {
  context.tabsById.set(id, { id, windowId: 1, title: "Inbox", url: "https://mail.test/", active: false, status: "complete", incognito: false });
  context.LB.bg.tabs.agentTabs.add(id);
}

function indicatorRpcs(context, tabId) {
  return context.rpcs.filter((rpc) => rpc.op === "indicator" && rpc.tabId === tabId).map((rpc) => plain(rpc.args));
}

function pressButton(context, tabId, frameId = 0) {
  for (const listener of context.api.runtime.onMessage.listeners) {
    listener({ type: "lb:indicator-toggle" }, { tab: { id: tabId }, frameId }, () => undefined);
  }
}

test("the indicator marks only the tabs the server names, with the agent's name", async () => {
  const context = await boot();
  agentTab(context, 9);
  const result = await context.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.deepEqual(indicatorRpcs(context, 9), [{ state: { agents: ["Ada"], held: false } }]);
  assert.deepEqual(indicatorRpcs(context, 7), []);

  await context.call("local_browser_indicator", { tabs: [] });
  assert.deepEqual(indicatorRpcs(context, 9).at(-1), { state: null });
});

test("take over keeps the agent out of the tab until the user hands it back", async () => {
  const context = await boot();
  agentTab(context, 9);
  await context.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });

  pressButton(context, 9, 1);
  assert.equal(context.LB.bg.indicator.isHeld(9), false, "a button press from a subframe is ignored");
  pressButton(context, 9);
  await sleep(10);
  assert.deepEqual(indicatorRpcs(context, 9).at(-1), { state: { agents: ["Ada"], held: true } });

  const refused = await context.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "local_browser_navigation_blocked");
  assert.match(refused.error.message, /took over this tab/);
  assert.match(refused.error.hint, /local_browser_open/);
  for (const [tool, args] of [["local_browser_network", { op: "list", tabId: 9, includeBodies: true }], ["local_browser_storage", { kind: "local", op: "get", tabId: 9 }]]) {
    const blocked = await context.call(tool, args);
    assert.equal(blocked.error && blocked.error.code, "local_browser_navigation_blocked", tool + " must leave the held tab alone");
  }

  const opened = await context.call("local_browser_open", { url: "https://elsewhere.test/" });
  assert.equal(opened.ok, true, JSON.stringify(opened.error || {}));
  assert.equal(context.created.length, 1, "open must use a fresh tab instead of the held one");
  assert.equal(context.tabsById.get(9).url, "https://mail.test/", "the held tab keeps its page");

  pressButton(context, 9);
  await sleep(10);
  const allowed = await context.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error || {}));
});

test("the user's hold outlives the agent moving on, idling out and the bridge dropping", async () => {
  const context = await boot();
  agentTab(context, 9);
  await context.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });
  pressButton(context, 9);
  await sleep(10);

  const first = await context.call("local_browser_open", { url: "https://second.test/" });
  assert.equal(first.ok, true, JSON.stringify(first.error || {}));
  const fresh = first.result.tab.tabId;
  assert.notEqual(fresh, 9);
  await context.call("local_browser_indicator", { tabs: [{ tabId: fresh, agents: ["Ada"] }] });
  assert.equal(context.LB.bg.indicator.isHeld(9), true, "the agent moving to another tab must not end the user's hold");
  assert.deepEqual(indicatorRpcs(context, 9).at(-1), { state: { agents: [], held: true } });

  const second = await context.call("local_browser_open", { url: "https://third.test/" });
  assert.equal(second.ok, true, JSON.stringify(second.error || {}));
  assert.equal(context.tabsById.get(9).url, "https://mail.test/", "a later open must not navigate the held tab");

  await context.call("local_browser_indicator", { tabs: [] });
  context.socket.emit("close", { code: 1006 });
  await sleep(10);
  assert.equal(context.LB.bg.indicator.isHeld(9), true, "idling out and reconnecting keep the hold");
  await assert.rejects(context.LB.bg.tabs.resolveAgentTab({ tabId: 9 }), (error) => error.code === "local_browser_navigation_blocked");

  pressButton(context, 9);
  await sleep(10);
  assert.equal(context.LB.bg.indicator.isHeld(9), false);
  assert.deepEqual(indicatorRpcs(context, 9).at(-1), { state: null }, "Hand back on a tab no agent uses removes the bar");
});

test("the user's hold survives the service worker restarting", async () => {
  const sessionStore = {};
  const first = await boot({ sessionStore });
  agentTab(first, 9);
  await first.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });
  pressButton(first, 9);
  await sleep(10);

  const restarted = await boot({ sessionStore });
  agentTab(restarted, 9);
  const refused = await restarted.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(refused.error && refused.error.code, "local_browser_navigation_blocked");
  assert.deepEqual(indicatorRpcs(restarted, 9).at(-1), { state: { agents: [], held: true } });

  pressButton(restarted, 9);
  await sleep(10);
  const allowed = await restarted.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error || {}));
  const third = await boot({ sessionStore });
  agentTab(third, 9);
  const stillFree = await third.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(stillFree.ok, true, "Hand back is remembered across a restart too");
});

test("a screenshot hides the indicator while it captures and shows it again", async () => {
  const context = await boot();
  await context.call("local_browser_indicator", { tabs: [{ tabId: 7, agents: ["Ada"] }] });
  const result = await context.call("local_browser_screenshot", { tabId: 7 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  const ops = context.rpcs.filter((rpc) => rpc.tabId === 7).map((rpc) => (rpc.op === "indicator" ? JSON.stringify(rpc.args) : rpc.op));
  const hidden = ops.indexOf('{"suppressed":true}');
  const shown = ops.indexOf('{"suppressed":false}');
  assert.ok(hidden >= 0 && shown > hidden, ops.join(" "));
});

test("the indicator is drawn again after the tab loads and cleared when the bridge drops", async () => {
  const context = await boot();
  agentTab(context, 9);
  await context.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });
  const before = indicatorRpcs(context, 9).length;
  for (const listener of context.api.tabs.onUpdated.listeners) listener(9, { status: "complete" }, context.tabsById.get(9));
  await sleep(10);
  assert.equal(indicatorRpcs(context, 9).length, before + 1);
  assert.deepEqual(indicatorRpcs(context, 9).at(-1), { state: { agents: ["Ada"], held: false } });

  context.socket.emit("close", { code: 1006 });
  await sleep(10);
  assert.deepEqual(indicatorRpcs(context, 9).at(-1), { state: null });
});
