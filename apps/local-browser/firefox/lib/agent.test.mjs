import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const FILES = JSON.parse(readFileSync(root + "manifest.json", "utf8")).content_scripts[0].js;

function makeElement(tag, options = {}) {
  const attrs = { ...(options.attrs || {}) };
  const element = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    isConnected: true,
    children: options.children || [],
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
    value: options.value === undefined ? "" : options.value,
    textContent: options.text || "",
    innerText: options.text || "",
    innerHTML: options.text || "",
    dispatchEvent: () => true,
    addEventListener: () => {},
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    focus: () => {},
    blur: () => {},
    click: () => {},
    closest: () => null,
    scrollIntoView: () => {},
    scrollBy: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20, x: 0, y: 0 }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  for (const child of element.children) child.parentElement = element;
  element.childNodes = element.children;
  return element;
}

function memoryStore() {
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
}

function loadAgent(body, options = {}) {
  let handler = null;
  const location = { href: "https://example.test/page" };
  const document = {
    title: "Fixture",
    readyState: "complete",
    documentElement: body,
    body,
    activeElement: body,
    createElement: (tag) => makeElement(tag),
    createRange: () => ({ selectNodeContents() {} }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: options.elementFromPoint || (() => body),
    execCommand: () => false,
    getElementsByTagName: () => [body],
    addEventListener: () => {},
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
    scrollBy: () => {},
    scrollTo: () => {},
    addEventListener: () => {},
  };
  const sandbox = {
    browser: { runtime: { onMessage: { addListener: (fn) => { handler = fn; } } } },
    window,
    document,
    location,
    performance: { getEntriesByType: () => [] },
    MutationObserver: class {
      observe() {}
    },
    Event: class {},
    KeyboardEvent: class {},
    MouseEvent: class {},
    PointerEvent: class {},
    WheelEvent: class {},
    localStorage: memoryStore(),
    sessionStorage: memoryStore(),
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
        this.items = { add: (file) => this.files.push(file) };
      }
    },
    File: class {},
    FileReader: class {},
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ close() {} }),
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of FILES) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }
  return {
    call: (op, args) => handler({ channel: "lb", op, args }),
    navigate: (href) => {
      location.href = href;
    },
  };
}

function buttons(count, prefix = "Button") {
  const children = [];
  for (let index = 0; index < count; index += 1) {
    children.push(makeElement("button", { text: prefix + " " + index }));
  }
  const body = makeElement("body", { children });
  body.childNodes = children;
  return body;
}

function refsOf(nodes) {
  return nodes
    .filter((node) => node.ref)
    .map((node) => node.ref + "=" + node.name)
    .join("|");
}

function namesOf(nodes) {
  return nodes.map((node) => node.name).join("|");
}

test("restarts refs at e1 when a snapshot carries no cursor", async () => {
  const body = buttons(3);
  const agent = loadAgent(body);

  const first = await agent.call("snapshot", {});
  assert.equal(refsOf(first.result.nodes), "e1=Button 0|e2=Button 1|e3=Button 2");

  body.children.splice(1, 1);
  body.childNodes = body.children;

  const second = await agent.call("snapshot", {});
  assert.equal(refsOf(second.result.nodes), "e1=Button 0|e2=Button 2");
});

test("restarts refs when the cursor is not a decimal offset", async () => {
  const body = buttons(3);
  const agent = loadAgent(body);

  await agent.call("snapshot", {});
  const stale = await agent.call("snapshot", { cursor: "eyJvIjoxMjB9" });
  assert.equal(refsOf(stale.result.nodes), "e1=Button 0|e2=Button 1|e3=Button 2");
  assert.equal(stale.result.total, 3);
});

test("keeps refs monotonic while paging with a decimal cursor", async () => {
  const body = buttons(4);
  const agent = loadAgent(body);

  const first = await agent.call("snapshot", { maxNodes: 10 });
  assert.equal(refsOf(first.result.nodes), "e1=Button 0|e2=Button 1|e3=Button 2|e4=Button 3");

  const paged = await agent.call("snapshot", { maxNodes: 10, cursor: "2" });
  assert.equal(refsOf(paged.result.nodes), "e3=Button 2|e4=Button 3");
});

