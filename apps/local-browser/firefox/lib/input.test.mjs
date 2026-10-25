import test from "node:test";
import assert from "node:assert/strict";

import "./keys.js";
import "./input.js";

const { createInputState, bidiActions, clickCountOf, buttonOf, parseCombo, actBatches } = globalThis.LB.input;

test("a move never clicks", () => {
  const state = createInputState();
  const plan = state.apply({ kind: "mouse", action: "move", x: 10, y: 20 });
  assert.equal(plan.action, "move");
  assert.equal(plan.clicked, false);
  assert.deepEqual(plan.effects.map((effect) => effect.type), ["pointerMove"]);
  assert.equal(plan.effects.some((effect) => effect.type === "click"), false);
});

test("down latches and up clicks exactly once", () => {
  const state = createInputState();
  const down = state.apply({ kind: "mouse", action: "down", x: 4, y: 5 });
  assert.equal(down.clicked, false);
  assert.deepEqual(down.effects.map((effect) => effect.type), ["pointerDown"]);

  const up = state.apply({ kind: "mouse", action: "up", x: 4, y: 5 });
  assert.equal(up.clicked, true);
  assert.deepEqual(up.effects.map((effect) => effect.type), ["pointerUp", "click"]);
  assert.equal(up.effects.filter((effect) => effect.type === "click").length, 1);

  const orphan = state.apply({ kind: "mouse", action: "up", x: 4, y: 5 });
  assert.equal(orphan.clicked, false);
  assert.deepEqual(orphan.effects.map((effect) => effect.type), ["pointerUp"]);
});

test("maps button names to pointer indices", () => {
  assert.deepEqual(buttonOf("left"), { name: "left", index: 0 });
  assert.deepEqual(buttonOf("middle"), { name: "middle", index: 1 });
  assert.deepEqual(buttonOf("right"), { name: "right", index: 2 });
  assert.deepEqual(buttonOf(undefined), { name: "left", index: 0 });
  assert.deepEqual(buttonOf("sideways"), { name: "left", index: 0 });

  const state = createInputState();
  const plan = state.apply({ kind: "mouse", action: "down", x: 0, y: 0, button: "right" });
  assert.equal(plan.effects[0].buttonIndex, 2);
});

test("clamps clickCount into one through three", () => {
  assert.equal(clickCountOf(undefined), 1);
  assert.equal(clickCountOf(0), 1);
  assert.equal(clickCountOf(2), 2);
  assert.equal(clickCountOf(9), 3);
  assert.equal(clickCountOf(1.6), 2);
});

test("a double click adds no extra down and up pair for BiDi", () => {
  const state = createInputState();
  state.apply({ kind: "mouse", action: "down", x: 1, y: 2, clickCount: 2 });
  const up = state.apply({ kind: "mouse", action: "up", x: 1, y: 2, clickCount: 2 });
  assert.equal(up.clicked, true, "the fixture must produce a click effect");
  const actions = bidiActions(up)[0].actions;
  assert.deepEqual(
    actions.map((action) => action.type),
    ["pointerMove", "pointerUp"],
  );
});

test("key down latches a modifier and key up releases it", () => {
  const state = createInputState();
  const down = state.apply({ kind: "key", action: "down", key: "Shift" });
  assert.deepEqual(state.latchedModifiers(), ["shift"]);
  assert.equal(down.effects[0].value, "\uE008");

  const up = state.apply({ kind: "key", action: "up", key: "Shift" });
  assert.deepEqual(up.released, ["shift"]);
  assert.deepEqual(state.latchedModifiers(), []);
  assert.deepEqual(up.effects.map((effect) => effect.type), ["keyUp"]);
});

test("a non modifier key up releases every latched modifier", () => {
  const state = createInputState();
  state.apply({ kind: "key", action: "down", key: "Shift" });
  state.apply({ kind: "key", action: "down", key: "Control" });
  const up = state.apply({ kind: "key", action: "up", key: "a" });
  assert.deepEqual(up.released, ["ctrl", "shift"]);
  assert.deepEqual(up.effects.map((effect) => effect.type), ["keyUp", "keyUp", "keyUp"]);
  assert.deepEqual(state.latchedModifiers(), []);
});

test("pointer up releases latched modifiers", () => {
  const state = createInputState();
  state.apply({ kind: "key", action: "down", key: "Shift" });
  state.apply({ kind: "mouse", action: "down", x: 3, y: 3 });
  const up = state.apply({ kind: "mouse", action: "up", x: 3, y: 3 });
  assert.deepEqual(up.released, ["shift"]);
  assert.deepEqual(up.effects.map((effect) => effect.type), ["pointerUp", "click", "keyUp"]);
  assert.deepEqual(state.latchedModifiers(), []);
});

