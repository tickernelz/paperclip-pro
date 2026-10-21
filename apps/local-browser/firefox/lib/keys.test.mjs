import test from "node:test";
import assert from "node:assert/strict";

import "./keys.js";

const { resolve, bidiValue } = globalThis.LB.keys;

test("maps named keys to DOM and BiDi values", () => {
  const enter = resolve("Enter");
  assert.equal(enter.key, "Enter");
  assert.equal(enter.code, "Enter");
  assert.equal(enter.keyCode, 13);
  assert.equal(enter.bidi, "\uE007");
  assert.equal(resolve("ArrowDown").keyCode, 40);
  assert.equal(resolve("esc").key, "Escape");
  assert.equal(resolve("PageUp").bidi, "\uE00E");
});

test("matches named keys case insensitively", () => {
  assert.equal(resolve("BACKSPACE").key, "Backspace");
  assert.equal(resolve("shift").modifier, true);
});

test("derives codes for single characters", () => {
  const letter = resolve("a");
  assert.equal(letter.key, "a");
  assert.equal(letter.code, "KeyA");
  assert.equal(letter.printable, true);
  assert.equal(letter.bidi, "a");
  assert.equal(resolve("7").code, "Digit7");
  assert.equal(resolve("/").code, "Slash");
});

test("falls back to the literal name", () => {
  const unknown = resolve("F13");
  assert.equal(unknown.key, "F13");
  assert.equal(unknown.code, "");
});

test("exposes BiDi values through bidiValue", () => {
  assert.equal(bidiValue("Tab"), "\uE004");
  assert.equal(bidiValue("z"), "z");
});
