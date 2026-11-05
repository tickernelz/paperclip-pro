import test from "node:test";
import assert from "node:assert/strict";

import { bootBackground, flush, plain } from "./harness.test.mjs";

function boot() {
  const seen = [];
  const harness = bootBackground({
    tabs: [{ id: 7 }, { id: 9, active: false, url: "https://mail.test/", title: "Inbox" }],
    content: (message, tabId) => {
      seen.push({ tabId, op: message.op, args: plain(message.args) });
      if (message.op === "viewport") return { ok: true, result: { width: 800, height: 600, dpr: 1, scrollX: 0, scrollY: 0 } };
      return { ok: true, result: { ok: true, url: "https://mail.test/", nodes: [] } };
    },
  });
  return { ...harness, seen };
}

function pressButton(harness, tabId, frameId = 0) {
  harness.browser.runtime.onMessage.fire({ channel: "lb-indicator", op: "toggle" }, { tab: { id: tabId }, frameId });
}

test("firefox: take over keeps the agent out of the tab until the user hands it back", async () => {
  const harness = boot();
  await flush();
  const pushed = await harness.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });
  assert.equal(pushed.ok, true, JSON.stringify(pushed.error || {}));
  assert.deepEqual(harness.seen.filter((entry) => entry.op === "indicator").map((entry) => [entry.tabId, entry.args]), [
    [9, { state: { agents: ["Ada"], held: false } }],
  ]);

  pressButton(harness, 9, 2);
  pressButton(harness, 9);
  await flush();
  const refused = await harness.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "local_browser_navigation_blocked");
  assert.match(refused.error.message, /took over this tab/);
  for (const [tool, args] of [["local_browser_network", { op: "list", tabId: 9, includeBodies: true }], ["local_browser_storage", { kind: "local", op: "get", tabId: 9 }]]) {
    const blocked = await harness.call(tool, args);
    assert.equal(blocked.error && blocked.error.code, "local_browser_navigation_blocked", tool + " must leave the held tab alone");
  }

  const other = await harness.call("local_browser_snapshot", { tabId: 7 });
  assert.equal(other.ok, true, JSON.stringify(other.error || {}));

  pressButton(harness, 9);
  await flush();
  const allowed = await harness.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error || {}));
});

test("firefox: the user's hold outlives the agent moving to another tab and the bridge resetting", async () => {
  const harness = boot();
  await flush();
  await harness.call("local_browser_indicator", { tabs: [{ tabId: 9, agents: ["Ada"] }] });
  pressButton(harness, 9);
  await flush();
  await harness.call("local_browser_indicator", { tabs: [{ tabId: 7, agents: ["Ada"] }] });
  harness.LB.indicatorTabs.reset();
  await flush();
  const refused = await harness.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(refused.error && refused.error.code, "local_browser_navigation_blocked");
  const last = harness.seen.filter((entry) => entry.op === "indicator" && entry.tabId === 9).at(-1);
  assert.deepEqual(last.args, { state: { agents: [], held: true } });
  pressButton(harness, 9);
  await flush();
  const allowed = await harness.call("local_browser_snapshot", { tabId: 9 });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error || {}));
});

test("firefox: a screenshot hides the indicator while it captures", async () => {
  const harness = boot();
  await flush();
  await harness.call("local_browser_indicator", { tabs: [{ tabId: 7, agents: ["Ada"] }] });
  const shot = await harness.call("local_browser_screenshot", { tabId: 7 });
  assert.equal(shot.ok, true, JSON.stringify(shot.error || {}));
  const ops = harness.seen.filter((entry) => entry.tabId === 7).map((entry) => (entry.op === "indicator" ? JSON.stringify(entry.args) : entry.op));
  const hidden = ops.indexOf('{"suppressed":true}');
  const shown = ops.indexOf('{"suppressed":false}');
  assert.ok(hidden >= 0 && shown > hidden && ops.slice(hidden, shown).includes("viewport"), ops.join(" "));
});
