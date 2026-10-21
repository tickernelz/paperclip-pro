import test from "node:test";
import assert from "node:assert/strict";

import "./protocol.js";
import "./budget.js";

const { budgetFor, GRACE_MS, DEFAULT_CALL_MS, LONG_CALL_MS } = globalThis.LB.budget;

const GRACE_LITERAL = 5000;
const DEFAULT_LITERAL = 30000;
const LONG_LITERAL = 60000;

test("every exported budget constant is pinned to a literal, not to itself", () => {
  assert.equal(GRACE_MS, GRACE_LITERAL);
  assert.equal(DEFAULT_CALL_MS, DEFAULT_LITERAL);
  assert.equal(LONG_CALL_MS, LONG_LITERAL);
});

test("gives navigate the requested timeout plus a grace period", () => {
  assert.equal(budgetFor("local_browser_navigate", {}), 15000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_navigate", { timeoutMs: 90000 }), 90000 + GRACE_MS);
});

test("gives wait the requested timeout plus a grace period", () => {
  assert.equal(budgetFor("local_browser_wait", {}), 10000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_wait", { timeoutMs: 120000 }), 120000 + GRACE_MS);
});

test("lets a long wait exceed the flat call timeout", () => {
  const budget = budgetFor("local_browser_wait", { timeoutMs: 60000 });
  assert.ok(budget > DEFAULT_LITERAL);
  assert.equal(budget, 65000);
});

test("a long navigate is not cut short by the flat call timeout", () => {
  assert.equal(budgetFor("local_browser_navigate", { timeoutMs: 120000 }), 125000);
});

test("caps act and evaluate at sixty seconds plus grace", () => {
  assert.equal(budgetFor("local_browser_act", {}), DEFAULT_LITERAL + GRACE_LITERAL);
  assert.equal(budgetFor("local_browser_act", { timeoutMs: 999999 }), 60000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_evaluate", { timeoutMs: 10 }), 100 + GRACE_MS);
});

test("gives network, upload and download the long budget", () => {
  assert.equal(budgetFor("local_browser_network", {}), LONG_LITERAL);
  assert.equal(budgetFor("local_browser_upload", {}), LONG_LITERAL);
  assert.equal(budgetFor("local_browser_download", {}), LONG_LITERAL);
});

test("falls back to the flat call timeout for the rest", () => {
  assert.equal(budgetFor("local_browser_snapshot", {}), DEFAULT_LITERAL);
  assert.equal(budgetFor("local_browser_sessions", {}), DEFAULT_CALL_MS);
  assert.equal(budgetFor("local_browser_read", { timeoutMs: 120000 }), DEFAULT_CALL_MS);
});

test("derives its defaults from the protocol table instead of duplicating them", () => {
  const { DEFAULTS } = globalThis.LB.protocol;
  assert.equal(budgetFor("local_browser_navigate", {}), DEFAULTS.navigateTimeoutMs + GRACE_MS);
  assert.equal(budgetFor("local_browser_wait", {}), DEFAULTS.waitTimeoutMs + GRACE_MS);
  assert.equal(budgetFor("local_browser_snapshot", {}), DEFAULTS.callTimeoutMs);
});

test("the inner wait can never outlive the outer budget", () => {
  const { DEFAULTS } = globalThis.LB.protocol;
  const shapes = [{}, { timeoutMs: 100 }, { timeoutMs: 5000 }, { timeoutMs: 60000 }, { timeoutMs: 120000 }, { timeoutMs: 999999 }];
  for (const tool of ["local_browser_navigate", "local_browser_wait"]) {
    const fallback = tool === "local_browser_navigate" ? DEFAULTS.navigateTimeoutMs : DEFAULTS.waitTimeoutMs;
    for (const args of shapes) {
      const inner = Math.min(Math.max(Math.floor(args.timeoutMs ?? fallback), 100), 120000);
      const outer = budgetFor(tool, args);
      assert.ok(outer > inner, tool + " " + JSON.stringify(args) + " outer " + outer + " must exceed inner " + inner);
      assert.equal(outer - inner, GRACE_LITERAL, tool + " " + JSON.stringify(args) + " gap must be exactly the grace");
    }
  }
});

test("ignores a nonsense timeout", () => {
  assert.equal(budgetFor("local_browser_wait", { timeoutMs: "soon" }), 10000 + GRACE_MS);
  assert.equal(budgetFor("local_browser_wait", { timeoutMs: Number.NaN }), 10000 + GRACE_MS);
});
