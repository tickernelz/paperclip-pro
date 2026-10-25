import test from "node:test";
import assert from "node:assert/strict";

import "./refmap.js";

const { createRefMap, formatRef, parseRef } = globalThis.LB.refmap;

test("assigns sequential refs in assignment order", () => {
  const refs = createRefMap();
  const first = { isConnected: true };
  const second = { isConnected: true };
  assert.equal(refs.assign(first), "e1");
  assert.equal(refs.assign(second), "e2");
  assert.equal(refs.size(), 2);
  assert.equal(refs.last(), 2);
});

test("returns the same ref for the same element", () => {
  const refs = createRefMap();
  const element = { isConnected: true };
  assert.equal(refs.assign(element), "e1");
  assert.equal(refs.assign(element), "e1");
  assert.equal(refs.size(), 1);
});

test("formats and parses refs", () => {
  assert.equal(formatRef(7), "e7");
  assert.equal(parseRef("e7"), 7);
  assert.equal(parseRef("  e12 "), 12);
  assert.equal(parseRef("e0"), null);
  assert.equal(parseRef("7"), null);
  assert.equal(parseRef(""), null);
  assert.equal(parseRef(undefined), null);
});

test("reports a missing ref after reset", () => {
  const refs = createRefMap();
  const element = { isConnected: true };
  const ref = refs.assign(element);
  refs.reset();
  const resolved = refs.resolve(ref);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, "missing");
  assert.equal(refs.assign({ isConnected: true }), "e1");
});

test("reports a stale ref when the element left the document", () => {
  const refs = createRefMap();
  const element = { isConnected: true };
  const ref = refs.assign(element);
  element.isConnected = false;
  const resolved = refs.resolve(ref);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, "stale");
  assert.equal(refs.size(), 0);
});

test("resolves a live element", () => {
  const refs = createRefMap();
  const element = { isConnected: true };
  const ref = refs.assign(element);
  const resolved = refs.resolve(ref);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.element, element);
});

test("prunes detached elements and keeps live ones", () => {
  const refs = createRefMap();
  const live = { isConnected: true };
  const gone = { isConnected: true };
  refs.assign(live);
  refs.assign(gone);
  gone.isConnected = false;
  assert.equal(refs.prune(), 1);
  assert.equal(refs.size(), 1);
  assert.equal(refs.resolve("e1").ok, true);
  assert.equal(refs.resolve("e2").ok, false);
});

test("accepts a custom detachment predicate", () => {
  const refs = createRefMap({ isDetached: (element) => element.removed === true });
  const element = { removed: false };
  const ref = refs.assign(element);
  assert.equal(refs.resolve(ref).ok, true);
  element.removed = true;
  assert.equal(refs.resolve(ref).reason, "stale");
});