test("accepts a decimal cursor offset and returns the following page", async () => {
  const body = buttons(14);
  const agent = loadAgent(body);

  const first = await agent.call("snapshot", { maxNodes: 10 });
  assert.equal(first.result.nodes.length, 10);
  assert.equal(first.result.total, 14);
  assert.equal(first.result.truncated, true);
  assert.equal(first.result.cursor, "10");

  const second = await agent.call("snapshot", { maxNodes: 10, cursor: first.result.cursor });
  assert.equal(namesOf(second.result.nodes), "Button 10|Button 11|Button 12|Button 13");
  assert.equal(second.result.total, 14);
  assert.equal(second.result.truncated, false);
  assert.equal(second.result.cursor, undefined);
});

test("a cursor past the end restarts instead of returning an empty page", async () => {
  const body = buttons(3);
  const agent = loadAgent(body);

  const page = await agent.call("snapshot", { maxNodes: 10, cursor: "3" });
  assert.equal(page.result.cursorReset, true);
  assert.equal(refsOf(page.result.nodes), "e1=Button 0|e2=Button 1|e3=Button 2");
  assert.equal(page.result.total, 3);
  assert.equal(page.result.offset, 0);
  assert.equal(page.result.truncated, false);
  assert.equal(page.result.cursor, undefined);
});

test("reports the offset of the first node it returned", async () => {
  const body = buttons(14);
  const agent = loadAgent(body);

  const first = await agent.call("snapshot", { maxNodes: 10 });
  assert.equal(first.result.offset, 0);

  const second = await agent.call("snapshot", { maxNodes: 10, cursor: first.result.cursor });
  assert.equal(second.result.offset, 10);
  assert.equal(second.result.cursorReset, undefined);
  assert.equal(second.result.cursorIgnored, false);
});

test("restarts from a stale server envelope instead of returning an empty page", async () => {
  const body = buttons(3);
  const agent = loadAgent(body);

  const stale = await agent.call("snapshot", { cursor: "eyJvIjoxMjB9" });
  assert.equal(stale.result.cursorReset, true);
  assert.equal(stale.result.cursorIgnored, undefined);
  assert.equal(stale.result.offset, 0);
  assert.equal(refsOf(stale.result.nodes), "e1=Button 0|e2=Button 1|e3=Button 2");
});

test("flags a cursor it could not decode", async () => {
  const body = buttons(3);
  const agent = loadAgent(body);

  const garbage = await agent.call("snapshot", { cursor: "!!!" });
  assert.equal(garbage.result.cursorIgnored, true);
  assert.equal(garbage.result.cursorReset, undefined);
  assert.equal(garbage.result.offset, 0);
  assert.equal(refsOf(garbage.result.nodes), "e1=Button 0|e2=Button 1|e3=Button 2");
});

test("flags a cursor the page has since navigated away from", async () => {
  const body = buttons(3);
  const agent = loadAgent(body);

  agent.navigate("https://example.test/other");
  const moved = await agent.call("snapshot", { cursor: "1" });
  assert.equal(moved.result.cursorIgnored, true);
  assert.equal(moved.result.offset, 0);
});

test("resets refs after a navigation", async () => {
  const body = buttons(2);
  const agent = loadAgent(body);

  const first = await agent.call("snapshot", { maxNodes: 10 });
  assert.equal(refsOf(first.result.nodes), "e1=Button 0|e2=Button 1");

  agent.navigate("https://example.test/other");
  const second = await agent.call("snapshot", { maxNodes: 10 });
  assert.equal(refsOf(second.result.nodes), "e1=Button 0|e2=Button 1");
});

function textBody(text) {
  const body = makeElement("body", { text });
  body.childNodes = [];
  return body;
}

test("the content agent answers documentState with the document state schema", async () => {
  const agent = loadAgent(buttons(1));
  const response = await agent.call("documentState", {});
  assert.equal(response.ok, true);
  const state = response.result;
  for (const key of ["documentId", "url", "readyState", "visibilityState", "navigationType", "restoredFromBfcache", "wasDiscarded", "prerendering", "loadedAt", "ageMs", "requestsSinceLoad", "xhrSinceLoad", "stale", "staleReasons"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(state, key), key + " is missing");
  }
  assert.equal(state.url, "https://example.test/page");
});

