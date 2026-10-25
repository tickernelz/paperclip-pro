import test from "node:test";
import assert from "node:assert/strict";

import "./protocol.js";
import "./budget.js";

const { budgetFor, innerTimeout, GRACE_MS, MARGIN_MS, LONG_CALL_MS, MIN_BUDGET_MS, INNER_RESERVE_MS } = globalThis.LB.budget;
const { DEFAULTS } = globalThis.LB.protocol;

test("the server budget wins over the static table, minus the contract margin", () => {
  assert.equal(MARGIN_MS, DEFAULTS.budgetMarginMs);
  assert.equal(budgetFor("local_browser_snapshot", {}, 30000), 30000 - MARGIN_MS);
  assert.equal(budgetFor("local_browser_wait", { timeoutMs: 1000 }, 300000), 300000 - MARGIN_MS);
  assert.equal(budgetFor("local_browser_network", {}, 600000), 600000 - MARGIN_MS);
});

test("a server budget above every old clamp is honoured untouched", () => {
  assert.equal(budgetFor("local_browser_evaluate", { timeoutMs: 500000 }, 590000), 589000);
  assert.equal(budgetFor("local_browser_navigate", { timeoutMs: 500000 }, 590000), 589000);
});

test("a tiny server budget never goes below the floor", () => {
  assert.equal(budgetFor("local_browser_snapshot", {}, 500), MIN_BUDGET_MS);
});

test("a nonsense server budget falls back to the static table", () => {
  for (const value of [undefined, null, 0, -5, Number.NaN, "30000"]) {
    assert.equal(budgetFor("local_browser_snapshot", {}, value), DEFAULTS.callTimeoutMs);
  }
});

test("without a server budget the static table no longer clamps long timeouts", () => {
  assert.equal(budgetFor("local_browser_navigate", { timeoutMs: 300000 }), 300000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_wait", { timeoutMs: 250000 }), 250000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_evaluate", { timeoutMs: 90000 }), 90000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_act", {}), DEFAULTS.callTimeoutMs + GRACE_MS);
});

test("without a server budget the long tools get the long budget and the rest the flat call timeout", () => {
  for (const tool of ["local_browser_network", "local_browser_upload", "local_browser_download"]) {
    assert.equal(budgetFor(tool, {}), LONG_CALL_MS);
  }
  assert.equal(budgetFor("local_browser_snapshot", {}), DEFAULTS.callTimeoutMs);
  assert.equal(budgetFor("local_browser_navigate", {}), DEFAULTS.navigateTimeoutMs + GRACE_MS);
  assert.equal(budgetFor("local_browser_wait", {}), DEFAULTS.waitTimeoutMs + GRACE_MS);
});

test("an inner wait honours the requested timeout while it fits the budget", () => {
  assert.equal(innerTimeout(45000, DEFAULTS.waitTimeoutMs, 119000), 45000);
  assert.equal(innerTimeout(undefined, DEFAULTS.waitTimeoutMs, 119000), DEFAULTS.waitTimeoutMs);
});

test("the inner wait can never outlive the call budget", () => {
  assert.equal(innerTimeout(600000, DEFAULTS.waitTimeoutMs, 29000), 29000 - INNER_RESERVE_MS);
  assert.equal(innerTimeout(600000, DEFAULTS.waitTimeoutMs, 50), 100);
});

test("an inner wait without a budget keeps the requested value", () => {
  assert.equal(innerTimeout(500000, DEFAULTS.waitTimeoutMs, undefined), 500000);
  assert.equal(innerTimeout(-1, DEFAULTS.waitTimeoutMs, undefined), DEFAULTS.waitTimeoutMs);
});