test("reads flat modifier booleans, not a nested object", () => {
  const state = createInputState();
  const plan = state.apply({ kind: "key", action: "down", key: "a", alt: true, shift: true, ctrl: false });
  assert.equal(plan.modifiers.alt, true);
  assert.equal(plan.modifiers.shift, true);
  assert.equal(plan.modifiers.ctrl, false);
  assert.equal(plan.modifiers.meta, false);
});

test("types a single character once and multi character text as given", () => {
  const state = createInputState();
  const single = state.apply({ kind: "key", action: "down", key: "a" });
  assert.equal(single.effects[0].insert, "a");
  assert.deepEqual(bidiActions(single)[0].actions.map((action) => action.type), ["keyDown"]);

  const text = state.apply({ kind: "key", action: "down", key: "Enter", text: "hi" });
  assert.equal(text.effects[0].insert, "hi");
  const actions = bidiActions(text)[0].actions;
  assert.deepEqual(actions.map((action) => action.value), ["Enter", "h", "h", "i", "i"]);
});

test("wheel keeps deltas and never touches the pointer button", () => {
  const state = createInputState();
  const plan = state.apply({ kind: "wheel", deltaX: 0, deltaY: 240, x: 100, y: 200 });
  assert.equal(plan.effects[0].deltaY, 240);
  const actions = bidiActions(plan)[0].actions;
  assert.equal(actions[0].type, "scroll");
  assert.equal(actions[0].deltaY, 240);
});

test("rejects an unknown kind or action", () => {
  const state = createInputState();
  assert.throws(() => state.apply({ kind: "touch", action: "down" }), /kind/);
  assert.throws(() => state.apply({ kind: "mouse", action: "click", x: 1, y: 1 }), /mouse action/);
  assert.throws(() => state.apply({ kind: "key", action: "press", key: "a" }), /key action/);
});

test("reset clears latched modifiers and the pointer latch", () => {
  const state = createInputState();
  state.apply({ kind: "key", action: "down", key: "Shift" });
  state.apply({ kind: "mouse", action: "down", x: 1, y: 1 });
  state.reset();
  assert.deepEqual(state.latchedModifiers(), []);
  const up = state.apply({ kind: "mouse", action: "up", x: 1, y: 1 });
  assert.equal(up.clicked, false);
});

test("BiDi groups effects into pointer, key and wheel sources", () => {
  const state = createInputState();
  const plan = state.apply({ kind: "mouse", action: "move", x: 5, y: 6 });
  const sources = bidiActions(plan);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].type, "pointer");
  assert.equal(sources[0].id, "mouse");
  assert.deepEqual(sources[0].actions[0], { type: "pointerMove", x: 5, y: 6, origin: "viewport" });
});

test("key strings parse into a key and modifiers", () => {
  assert.deepEqual(parseCombo("Control+a"), { key: "a", modifiers: ["ctrl"] });
  assert.deepEqual(parseCombo("Cmd+Shift+Enter"), { key: "Enter", modifiers: ["meta", "shift"] });
  assert.deepEqual(parseCombo("Control++"), { key: "+", modifiers: ["ctrl"] });
  assert.deepEqual(parseCombo("+"), { key: "+", modifiers: [] });
  assert.deepEqual(parseCombo("a+b"), { key: "a+b", modifiers: [] });
});

test("type on macOS selects all with Meta, clears with Backspace when the text is empty", () => {
  const batches = actBatches({ action: "type", text: "" }, { x: 3.6, y: 4.4 }, true);
  assert.deepEqual(batches[0][0].actions[0], { type: "pointerMove", x: 4, y: 4, origin: "viewport" });
  assert.equal(batches[1][0].actions[0].value, "");
  assert.deepEqual(batches[2][0].actions, [
    { type: "keyDown", value: "" },
    { type: "keyUp", value: "" },
  ]);
  assert.equal(batches.length, 3);
});

test("hover only moves and a done check sends nothing", () => {
  assert.deepEqual(actBatches({ action: "hover" }, { x: 1, y: 2 }, false)[0][0].actions.map((action) => action.type), ["pointerMove"]);
  assert.deepEqual(actBatches({ action: "check" }, { x: 1, y: 2, done: true }, false), []);
});