test("snapshot, read and wait results carry the same document", async () => {
  const agent = loadAgent(buttons(2));
  const snapshot = await agent.call("snapshot", {});
  const read = await agent.call("read", {});
  const wait = await agent.call("wait", { urlIncludes: "example" });
  assert.equal(typeof snapshot.result.document.documentId, "string");
  assert.equal(read.result.document.documentId, snapshot.result.document.documentId);
  assert.equal(wait.result.document.documentId, snapshot.result.document.documentId);
});

test("read honours a maxChars far above the old 40000 clamp", async () => {
  const agent = loadAgent(textBody("x".repeat(60000)));
  const response = await agent.call("read", { maxChars: 50000, format: "html" });
  assert.equal(response.ok, true);
  assert.equal(response.result.totalChars, 60000);
  assert.equal(response.result.text.length, 50000);
  assert.equal(response.result.truncated, true);
});

test("read honours a maxChars below the old 200 floor", async () => {
  const agent = loadAgent(textBody("y".repeat(500)));
  const response = await agent.call("read", { maxChars: 50, format: "html" });
  assert.equal(response.result.text.length, 50);
});

test("a wait that runs out reports matched false instead of throwing", async () => {
  const agent = loadAgent(buttons(1));
  const response = await agent.call("wait", { selector: "#never", timeoutMs: 150 });
  assert.equal(response.ok, true);
  assert.equal(response.result.matched, false);
  assert.ok(response.result.elapsedMs >= 100);
  assert.match(response.result.note, /Nothing matched/);
});

test("a wait that matches says which condition held", async () => {
  const agent = loadAgent(buttons(1));
  const response = await agent.call("wait", { urlIncludes: "/page" });
  assert.equal(response.result.matched, true);
  assert.equal(response.result.condition, "url");
});


test("actPrepare returns the rounded centre of a reachable target without firing events", async () => {
  const body = buttons(1);
  const [button] = body.children;
  let fired = 0;
  button.dispatchEvent = () => {
    fired += 1;
    return true;
  };
  button.getBoundingClientRect = () => ({ left: 10, top: 10, width: 101, height: 31, x: 10, y: 10 });
  const agent = loadAgent(body, { elementFromPoint: () => button });
  await agent.call("snapshot", {});
  const response = await agent.call("actPrepare", { action: "click", ref: "e1" });
  assert.equal(response.ok, true, JSON.stringify(response.error || {}));
  assert.equal(response.result.x, 61);
  assert.equal(response.result.y, 26);
  assert.equal(response.result.covered, false);
  assert.equal(response.result.before.url, "https://example.test/page");
  assert.equal(fired, 0);
});

test("actPrepare refuses a covered target unless force marks it covered", async () => {
  const body = buttons(1);
  const overlay = makeElement("div");
  const agent = loadAgent(body, { elementFromPoint: () => overlay });
  await agent.call("snapshot", {});
  const refused = await agent.call("actPrepare", { action: "click", ref: "e1" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "local_browser_element_missing");
  assert.match(refused.error.message, /covers this target, so a real click would hit div/);
  const forced = await agent.call("actPrepare", { action: "click", ref: "e1", force: true });
  assert.equal(forced.ok, true, JSON.stringify(forced.error || {}));
  assert.equal(forced.result.covered, true);
});

test("actPrepare refuses type on a button and focuses the target of a press", async () => {
  const body = buttons(1);
  const [button] = body.children;
  let focused = 0;
  button.focus = () => {
    focused += 1;
  };
  const agent = loadAgent(body, { elementFromPoint: () => button });
  await agent.call("snapshot", {});
  const typed = await agent.call("actPrepare", { action: "type", ref: "e1", text: "x" });
  assert.equal(typed.ok, false);
  assert.match(typed.error.message, /type needs an input/);
  const pressed = await agent.call("actPrepare", { action: "press", ref: "e1", key: "Enter" });
  assert.equal(pressed.ok, true, JSON.stringify(pressed.error || {}));
  assert.equal(focused, 1);
  assert.equal("x" in pressed.result, false);
});

test("actSettle compares against the signature taken before the trusted input", async () => {
  const agent = loadAgent(buttons(1));
  const response = await agent.call("actSettle", { before: { url: "https://example.test/before", title: "Fixture", elements: 1 }, timeoutMs: 50 });
  assert.equal(response.ok, true);
  assert.equal(response.result.changed, true);
  assert.equal(response.result.url, "https://example.test/page");
});
