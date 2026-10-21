import test from "node:test";
import assert from "node:assert/strict";

import "./ring.js";

const { createRingBuffer, clampLimit, DEFAULT_LIMIT, MAX_LIMIT } = globalThis.LB.ring;

const DEFAULT_LIMIT_LITERAL = 50;
const MAX_LIMIT_LITERAL = 200;

test("the ring bounds are pinned to literals rather than to themselves", () => {
  assert.equal(DEFAULT_LIMIT, DEFAULT_LIMIT_LITERAL);
  assert.equal(MAX_LIMIT, MAX_LIMIT_LITERAL);
});

function record(index) {
  return { id: "r" + index, url: "https://example.test/" + index, method: index % 2 === 0 ? "GET" : "POST", status: 200 };
}

test("defaults to fifty entries per listing and two hundred stored", () => {
  const buffer = createRingBuffer();
  assert.equal(buffer.limitOf(), DEFAULT_LIMIT_LITERAL);
  assert.equal(buffer.maxOf(), MAX_LIMIT_LITERAL);
});

test("keeps insertion order and reports the matching total", () => {
  const buffer = createRingBuffer();
  for (let index = 0; index < 5; index += 1) buffer.push(record(index));
  const result = buffer.list();
  assert.deepEqual(result.items.map((entry) => entry.id), ["r0", "r1", "r2", "r3", "r4"]);
  assert.equal(result.total, 5);
});

test("returns the newest window when the buffer holds more than the limit", () => {
  const buffer = createRingBuffer();
  for (let index = 0; index < 60; index += 1) buffer.push(record(index));
  const result = buffer.list();
  assert.equal(result.items.length, 50);
  assert.equal(result.items[0].id, "r10");
  assert.equal(result.items[49].id, "r59");
  assert.equal(result.total, 60);
});

test("drops the oldest entry past the stored maximum", () => {
  const buffer = createRingBuffer({ max: 5 });
  for (let index = 0; index < 10; index += 1) buffer.push(record(index));
  assert.equal(buffer.size(), 5);
  assert.deepEqual(buffer.list().items.map((entry) => entry.id), ["r5", "r6", "r7", "r8", "r9"]);
});

test("filters before applying the limit", () => {
  const buffer = createRingBuffer();
  for (let index = 0; index < 20; index += 1) buffer.push(record(index));
  const result = buffer.list({ limit: 3, filter: (entry) => entry.method === "POST" });
  assert.deepEqual(result.items.map((entry) => entry.id), ["r15", "r17", "r19"]);
  assert.equal(result.total, 10);
});

test("honours an explicit limit above the default but below the maximum", () => {
  const buffer = createRingBuffer();
  for (let index = 0; index < 80; index += 1) buffer.push(record(index));
  assert.equal(buffer.list({ limit: 75 }).items.length, 75);
  assert.equal(buffer.list({ limit: 500 }).items.length, 80);
});

test("clears every entry", () => {
  const buffer = createRingBuffer();
  buffer.push(record(1));
  buffer.push(record(2));
  buffer.clear();
  assert.equal(buffer.size(), 0);
  assert.deepEqual(buffer.list(), { items: [], total: 0 });
});

test("clamps limits into one through the stored maximum", () => {
  assert.equal(clampLimit(0, 50), 1);
  assert.equal(clampLimit(-4, 50), 1);
  assert.equal(clampLimit(500, 50), MAX_LIMIT_LITERAL);
  assert.equal(clampLimit(undefined, 50), 50);
  assert.equal(clampLimit(undefined, undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit(12.9, 50), 12);
});

test("setLimit changes the default window without touching stored entries", () => {
  const buffer = createRingBuffer();
  for (let index = 0; index < 10; index += 1) buffer.push(record(index));
  assert.equal(buffer.setLimit(3), 3);
  assert.equal(buffer.list().items.length, 3);
  assert.equal(buffer.size(), 10);
});
