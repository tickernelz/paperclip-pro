import test from "node:test";
import assert from "node:assert/strict";

import "./cursor.js";

const { parseCursor, nextCursor, isStale } = globalThis.LB.cursor;

function envelope(offset) {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

test("a missing cursor is a fresh start", () => {
  for (const value of [undefined, null, "", "   "]) {
    const parsed = parseCursor(value);
    assert.equal(parsed.provided, false);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.offset, 0);
  }
});

test("a plain decimal cursor is honoured exactly", () => {
  assert.deepEqual(parseCursor("120"), { provided: true, valid: true, offset: 120, shape: "decimal" });
  assert.equal(parseCursor(" 7 ").offset, 7);
  assert.equal(parseCursor("0").offset, 0);
  assert.equal(parseCursor(240).offset, 240);
});

test("the server's base64url envelope decodes to the same offset", () => {
  const parsed = parseCursor(envelope(120));
  assert.equal(parsed.provided, true);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.offset, 120);
  assert.equal(parsed.shape, "base64");
});

test("garbage cursors are reported invalid instead of silently becoming zero", () => {
  for (const value of ["not-a-cursor", "e12", "-3", "1.5", envelope("nope"), envelope(-1), "{}", "  x  "]) {
    const parsed = parseCursor(value);
    assert.equal(parsed.provided, true, "provided: " + value);
    assert.equal(parsed.valid, false, "invalid: " + value);
    assert.equal(parsed.offset, 0);
  }
});

test("absurd offsets are rejected", () => {
  assert.equal(parseCursor("999999999999").valid, false);
  assert.equal(parseCursor(envelope(999999999999)).valid, false);
});

test("nextCursor advances by the emitted count", () => {
  assert.equal(nextCursor(0, 10, 30), "10");
  assert.equal(nextCursor(10, 10, 30), "20");
});

test("nextCursor stops at the end of the walk", () => {
  assert.equal(nextCursor(20, 10, 30), null);
  assert.equal(nextCursor(0, 5, 5), null);
  assert.equal(nextCursor(0, 0, 5), null);
});

test("isStale flags an offset at or past the walk length", () => {
  assert.equal(isStale(30, 30), true);
  assert.equal(isStale(31, 30), true);
  assert.equal(isStale(29, 30), false);
  assert.equal(isStale(0, 30), false);
});
