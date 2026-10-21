import test from "node:test";
import assert from "node:assert/strict";

import "./frames.js";

const { frameGeometry, COORDINATE_SPACE } = globalThis.LB.frames;

const COORDINATE_LITERAL = "css-pixels";

test("the coordinate space matches the shared contract string", () => {
  assert.equal(COORDINATE_SPACE, COORDINATE_LITERAL);
});

test("reports CSS pixels, not device pixels, at dpr 2", () => {
  const geometry = frameGeometry({ bitmapWidth: 2560, bitmapHeight: 1600, dpr: 2, cssWidth: 1280, cssHeight: 800 });
  assert.equal(geometry.width, 1280);
  assert.equal(geometry.height, 800);
  assert.equal(geometry.source, "bitmap");
  assert.equal(geometry.coordinateSpace, COORDINATE_SPACE);
});

test("reports CSS pixels at dpr 1 unchanged", () => {
  const geometry = frameGeometry({ bitmapWidth: 1280, bitmapHeight: 800, dpr: 1, cssWidth: 1280, cssHeight: 800 });
  assert.equal(geometry.width, 1280);
  assert.equal(geometry.height, 800);
});

test("handles a fractional dpr", () => {
  const geometry = frameGeometry({ bitmapWidth: 1920, bitmapHeight: 1200, dpr: 1.5, cssWidth: 1280, cssHeight: 800 });
  assert.equal(geometry.width, 1280);
  assert.equal(geometry.height, 800);
});

test("trusts the bitmap when no viewport is known", () => {
  const geometry = frameGeometry({ bitmapWidth: 800, bitmapHeight: 600, dpr: 2 });
  assert.equal(geometry.width, 400);
  assert.equal(geometry.height, 300);
  assert.equal(geometry.source, "bitmap");
});

test("falls back to the viewport when the bitmap size disagrees", () => {
  const geometry = frameGeometry({ bitmapWidth: 3000, bitmapHeight: 2000, dpr: 2, cssWidth: 1280, cssHeight: 800 });
  assert.equal(geometry.width, 1280);
  assert.equal(geometry.height, 800);
  assert.equal(geometry.source, "viewport");
  assert.match(geometry.note, /3000x2000/);
});

test("uses the viewport when the bitmap is unknown", () => {
  const geometry = frameGeometry({ dpr: 2, cssWidth: 1024, cssHeight: 768 });
  assert.equal(geometry.width, 1024);
  assert.equal(geometry.height, 768);
  assert.equal(geometry.source, "viewport");
});

test("tolerates a one pixel rounding difference", () => {
  const geometry = frameGeometry({ bitmapWidth: 2562, bitmapHeight: 1601, dpr: 2, cssWidth: 1280, cssHeight: 800 });
  assert.equal(geometry.source, "bitmap");
  assert.equal(geometry.width, 1281);
});

test("ignores an absurd dpr and reports viewport pixels", () => {
  const geometry = frameGeometry({ bitmapWidth: 2560, bitmapHeight: 1600, dpr: 0, cssWidth: 1280, cssHeight: 800 });
  assert.equal(geometry.width, 1280);
  assert.equal(geometry.height, 800);
  assert.equal(geometry.dpr, 1);
});

test("returns null when nothing usable arrived", () => {
  assert.equal(frameGeometry({}), null);
  assert.equal(frameGeometry({ dpr: 2 }), null);
});
