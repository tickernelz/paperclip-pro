import test from "node:test";
import assert from "node:assert/strict";

import "./protocol.js";
import "./budget.js";

const DEFAULTS = globalThis.LB.protocol.DEFAULTS;
const budget = globalThis.LB.budget;

const CALL_LITERAL = 30000;
const NAVIGATE_LITERAL = 15000;
const WAIT_LITERAL = 10000;
const GRACE_LITERAL = 5000;

test("the protocol defaults are the documented values", () => {
  assert.equal(DEFAULTS.callTimeoutMs, CALL_LITERAL);
  assert.equal(DEFAULTS.navigateTimeoutMs, NAVIGATE_LITERAL);
  assert.equal(DEFAULTS.waitTimeoutMs, WAIT_LITERAL);
});

test("the budget literals are the documented values", () => {
  assert.equal(budget.DEFAULT_CALL_MS, CALL_LITERAL);
  assert.equal(budget.DEFAULT_NAVIGATE_MS, NAVIGATE_LITERAL);
  assert.equal(budget.DEFAULT_WAIT_MS, WAIT_LITERAL);
});

test("the shared defaults and the budget literals agree", () => {
  assert.equal(DEFAULTS.callTimeoutMs, budget.DEFAULT_CALL_MS);
  assert.equal(DEFAULTS.navigateTimeoutMs, budget.DEFAULT_NAVIGATE_MS);
  assert.equal(DEFAULTS.waitTimeoutMs, budget.DEFAULT_WAIT_MS);
});

test("an inner operation wait never outlives the call budget that wraps it", () => {
  assert.ok(
    budget.callBudget("local_browser_navigate", {}) > DEFAULTS.navigateTimeoutMs,
    "navigate budget must exceed the inner load wait",
  );
  assert.ok(
    budget.callBudget("local_browser_wait", {}) > DEFAULTS.waitTimeoutMs,
    "wait budget must exceed the inner poll timeout",
  );
  assert.equal(
    budget.callBudget("local_browser_snapshot", {}),
    CALL_LITERAL,
    "a tool outside the long and tool-call rows gets the plain call default",
  );
});

test("the grace window is what keeps the inner wait inside the budget", () => {
  const navigateBudget = budget.callBudget("local_browser_navigate", {});
  const waitBudget = budget.callBudget("local_browser_wait", {});
  assert.equal(navigateBudget - DEFAULTS.navigateTimeoutMs, GRACE_LITERAL);
  assert.equal(waitBudget - DEFAULTS.waitTimeoutMs, GRACE_LITERAL);
});

test("drift detection: a longer inner wait would be caught by these assertions", () => {
  const drifted = { ...DEFAULTS, navigateTimeoutMs: 26000 };
  const budgetValue = budget.callBudget("local_browser_navigate", {});
  assert.equal(drifted.navigateTimeoutMs === budget.DEFAULT_NAVIGATE_MS, false, "the fixture must actually drift");
  assert.equal(budgetValue > drifted.navigateTimeoutMs, false, "a 26000 inner wait must not fit a 20000 budget");
});

function innerWait(tool, args) {
  const requested = args && args.timeoutMs;
  const fallback = tool === "local_browser_navigate" ? DEFAULTS.navigateTimeoutMs : DEFAULTS.waitTimeoutMs;
  const number = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : fallback;
  return Math.min(Math.max(number, 100), 120000);
}

const SHAPES = [{}, { timeoutMs: 100 }, { timeoutMs: 5000 }, { timeoutMs: 15000 }, { timeoutMs: 60000 }, { timeoutMs: 999999 }];

test("the grace window is the protocol value, not whatever the module happens to export", () => {
  assert.equal(budget.CALL_GRACE_MS, GRACE_LITERAL);
});

test("the inner wait can never outlive the outer budget, across timeout shapes", () => {
  for (const tool of ["local_browser_navigate", "local_browser_wait"]) {
    for (const args of SHAPES) {
      const outer = budget.callBudget(tool, args);
      const inner = innerWait(tool, args);
      const label = tool + " " + JSON.stringify(args);
      assert.ok(outer > inner, label + ": outer " + outer + " must exceed inner " + inner);
      assert.equal(outer - inner, GRACE_LITERAL, label + ": the gap must be exactly the grace window");
    }
  }
});

test("the shape-derived inner wait reduces to the literals at the default shape", () => {
  assert.equal(innerWait("local_browser_navigate", {}), NAVIGATE_LITERAL);
  assert.equal(innerWait("local_browser_wait", {}), WAIT_LITERAL);
  assert.equal(innerWait("local_browser_wait", { timeoutMs: 1 }), 100);
  assert.equal(innerWait("local_browser_wait", { timeoutMs: 999999 }), 120000);
});

test("every defaults field the budget depends on is the documented number", () => {
  const expected = {
    callTimeoutMs: CALL_LITERAL,
    navigateTimeoutMs: NAVIGATE_LITERAL,
    waitTimeoutMs: WAIT_LITERAL,
  };
  for (const key of Object.keys(expected)) {
    assert.equal(DEFAULTS[key], expected[key], key);
  }
});
