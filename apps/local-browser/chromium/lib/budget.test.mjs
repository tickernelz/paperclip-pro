import test from "node:test";
import assert from "node:assert/strict";

import "./budget.js";

const { callBudget, CALL_GRACE_MS, LONG_CALL_MS, DEFAULT_CALL_MS, MAX_CALL_MS, MAX_TOOL_CALL_MS, DEFAULT_NAVIGATE_MS, DEFAULT_WAIT_MS } = globalThis.LB.budget;

const GRACE = 5000;
const LONG = 60000;
const DEFAULT = 30000;
const MAX_CALL = 120000;
const MAX_TOOL = 60000;
const NAVIGATE = 15000;
const WAIT = 10000;

test("the module exports the values these assertions are written against", () => {
  assert.equal(CALL_GRACE_MS, GRACE);
  assert.equal(LONG_CALL_MS, LONG);
  assert.equal(DEFAULT_CALL_MS, DEFAULT);
  assert.equal(MAX_CALL_MS, MAX_CALL);
  assert.equal(MAX_TOOL_CALL_MS, MAX_TOOL);
  assert.equal(DEFAULT_NAVIGATE_MS, NAVIGATE);
  assert.equal(DEFAULT_WAIT_MS, WAIT);
});

test("upload, download and network get the long 60 s budget", () => {
  for (const tool of ["local_browser_upload", "local_browser_download", "local_browser_network"]) {
    assert.equal(callBudget(tool, {}), LONG, tool);
    assert.equal(callBudget(tool, { timeoutMs: 100 }), LONG, tool);
    assert.equal(callBudget(tool, { timeoutMs: 999999 }), LONG, tool);
  }
});

test("an upload with no timeoutMs is not capped at the 30 s default", () => {
  assert.notEqual(callBudget("local_browser_upload", {}), DEFAULT);
  assert.equal(callBudget("local_browser_upload", {}), 60000);
  assert.equal(callBudget("local_browser_download", {}), 60000);
});

test("navigate uses its own default plus the grace window", () => {
  assert.equal(callBudget("local_browser_navigate", {}), NAVIGATE + GRACE);
  assert.equal(callBudget("local_browser_navigate", { timeoutMs: 40000 }), 40000 + GRACE);
});

test("wait uses its own default plus the grace window", () => {
  assert.equal(callBudget("local_browser_wait", {}), WAIT + GRACE);
  assert.equal(callBudget("local_browser_wait", { timeoutMs: 90000 }), 90000 + GRACE);
});

test("navigate and wait clamp to the 120 s ceiling before the grace window", () => {
  assert.equal(callBudget("local_browser_navigate", { timeoutMs: 999999 }), MAX_CALL + GRACE);
  assert.equal(callBudget("local_browser_wait", { timeoutMs: 999999 }), MAX_CALL + GRACE);
  assert.equal(callBudget("local_browser_wait", { timeoutMs: 1 }), 100 + GRACE);
});

test("act and evaluate clamp to the 60 s tool ceiling plus grace", () => {
  assert.equal(callBudget("local_browser_act", {}), DEFAULT + GRACE);
  assert.equal(callBudget("local_browser_act", { timeoutMs: 55000 }), 55000 + GRACE);
  assert.equal(callBudget("local_browser_act", { timeoutMs: 999999 }), MAX_TOOL + GRACE);
  assert.equal(callBudget("local_browser_evaluate", {}), DEFAULT + GRACE);
  assert.equal(callBudget("local_browser_evaluate", { timeoutMs: 999999 }), MAX_TOOL + GRACE);
});

test("every other tool falls back to the 30 s default", () => {
  for (const tool of [
    "local_browser_sessions",
    "local_browser_open",
    "local_browser_snapshot",
    "local_browser_read",
    "local_browser_screenshot",
    "local_browser_storage",
    "local_browser_close",
    "local_browser_viewer",
    "local_browser_input",
    "local_browser_unknown",
  ]) {
    assert.equal(callBudget(tool, {}), DEFAULT, tool);
  }
});

test("a missing or junk args object does not throw", () => {
  assert.equal(callBudget("local_browser_navigate", undefined), NAVIGATE + GRACE);
  assert.equal(callBudget("local_browser_wait", null), WAIT + GRACE);
  assert.equal(callBudget("local_browser_act", { timeoutMs: "abc" }), DEFAULT + GRACE);
  assert.equal(callBudget("local_browser_act", { timeoutMs: Number.NaN }), DEFAULT + GRACE);
});

test("fractional timeouts floor before clamping", () => {
  assert.equal(callBudget("local_browser_wait", { timeoutMs: 1500.9 }), 1500 + GRACE);
});

test("a server budgetMs replaces the static table minus the margin", () => {
  assert.equal(callBudget("local_browser_snapshot", {}, 45000), 44000);
  assert.equal(callBudget("local_browser_navigate", { timeoutMs: 999999 }, 600000), 599000);
  assert.equal(callBudget("local_browser_upload", {}, 300000), 299000);
  assert.equal(callBudget("local_browser_act", { timeoutMs: 1 }, 2500), 1500);
});

test("a junk or missing budgetMs keeps the legacy table", () => {
  assert.equal(callBudget("local_browser_snapshot", {}, undefined), DEFAULT);
  assert.equal(callBudget("local_browser_snapshot", {}, 0), DEFAULT);
  assert.equal(callBudget("local_browser_snapshot", {}, -5), DEFAULT);
  assert.equal(callBudget("local_browser_snapshot", {}, Number.NaN), DEFAULT);
});

test("a budget smaller than the margin still leaves a positive budget", () => {
  assert.equal(callBudget("local_browser_snapshot", {}, 500), 1);
});

test("inner timeouts fit the server budget and are not clamped to 120 s", () => {
  const { innerTimeout, INNER_SLACK_MS } = globalThis.LB.budget;
  assert.equal(innerTimeout(300000, 15000, 399000), 300000);
  assert.equal(innerTimeout(undefined, 15000, 399000), 15000);
  assert.equal(innerTimeout(60000, 15000, 10000), 10000 - INNER_SLACK_MS);
  assert.equal(innerTimeout(1, 15000, 10000), 100);
  assert.equal(innerTimeout(999999, 15000, undefined, MAX_CALL), MAX_CALL);
});
