import test from "node:test";
import assert from "node:assert/strict";

import "./text.js";

const { collapse, truncate, normalizeName, clampInt, NODE_NAME_MAX } = globalThis.LB.text;

test("collapse folds every whitespace run into one space", () => {
  assert.equal(collapse("  a \n\t b  "), "a b");
  assert.equal(collapse(undefined), "");
  assert.equal(collapse(42), "");
});

test("truncate keeps short values untouched", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("exactly10!", 10), "exactly10!");
});

test("truncate cuts to the limit and ends with an ellipsis", () => {
  const result = truncate("abcdefghijklmnop", 8);
  assert.equal(result.length, 8);
  assert.equal(result, "abcdefg\u2026");
});

test("truncate does not leave a trailing space before the ellipsis", () => {
  assert.equal(truncate("abcde fghij", 7), "abcde\u2026");
});

test("truncate stringifies non-strings", () => {
  assert.equal(truncate(12345, 10), "12345");
  assert.equal(truncate(null, 10), "");
});

test("normalizeName collapses then caps at 160 characters", () => {
  assert.equal(NODE_NAME_MAX, 160);
  assert.equal(normalizeName("  Pay   now "), "Pay now");
  assert.equal(normalizeName("y".repeat(500)).length, 160);
});

test("clampInt keeps integers inside the range", () => {
  assert.equal(clampInt(50, 120, 10, 400), 50);
  assert.equal(clampInt(5, 120, 10, 400), 10);
  assert.equal(clampInt(900, 120, 10, 400), 400);
  assert.equal(clampInt(undefined, 120, 10, 400), 120);
  assert.equal(clampInt(Number.NaN, 120, 10, 400), 120);
  assert.equal(clampInt(12.9, 120, 10, 400), 12);
});
