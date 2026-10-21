import test from "node:test";
import assert from "node:assert/strict";

import "./hit.js";

const { hitTestAllows, hitTestVerdict, pointInViewport, contains, describeBlock } = globalThis.LB.hit;

const VIEWPORT = { width: 800, height: 600 };

function node(tagName, children = []) {
  const element = { tagName, parentNode: null, children };
  for (const child of children) child.parentNode = element;
  return element;
}

test("the target itself is clickable", () => {
  const button = node("BUTTON");
  assert.equal(hitTestAllows(button, button), true);
});

test("a descendant of the target is clickable", () => {
  const span = node("SPAN");
  const button = node("BUTTON", [span]);
  assert.equal(hitTestAllows(button, span), true);
});

test("an overlay covering the target is refused", () => {
  const button = node("BUTTON");
  const overlay = node("DIV");
  const root = node("BODY", [button, overlay]);
  assert.equal(hitTestAllows(button, overlay), false);
  assert.equal(hitTestAllows(button, root), false);
});

test("nothing at the point is refused", () => {
  assert.equal(hitTestAllows(node("BUTTON"), null), false);
  assert.equal(hitTestAllows(null, node("DIV")), false);
});

test("contains walks parentNode when contains() is missing", () => {
  const span = node("SPAN");
  const button = node("BUTTON", [span]);
  const body = node("BODY", [button]);
  assert.equal(contains(button, span), true);
  assert.equal(contains(button, body), false);
  assert.equal(contains(button, button), false);
});

test("contains prefers a native contains()", () => {
  const child = { tagName: "I" };
  const parent = { tagName: "B", contains: (other) => other === child };
  assert.equal(contains(parent, child), true);
});

test("a null hit inside the viewport means something is covering the point", () => {
  const button = node("BUTTON");
  assert.equal(hitTestVerdict(button, null, { x: 100, y: 100 }, VIEWPORT), "covered");
});

test("a null hit outside the viewport means scroll and retry, not covered", () => {
  const button = node("BUTTON");
  assert.equal(hitTestVerdict(button, null, { x: 100, y: 2000 }, VIEWPORT), "offscreen");
  assert.equal(hitTestVerdict(button, null, { x: -40, y: 100 }, VIEWPORT), "offscreen");
  assert.equal(hitTestVerdict(button, null, { x: 100, y: 601 }, VIEWPORT), "offscreen");
});

test("a target below the fold is not reported as covered", () => {
  const button = node("BUTTON");
  const verdict = hitTestVerdict(button, null, { x: 400, y: 2000 }, VIEWPORT);
  assert.notEqual(verdict, "covered");
  assert.equal(verdict, "offscreen");
});

test("a real overlay is still covered even when the point is on screen", () => {
  const button = node("BUTTON");
  const overlay = node("DIV");
  assert.equal(hitTestVerdict(button, overlay, { x: 100, y: 100 }, VIEWPORT), "covered");
});

test("the target or its child always allows", () => {
  const child = node("SPAN");
  const button = node("BUTTON", [child]);
  assert.equal(hitTestVerdict(button, button, { x: 10, y: 10 }, VIEWPORT), "allow");
  assert.equal(hitTestVerdict(button, child, { x: 10, y: 10 }, VIEWPORT), "allow");
});

test("no elementFromPoint available allows rather than blocks", () => {
  const button = node("BUTTON");
  assert.equal(hitTestVerdict(button, undefined, { x: 10, y: 10 }, VIEWPORT), "allow");
});

test("pointInViewport rejects degenerate viewports", () => {
  assert.equal(pointInViewport({ x: 10, y: 10 }, { width: 0, height: 0 }), false);
  assert.equal(pointInViewport({ x: 10, y: 10 }, null), false);
  assert.equal(pointInViewport(null, VIEWPORT), false);
});

test("describeBlock names the covering element", () => {
  assert.equal(describeBlock({ tagName: "DIV" }), "div");
  assert.equal(describeBlock(null), "nothing");
});
