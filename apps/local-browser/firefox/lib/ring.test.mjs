import test from "node:test";
import assert from "node:assert/strict";

import "./ring.js";

const { createRingBuffer, DEFAULT_MAX } = globalThis.LB.ring;

function filled(count, max) {
  const ring = createRingBuffer({ max });
  for (let index = 0; index < count; index += 1) ring.push({ index });
  return ring;
}

test("the default ring size matches the guard default", () => {
  assert.equal(DEFAULT_MAX, 1000);
  assert.equal(createRingBuffer().maxOf(), 1000);
});

test("a ring holds as many entries as the user's buffer size, far past the old 200 cap", () => {
  const ring = filled(5000, 20000);
  assert.equal(ring.size(), 5000);
  assert.equal(ring.list({ limit: 5000 }).items.length, 5000);
});

test("drops the oldest entry past the stored maximum", () => {
  const ring = filled(60, 50);
  assert.equal(ring.size(), 50);
  assert.equal(ring.list().items[0].index, 10);
  assert.equal(ring.last().index, 59);
});

test("a listing without a limit returns every match", () => {
  const ring = filled(300, 1000);
  const listing = ring.list();
  assert.equal(listing.items.length, 300);
  assert.equal(listing.total, 300);
});

test("returns the newest window when a limit is smaller than the match count", () => {
  const ring = filled(20, 100);
  const listing = ring.list({ limit: 5 });
  assert.deepEqual(listing.items.map((item) => item.index), [15, 16, 17, 18, 19]);
  assert.equal(listing.total, 20);
});

test("filters before applying the limit", () => {
  const ring = filled(20, 100);
  const listing = ring.list({ limit: 3, filter: (item) => item.index % 2 === 0 });
  assert.deepEqual(listing.items.map((item) => item.index), [14, 16, 18]);
  assert.equal(listing.total, 10);
});

test("shrinking the maximum drops the oldest entries at once", () => {
  const ring = filled(100, 100);
  assert.equal(ring.setMax(60), 60);
  assert.equal(ring.size(), 60);
  assert.equal(ring.list().items[0].index, 40);
});

test("growing the maximum keeps every entry", () => {
  const ring = filled(50, 50);
  ring.setMax(20000);
  for (let index = 50; index < 80; index += 1) ring.push({ index });
  assert.equal(ring.size(), 80);
});

test("a nonsense maximum keeps the previous one, and a tiny one floors at one", () => {
  const ring = filled(10, 10);
  assert.equal(ring.setMax(Number.NaN), 10);
  assert.equal(ring.setMax(0), 1);
  assert.equal(ring.size(), 1);
});

test("clears every entry", () => {
  const ring = filled(10, 10);
  ring.clear();
  assert.equal(ring.size(), 0);
  assert.equal(ring.last(), null);
});
