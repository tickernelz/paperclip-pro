import test from "node:test";
import assert from "node:assert/strict";

import "./text.js";
import "./refmap.js";
import "./cursor.js";
import "./snapshot.js";
import { el, t, createFakeAdapter } from "./test-dom.mjs";

const { buildSnapshot } = globalThis.LB.snapshot;
const { createRefMap } = globalThis.LB.refmap;

function snapshot(body, options = {}) {
  return buildSnapshot(createFakeAdapter({ body }), options);
}

test("skips display:none, visibility:hidden, opacity:0 and zero-box subtrees", () => {
  const body = el("body", {
    children: [
      el("div", { style: { display: "none" }, children: [el("button", { children: [t("Hidden")] })] }),
      el("div", { style: { visibility: "hidden" }, children: [el("button", { children: [t("Invisible")] })] }),
      el("div", { style: { opacity: "0" }, children: [el("button", { children: [t("Transparent")] })] }),
      el("div", { box: { width: 0, height: 0 }, children: [el("button", { children: [t("Zero box")] })] }),
      el("div", { attrs: { "aria-hidden": "true" }, children: [el("button", { children: [t("Aria hidden")] })] }),
      el("button", { children: [t("Visible")] }),
    ],
  });

  const result = snapshot(body);
  const buttons = result.nodes.filter((node) => node.role === "button").map((node) => node.name);
  assert.deepEqual(buttons, ["Visible"]);
});

test("keeps hidden nodes when includeHidden is set", () => {
  const body = el("body", {
    children: [el("div", { style: { display: "none" }, children: [el("button", { children: [t("Hidden")] })] })],
  });
  const result = snapshot(body, { includeHidden: true });
  assert.deepEqual(result.nodes.filter((node) => node.role === "button").map((node) => node.name), ["Hidden"]);
});

test("keeps options visible even though they have no box", () => {
  const body = el("body", {
    children: [
      el("select", {
        children: [el("option", { box: { width: 0, height: 0 }, props: { selected: true }, children: [t("Alpha")] })],
      }),
    ],
  });
  const result = snapshot(body);
  const option = result.nodes.find((node) => node.role === "option");
  assert.equal(option.name, "Alpha");
  assert.equal(option.selected, true);
  assert.equal(option.ref, "e2");
});

test("assigns refs in document order to interactive nodes only", () => {
  const body = el("body", {
    children: [
      el("h1", { children: [t("Title")] }),
      el("button", { children: [t("One")] }),
      el("a", { attrs: { href: "/next" }, children: [t("Two")] }),
      el("input", { attrs: { type: "text" }, props: { value: "typed" } }),
      el("p", { children: [t("Paragraph")] }),
    ],
  });

  const result = snapshot(body);
  const withRefs = result.nodes.filter((node) => node.ref).map((node) => [node.ref, node.role]);
  assert.deepEqual(withRefs, [
    ["e1", "button"],
    ["e2", "link"],
    ["e3", "textbox"],
  ]);
  const heading = result.nodes.find((node) => node.role === "heading");
  assert.equal(heading.ref, undefined);
});

test("reports depth relative to the snapshot root", () => {
  const body = el("body", {
    children: [el("div", { children: [el("section", { children: [el("button", { children: [t("Deep")] })] })] })],
  });
  const result = snapshot(body);
  const button = result.nodes.find((node) => node.role === "button");
  const textRun = result.nodes.find((node) => node.role === "text");
  assert.equal(button.depth, 2);
  assert.equal(textRun.depth, 3);
});

test("collapses whitespace in names and text runs", () => {
  const body = el("body", {
    children: [el("p", { children: [t("  Hello   world \n again  ")] })],
  });
  const result = snapshot(body);
  const textRun = result.nodes.find((node) => node.role === "text");
  assert.equal(textRun.name, "Hello world again");
  assert.equal(textRun.ref, undefined);
});

test("caps names at 160 characters", () => {
  const body = el("body", { children: [el("button", { children: [t("x".repeat(400))] })] });
  const result = snapshot(body);
  const button = result.nodes.find((node) => node.role === "button");
  assert.equal(button.name.length, 160);
  assert.equal(button.name.endsWith("\u2026"), true);
});

