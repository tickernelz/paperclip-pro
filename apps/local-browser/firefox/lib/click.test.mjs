import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));

function createElement(tag) {
  const attrs = {};
  const events = [];
  const element = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    isConnected: true,
    children: [],
    childNodes: [],
    parentElement: null,
    style: {},
    options: [],
    labels: [],
    form: null,
    files: null,
    disabled: false,
    checked: false,
    selected: false,
    isContentEditable: false,
    value: "",
    textContent: "",
    innerText: "",
    innerHTML: "",
    events,
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail, button: event.button });
      return true;
    },
    addEventListener() {},
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    focus() {},
    blur() {},
    click() {
      events.push({ type: "click", detail: 0, button: 0, viaElementClick: true });
    },
    closest: () => null,
    scrollIntoView() {},
    scrollBy() {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30, x: 10, y: 20 }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return element;
}

function bootAgent() {
  const target = createElement("button");
  const body = createElement("body");
  body.children = [target];
  body.childNodes = [target];

  const store = () => {
    const map = new Map();
    return {
      get length() {
        return map.size;
      },
      key: (index) => [...map.keys()][index] ?? null,
      getItem: (name) => (map.has(name) ? map.get(name) : null),
      setItem: (name, value) => map.set(name, String(value)),
      removeItem: (name) => map.delete(name),
      clear: () => map.clear(),
    };
  };

  const document = {
    title: "Click",
    readyState: "complete",
    documentElement: body,
    body,
    activeElement: body,
    createElement: (tag) => createElement(tag),
    createRange: () => ({ selectNodeContents() {} }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: () => target,
    execCommand: () => false,
    getElementsByTagName: () => [body],
    addEventListener() {},
  };

  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    document,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    getSelection: () => null,
    scrollBy() {},
    scrollTo() {},
    addEventListener() {},
  };

  let handler = null;
  const sandbox = {
    browser: { runtime: { onMessage: { addListener: (fn) => { handler = fn; } } } },
    window,
    document,
    location: { href: "https://example.test/click" },
    performance: { getEntriesByType: () => [] },
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    KeyboardEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    MouseEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    PointerEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    WheelEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    localStorage: store(),
    sessionStorage: store(),
    setTimeout,
    clearTimeout,
    console,
    URL,
    TextDecoder,
    TextEncoder,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    fetch: async () => {
      throw new Error("offline");
    },
    DataTransfer: class {
      constructor() {
        this.files = [];
        this.items = { add: () => {} };
      }
    },
    File: class {},
    FileReader: class {},
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ close() {} }),
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of manifest.content_scripts[0].js) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }

  return {
    target,
    sandbox,
    press: async (args) => handler({ channel: "lb", op: "input", args }),
    clicks: () => target.events.filter((event) => event.type === "click"),
    dblclicks: () => target.events.filter((event) => event.type === "dblclick"),
    types: () => target.events.map((event) => event.type),
  };
}

test("a single press produces exactly one click with detail 1", async () => {
  const agent = bootAgent();
  await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: 1 });
  await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, clickCount: 1 });

  assert.equal(agent.clicks().length, 1);
  assert.equal(agent.clicks()[0].detail, 1);
  assert.equal(agent.dblclicks().length, 0);
});

test("a two press double click produces two clicks then one dblclick", async () => {
  const agent = bootAgent();
  await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: 1 });
  await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, clickCount: 1 });
  await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: 2 });
  await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, clickCount: 2 });

  const clicks = agent.clicks();
  assert.equal(clicks.length, 2, "a double click must reach the page as two clicks, not three");
  assert.deepEqual(clicks.map((event) => event.detail), [1, 2]);
  const dbl = agent.dblclicks();
  assert.equal(dbl.length, 1);
  assert.equal(dbl[0].detail, 2);
});

test("a triple press produces three clicks with details one two three", async () => {
  const agent = bootAgent();
  for (const count of [1, 2, 3]) {
    await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: count });
    await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, clickCount: count });
  }

  const clicks = agent.clicks();
  assert.equal(clicks.length, 3);
  assert.deepEqual(clicks.map((event) => event.detail), [1, 2, 3]);
  const dbl = agent.dblclicks();
  assert.equal(dbl.length, 1, "a browser fires dblclick exactly once, on the second click");
  assert.equal(dbl[0].detail, 2);
});

test("a triple press matches the browser order click one two dblclick then click three", async () => {
  const agent = bootAgent();
  for (const count of [1, 2, 3]) {
    await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: count });
    await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, clickCount: count });
  }

  const sequence = agent
    .types()
    .filter((type) => type === "click" || type === "dblclick");
  assert.equal(sequence.join(","), "click,click,dblclick,click");
});

test("the click event carries the press count as its own detail, not replayed levels", async () => {
  const agent = bootAgent();
  await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: 2 });
  await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, clickCount: 2 });

  const clicks = agent.clicks();
  assert.equal(clicks.length, 1, "one press is one click regardless of its count");
  assert.equal(clicks[0].detail, 2);
});

test("a right click produces auxclick and never a click", async () => {
  const agent = bootAgent();
  await agent.press({ kind: "mouse", action: "down", x: 20, y: 30, button: "right" });
  await agent.press({ kind: "mouse", action: "up", x: 20, y: 30, button: "right" });

  assert.equal(agent.clicks().length, 0);
  assert.equal(agent.target.events.filter((event) => event.type === "auxclick").length, 1);
});

test("a move never clicks", async () => {
  const agent = bootAgent();
  await agent.press({ kind: "mouse", action: "move", x: 20, y: 30 });
  assert.equal(agent.clicks().length, 0);
  assert.deepEqual(agent.types(), ["pointerover", "pointermove", "mousemove"]);
});

function bidiPress(clickCount) {
  const { LB } = bootAgent().sandbox;
  const state = LB.input.createInputState();
  state.apply({ kind: "mouse", action: "down", x: 20, y: 30, clickCount });
  const plan = state.apply({ kind: "mouse", action: "up", x: 20, y: 30, clickCount });
  if (!plan.clicked) throw new Error("the fixture must produce a click effect");
  const sources = LB.input.bidiActions(plan);
  const pointer = sources.find((source) => source.type === "pointer");
  return { plan, actions: pointer ? pointer.actions : [] };
}

function bidiPointerActions(clickCount) {
  return bidiPress(clickCount).actions;
}

test("the BiDi plan sends the same pointer actions whatever the click count", async () => {
  const single = bidiPointerActions(1);
  const triple = bidiPointerActions(3);

  assert.equal(JSON.stringify(triple), JSON.stringify(single), "a higher click count must not add replayed down and up pairs");
  assert.equal(triple.filter((action) => action.type === "pointerDown").length, 0, "the viewer already sent the press");
  assert.equal(triple.filter((action) => action.type === "pointerUp").length, 1);
});

test("a BiDi down press sends exactly one pointer down", async () => {
  const { LB } = bootAgent().sandbox;
  const state = LB.input.createInputState();
  const plan = state.apply({ kind: "mouse", action: "down", x: 20, y: 30, clickCount: 3 });
  const sources = LB.input.bidiActions(plan);
  const pointer = sources.find((source) => source.type === "pointer");
  assert.equal(pointer.actions.filter((action) => action.type === "pointerDown").length, 1);
});
