import test from "node:test";
import assert from "node:assert/strict";

import "./backoff.js";

const { computeDelay, MIN_DELAY_MS } = globalThis.LB.backoff;

const MIN_DELAY_LITERAL = 250;

test("the floor is 250ms, pinned to a literal rather than to itself", () => {
  assert.equal(MIN_DELAY_MS, MIN_DELAY_LITERAL);
});

test("starts at the base delay", () => {
  assert.equal(computeDelay(0, { baseMs: 1000, random: () => 0.5 }), 1000);
});

test("doubles with each attempt", () => {
  const sequence = [0, 1, 2, 3].map((attempt) => computeDelay(attempt, { baseMs: 1000, random: () => 0.5 }));
  assert.deepEqual(sequence, [1000, 2000, 4000, 8000]);
});

test("stops at the maximum delay", () => {
  assert.equal(computeDelay(20, { baseMs: 1000, maxMs: 30000, random: () => 0.5 }), 30000);
});

test("spreads the delay across the jitter window", () => {
  const low = computeDelay(0, { baseMs: 1000, jitter: 0.25, random: () => 0 });
  const high = computeDelay(0, { baseMs: 1000, jitter: 0.25, random: () => 1 });
  assert.equal(low, 750);
  assert.equal(high, 1250);
});

test("never returns less than the floor", () => {
  const delay = computeDelay(0, { baseMs: 100, jitter: 1, random: () => 0 });
  assert.equal(delay, MIN_DELAY_LITERAL);
});

test("ignores a negative or fractional attempt", () => {
  assert.equal(computeDelay(-3, { baseMs: 1000, random: () => 0.5 }), 1000);
  assert.equal(computeDelay(1.9, { baseMs: 1000, random: () => 0.5 }), 2000);
});

test("treats a broken random source as the midpoint", () => {
  assert.equal(computeDelay(0, { baseMs: 1000, random: () => Number.NaN }), 1000);
});