test("emits text runs without refs", () => {
  const body = el("body", { children: [el("p", { children: [t("Plain words")] })] });
  const result = snapshot(body);
  assert.deepEqual(result.nodes, [{ role: "text", name: "Plain words", depth: 1 }]);
});

test("truncates at maxNodes and continues from the cursor", () => {
  const children = [];
  for (let index = 1; index <= 30; index += 1) {
    children.push(el("button", { attrs: { "aria-label": "Button " + index } }));
  }
  const body = el("body", { children });
  const adapter = createFakeAdapter({ body });
  const refs = createRefMap();

  const first = buildSnapshot(adapter, { maxNodes: 10, refs });
  assert.equal(first.nodes.length, 10);
  assert.equal(first.total, 30);
  assert.equal(first.truncated, true);
  assert.equal(first.cursor, "10");
  assert.equal(first.nodes[0].ref, "e1");

  const second = buildSnapshot(adapter, { maxNodes: 10, cursor: first.cursor, refs });
  assert.equal(second.nodes[0].name, "Button 11");
  assert.equal(second.nodes[0].ref, "e11");
});

test("omits cursor and truncated when everything fits", () => {
  const body = el("body", { children: [el("button", { children: [t("Only")] })] });
  const result = snapshot(body);
  assert.equal(result.truncated, false);
  assert.equal(result.cursor, undefined);
  assert.equal(result.total, 2);
});

test("uses aria-label, labels and placeholders in that order", () => {
  const body = el("body", {
    children: [
      el("button", { attrs: { "aria-label": "Close dialog" }, children: [t("x")] }),
      el("input", { attrs: { type: "text", id: "email" }, props: { label: "Email address" } }),
      el("input", { attrs: { type: "search", placeholder: "Search docs" } }),
    ],
  });
  const result = snapshot(body);
  const names = result.nodes.filter((node) => node.ref).map((node) => node.name);
  assert.deepEqual(names, ["Close dialog", "Email address", "Search docs"]);
});

test("honours an explicit aria role over the tag", () => {
  const body = el("body", { children: [el("div", { attrs: { role: "button" }, children: [t("Custom")] })] });
  const result = snapshot(body);
  assert.equal(result.nodes[0].role, "button");
  assert.equal(result.nodes[0].ref, "e1");
});

test("reports control state without leaking password values", () => {
  const body = el("body", {
    children: [
      el("input", { attrs: { type: "checkbox" }, props: { checked: true } }),
      el("input", { attrs: { type: "password" }, props: { value: "hunter2" } }),
      el("input", { attrs: { type: "text" }, props: { value: "visible" } }),
      el("button", { props: { disabled: true }, children: [t("Disabled")] }),
    ],
  });
  const result = snapshot(body);
  const checkbox = result.nodes.find((node) => node.role === "checkbox");
  const password = result.nodes.filter((node) => node.role === "textbox")[0];
  const plain = result.nodes.filter((node) => node.role === "textbox")[1];
  const button = result.nodes.find((node) => node.role === "button");
  assert.equal(checkbox.checked, true);
  assert.equal(password.value, undefined);
  assert.equal(plain.value, "visible");
  assert.equal(button.disabled, true);
});

test("drops unnamed structural nodes but keeps unnamed interactive ones", () => {
  const body = el("body", {
    children: [
      el("form", { children: [el("input", { attrs: { type: "text" } })] }),
      el("div", { attrs: { role: "navigation" }, children: [el("button", { children: [t("Go")] })] }),
    ],
  });
  const result = snapshot(body);
  assert.deepEqual(result.nodes.filter((node) => node.ref).map((node) => [node.role, node.name]), [
    ["textbox", ""],
    ["button", "Go"],
  ]);
  assert.equal(result.nodes.some((node) => node.role === "form"), false);
});

test("returns missing when the selector matches nothing", () => {
  const body = el("body", { children: [el("p", { children: [t("x")] })] });
  const result = snapshot(body, { selector: "#nope" });
  assert.equal(result.missing, true);
  assert.deepEqual(result.nodes, []);
});

test("scopes to a selector subtree", () => {
  const body = el("body", {
    children: [
      el("div", { attrs: { id: "outside" }, children: [el("button", { children: [t("Outside")] })] }),
      el("div", { attrs: { id: "inside" }, children: [el("button", { children: [t("Inside")] })] }),
    ],
  });
  const result = snapshot(body, { selector: "#inside" });
  assert.deepEqual(result.nodes.filter((node) => node.ref).map((node) => node.name), ["Inside"]);
});

function numberedButtons(count) {
  const children = [];
  for (let index = 1; index <= count; index += 1) {
    children.push(el("button", { attrs: { "aria-label": "Button " + index } }));
  }
  return el("body", { children });
}

function envelope(offset) {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

test("a decimal cursor skips exactly that many nodes", () => {
  const adapter = createFakeAdapter({ body: numberedButtons(30) });
  const refs = createRefMap();
  const page = buildSnapshot(adapter, { maxNodes: 10, cursor: "20", refs });
  assert.equal(page.offset, 20);
  assert.equal(page.nodes.length, 10);
  assert.equal(page.nodes[0].name, "Button 21");
  assert.equal(page.nodes[9].name, "Button 30");
  assert.equal(page.truncated, false);
  assert.equal(page.cursor, undefined);
  assert.equal(page.cursorValid, true);
});

test("the server's base64url cursor is honoured as the same offset", () => {
  const adapter = createFakeAdapter({ body: numberedButtons(30) });
  const page = buildSnapshot(adapter, { maxNodes: 5, cursor: envelope(12), refs: createRefMap() });
  assert.equal(page.offset, 12);
  assert.equal(page.nodes[0].name, "Button 13");
});

test("cursor round-trips page by page without gaps or repeats", () => {
  const adapter = createFakeAdapter({ body: numberedButtons(25) });
  const refs = createRefMap();
  const seen = [];
  let cursor;
  for (let page = 0; page < 5; page += 1) {
    const result = buildSnapshot(adapter, { maxNodes: 7, cursor, refs });
    for (const node of result.nodes) seen.push(node.name);
    cursor = result.cursor;
    if (!cursor) break;
  }
  assert.equal(seen.length, 25);
  assert.deepEqual(seen, Array.from({ length: 25 }, (_, index) => "Button " + (index + 1)));
  assert.equal(new Set(seen).size, 25);
});

test("an unparseable cursor is reported invalid and starts from the top", () => {
  const adapter = createFakeAdapter({ body: numberedButtons(30) });
  const page = buildSnapshot(adapter, { maxNodes: 5, cursor: "not-a-cursor", refs: createRefMap() });
  assert.equal(page.cursorValid, false);
  assert.equal(page.offset, 0);
  assert.equal(page.nodes[0].name, "Button 1");
});

test("a cursor past the end is flagged stale instead of silently empty", () => {
  const adapter = createFakeAdapter({ body: numberedButtons(5) });
  const page = buildSnapshot(adapter, { maxNodes: 5, cursor: "99", refs: createRefMap() });
  assert.equal(page.cursorStale, true);
  assert.equal(page.truncated, false);
  assert.equal(page.nodes.length, 0);
  assert.equal(page.total, 5);
  assert.equal(page.cursor, undefined);
});

test("reuses refs for the same element through an injected map", () => {
  const body = el("body", { children: [el("button", { children: [t("A")] }), el("button", { children: [t("B")] })] });
  const adapter = createFakeAdapter({ body });
  const refs = createRefMap();
  const first = buildSnapshot(adapter, { refs });
  const second = buildSnapshot(adapter, { refs });
  assert.deepEqual(first.nodes.filter((node) => node.ref).map((node) => node.ref), ["e1", "e2"]);
  assert.deepEqual(second.nodes.filter((node) => node.ref).map((node) => node.ref), ["e1", "e2"]);
  assert.equal(refs.size(), 2);
});

test("skips script, style and svg content", () => {
  const body = el("body", {
    children: [
      el("script", { children: [t("var secret = 1;")] }),
      el("style", { children: [t("body { color: red }")] }),
      el("svg", { children: [el("button", { children: [t("Icon")] })] }),
      el("button", { children: [t("Real")] }),
    ],
  });
  const result = snapshot(body);
  assert.deepEqual(result.nodes.filter((node) => node.ref).map((node) => node.name), ["Real"]);
  assert.equal(result.nodes.some((node) => node.name.includes("secret")), false);
});
