import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const contentScripts = manifest.content_scripts[0].js;

function readContentFilesFromBackground() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ["lib/protocol.js", "background/core.js"]) {
    new vm.Script(readFileSync(join(root, file), "utf8"), { filename: file }).runInContext(sandbox);
  }
  return JSON.parse(JSON.stringify(sandbox.LB.bg.core.CONTENT_FILES));
}

function fakeElement(tag, options = {}) {
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    isConnected: true,
    id: options.id || "",
    attributes: options.attributes || {},
    children: [],
    childNodes: [],
    style: { display: "block", visibility: "visible", opacity: "1", overflowX: "visible", overflowY: "visible" },
    rect: options.rect || { left: 10, top: 10, width: 100, height: 30 },
    parentElement: null,
    parentNode: null,
    innerText: options.innerText || "",
    textContent: options.innerText || "",
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    getBoundingClientRect() {
      const rect = this.rect;
      return { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
    },
    scrollIntoView() {
      return undefined;
    },
    closest() {
      return null;
    },
    contains(other) {
      let node = other;
      while (node) {
        if (node === this) return true;
        node = node.parentNode;
      }
      return false;
    },
    dispatchEvent() {
      return true;
    },
    focus() {
      return undefined;
    },
  };
  for (const child of options.children || []) {
    child.parentElement = element;
    child.parentNode = element;
    element.children.push(child);
    element.childNodes.push(child);
  }
  return element;
}

function createPageContext(overrides = {}) {
  const listeners = [];
  const sent = [];
  const observers = [];
  const documentElement = { nodeType: 1 };
  const body = fakeElement("body");
  function findIn(root, selector) {
    if (!root) return null;
    if (selector.startsWith("#") && root.id === selector.slice(1)) return root;
    if (!selector.startsWith("#") && root.tagName && root.tagName.toLowerCase() === selector) return root;
    for (const child of root.children || []) {
      const hit = findIn(child, selector);
      if (hit) return hit;
    }
    return null;
  }

  const document = {
    readyState: "complete",
    title: "Fixture",
    documentElement,
    body,
    activeElement: null,
    getElementById: () => null,
    querySelector: (selector) => findIn(document.body, selector),
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    elementFromPoint: () => null,
    ...overrides,
  };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    URL,
    atob,
    btoa,
    document,
    location: { href: "https://fixture.test/" },
    getComputedStyle: (element) => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      overflowX: "visible",
      overflowY: "visible",
      pointerEvents: "auto",
      ...((element && element.style) || {}),
    }),
    MouseEvent: class {
      constructor(type, init) {
        Object.assign(this, { type, defaultPrevented: false }, init || {});
      }
    },
    PointerEvent: class {
      constructor(type, init) {
        Object.assign(this, { type, defaultPrevented: false }, init || {});
      }
    },
    KeyboardEvent: class {
      constructor(type, init) {
        Object.assign(this, { type, defaultPrevented: false }, init || {});
      }
    },
    InputEvent: class {
      constructor(type, init) {
        Object.assign(this, { type, defaultPrevented: false }, init || {});
      }
    },
    Event: class {
      constructor(type, init) {
        Object.assign(this, { type, defaultPrevented: false }, init || {});
      }
    },
    WheelEvent: class {
      constructor(type, init) {
        Object.assign(this, { type, defaultPrevented: false }, init || {});
      }
    },
    HTMLInputElement: { prototype: { value: "" } },
    HTMLTextAreaElement: { prototype: { value: "" } },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
    chrome: {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: (fn) => listeners.push(fn) },
        sendMessage: (message, callback) => {
          sent.push(message);
          if (typeof callback === "function") callback({ tabId: 7, frameId: 0 });
        },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return { sandbox, listeners, sent, observers };
}

function loadPageScripts(files, overrides = {}) {
  const context = createPageContext(overrides);
  vm.createContext(context.sandbox);
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    vm.runInContext(source, context.sandbox, { filename: file });
  }
  return context;
}

function callRpc(context, op, args, tabId = 7) {
  const listener = context.listeners[0];
  return new Promise((resolve) => {
    const returned = listener({ type: "lb:rpc", op, args, tabId }, { tab: { id: tabId }, frameId: 0 }, resolve);
    if (returned !== true) resolve({ ignored: true });
  });
}

test("the manifest loads lib/protocol.js before content.js", () => {
  const protocolAt = contentScripts.indexOf("lib/protocol.js");
  const contentAt = contentScripts.indexOf("content.js");
  assert.notEqual(protocolAt, -1, "lib/protocol.js must be in content_scripts.js");
  assert.notEqual(contentAt, -1, "content.js must be in content_scripts.js");
  assert.ok(protocolAt < contentAt, "lib/protocol.js must load before content.js");
});

test("the background injects exactly the manifest's content scripts", () => {
  const injected = readContentFilesFromBackground();
  assert.deepEqual(injected, contentScripts);
  assert.ok(injected.indexOf("lib/protocol.js") < injected.indexOf("content.js"));
});

test("loading the manifest's scripts registers the page listener", () => {
  const context = loadPageScripts(contentScripts);
  assert.equal(context.listeners.length, 1, "content.js must register exactly one onMessage listener");
  assert.equal(typeof context.sandbox.LB.protocol.ERROR_CODES.refStale, "string");
  assert.equal(typeof context.sandbox.LB.snapshot.buildSnapshot, "function");
  assert.equal(typeof context.sandbox.LB.markdown.renderMarkdown, "function");
  assert.equal(typeof context.sandbox.LB.documentState.read, "function");
  assert.equal(context.observers.length, 1, "content.js must install one MutationObserver");
  assert.equal(context.sent[0].type, "lb:frame-ready");
});

test("the registered listener answers a snapshot RPC", async () => {
  const context = loadPageScripts(contentScripts);
  const listener = context.listeners[0];
  const response = await new Promise((resolve) => {
    const returned = listener(
      { type: "lb:rpc", op: "snapshot", args: {}, tabId: 7 },
      { tab: { id: 7 }, frameId: 0 },
      resolve,
    );
    if (returned !== true) resolve({ sync: true });
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.title, "Fixture");
  assert.equal(response.result.url, "https://fixture.test/");
  assert.equal(response.result.nodes.length, 0);
  assert.equal(response.result.truncated, false);
  assert.equal(typeof response.result.document.documentId, "string", "a snapshot carries the document state");
});

test("the content scripts follow the shared load order", () => {
  const shared = ["lib/text.js", "lib/refmap.js", "lib/cursor.js", "lib/snapshot.js", "lib/markdown.js", "lib/dom-adapter.js", "lib/document-state.js"];
  const positions = shared.map((file) => contentScripts.indexOf(file));
  assert.equal(positions.includes(-1), false, "every shared content module must load");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "shared content modules keep their order");
  assert.equal(contentScripts[contentScripts.length - 1], "content.js");
});

test("the documentState op answers the shared document state", async () => {
  const context = loadPageScripts(contentScripts);
  const response = await callRpc(context, "documentState", {});
  assert.equal(response.ok, true);
  assert.equal(response.result.url, "https://fixture.test/");
  assert.equal(response.result.readyState, "complete");
  assert.equal(response.result.stale, false);
  assert.deepEqual([...response.result.staleReasons], []);
});

test("read honours a maxChars far above the old 40000 clamp", async () => {
  const long = "x".repeat(60000);
  const body = fakeElement("body", { innerText: long });
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = body;
  context.sandbox.LB.markdown.toText = () => ({ text: long });
  const capped = await callRpc(context, "read", { maxChars: 50000 });
  assert.equal(capped.ok, true);
  assert.equal(capped.result.text.length, 50000);
  assert.equal(capped.result.truncated, true);
  assert.equal(typeof capped.result.document.documentId, "string", "a read carries the document state");
  const whole = await callRpc(context, "read", { maxChars: 2000000 });
  assert.equal(whole.result.text.length, 60000);
  assert.equal(whole.result.truncated, false);
});

test("a wait result carries the document state", async () => {
  const context = loadPageScripts(contentScripts);
  const response = await callRpc(context, "wait", { urlIncludes: "fixture", timeoutMs: 500 });
  assert.equal(response.ok, true);
  assert.equal(response.result.matched, true);
  assert.equal(typeof response.result.document.documentId, "string");
});

function buttonPage(count) {
  const buttons = [];
  for (let index = 1; index <= count; index += 1) {
    buttons.push(fakeElement("button", { attributes: { "aria-label": "Button " + index }, innerText: "Button " + index }));
  }
  return { body: fakeElement("body", { children: buttons }), buttons };
}

function pageWithBody(page) {
  return {
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", overflowX: "visible", overflowY: "visible" }),
    documentOverrides: { body: page.body },
  };
}

test("a decimal cursor continues exactly at that offset through the RPC seam", async () => {
  const page = buttonPage(30);
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = page.body;

  const first = await callRpc(context, "snapshot", { maxNodes: 10 });
  assert.equal(first.ok, true);
  assert.equal(first.result.nodes.length, 10);
  assert.equal(first.result.nodes[0].name, "Button 1");
  assert.equal(first.result.truncated, true);
  assert.equal(first.result.cursor, "10");

  const second = await callRpc(context, "snapshot", { maxNodes: 10, cursor: first.result.cursor });
  assert.equal(second.ok, true);
  assert.equal(second.result.offset, 10);
  assert.equal(second.result.nodes[0].name, "Button 11");
  assert.equal(second.result.nodes[0].ref, "e11");
  assert.equal(second.result.cursor, "20");

  const third = await callRpc(context, "snapshot", { maxNodes: 10, cursor: second.result.cursor });
  assert.equal(third.result.nodes[0].name, "Button 21");
  assert.equal(third.result.truncated, false);
  assert.equal(third.result.cursor, undefined);

  const names = [...first.result.nodes, ...second.result.nodes, ...third.result.nodes].map((node) => node.name);
  assert.equal(names.length, 30);
  assert.equal(new Set(names).size, 30);
});

test("the cursor is a decimal string the shared schema accepts", async () => {
  const page = buttonPage(30);
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = page.body;
  const first = await callRpc(context, "snapshot", { maxNodes: 10 });
  assert.match(first.result.cursor, /^\d+$/);
  assert.equal(first.result.cursor, "10");
  assert.equal(first.result.nodes.length, 10);
});

test("a fresh snapshot after a DOM change restarts refs at e1", async () => {
  const page = buttonPage(3);
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = page.body;

  const refsOf = (response) => response.result.nodes.filter((node) => node.ref).map((node) => node.ref).join(",");
  const namesOf = (response) => response.result.nodes.filter((node) => node.ref).map((node) => node.name).join(",");

  const before = await callRpc(context, "snapshot", { maxNodes: 20 });
  assert.equal(refsOf(before), "e1,e2,e3");
  assert.equal(namesOf(before), "Button 1,Button 2,Button 3");

  page.body.children.splice(1, 1);
  page.body.childNodes.splice(1, 1);

  const after = await callRpc(context, "snapshot", { maxNodes: 20 });
  assert.equal(refsOf(after), "e1,e2");
  assert.equal(namesOf(after), "Button 1,Button 3");
});

test("an unparseable cursor is ignored and refs restart", async () => {
  const page = buttonPage(5);
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = page.body;
  const result = await callRpc(context, "snapshot", { maxNodes: 10, cursor: "not-a-cursor" });
  assert.equal(result.ok, true);
  assert.equal(result.result.offset, 0);
  assert.equal(result.result.nodes[0].ref, "e1");
  assert.equal(result.result.cursorIgnored, true);
});

test("a click on an element covered by another is refused before any event fires", async () => {
  const target = fakeElement("button", { attributes: { "aria-label": "Pay" }, innerText: "Pay" });
  const overlay = fakeElement("div", { attributes: { "aria-label": "Overlay" } });
  const body = fakeElement("body", { children: [target, overlay] });
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => overlay });
  context.sandbox.document.body = body;

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_element_missing");
  assert.match(result.error.message, /covers this target/);
});

test("force skips the covered-target refusal and clicks anyway", async () => {
  const target = fakeElement("button", { attributes: { "aria-label": "Pay" }, innerText: "Pay" });
  const overlay = fakeElement("div", { attributes: { "aria-label": "Overlay" } });
  const body = fakeElement("body", { children: [target, overlay] });
  let clicks = 0;
  target.click = () => {
    clicks += 1;
  };
  target.dispatchEvent = () => {
    clicks += 1;
    return true;
  };
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => overlay });
  context.sandbox.document.body = body;

  const result = await callRpc(context, "act", { action: "click", selector: "button", force: true });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.ok, true);
  assert.ok(clicks > 0, "the click must reach the covered target");
});

test("a click passes the hit test when the point lands on the target or its child", async () => {
  const child = fakeElement("span", { innerText: "Pay" });
  const target = fakeElement("button", { attributes: { "aria-label": "Pay" }, children: [child] });
  const body = fakeElement("body", { children: [target] });
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => child });
  context.sandbox.document.body = body;

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, true);
  assert.equal(result.result.ok, true);
});

test("typing into a covered field is refused too", async () => {
  const field = fakeElement("input", { attributes: { type: "text" } });
  const overlay = fakeElement("div");
  const body = fakeElement("body", { children: [field, overlay] });
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => overlay });
  context.sandbox.document.body = body;

  const result = await callRpc(context, "act", { action: "type", selector: "input", text: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_element_missing");
});

test("actPrepare returns the rounded centre of a reachable target and the change baseline", async () => {
  const target = fakeElement("button", { attributes: { "aria-label": "Pay" }, innerText: "Pay", rect: { left: 10, top: 10, width: 101, height: 31 } });
  const body = fakeElement("body", { children: [target] });
  let clicks = 0;
  target.dispatchEvent = () => {
    clicks += 1;
    return true;
  };
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => target });
  context.sandbox.document.body = body;

  const result = await callRpc(context, "actPrepare", { action: "click", selector: "button" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.x, 61);
  assert.equal(result.result.y, 26);
  assert.equal(result.result.covered, false);
  assert.equal(typeof result.result.mutations, "number");
  assert.equal(typeof result.result.url, "string");
  assert.equal(clicks, 0, "prepare never fires page events");
});

test("actPrepare refuses a covered target unless force, then marks it covered", async () => {
  const target = fakeElement("button", { attributes: { "aria-label": "Pay" }, innerText: "Pay" });
  const overlay = fakeElement("div", { attributes: { "aria-label": "Overlay" } });
  const body = fakeElement("body", { children: [target, overlay] });
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => overlay });
  context.sandbox.document.body = body;

  const refused = await callRpc(context, "actPrepare", { action: "click", selector: "button" });
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /covers this target/);
  const forced = await callRpc(context, "actPrepare", { action: "click", selector: "button", force: true });
  assert.equal(forced.ok, true, JSON.stringify(forced.error || {}));
  assert.equal(forced.result.covered, true);
});

test("actPrepare refuses type on an element that cannot take text and reports checked boxes as done", async () => {
  const button = fakeElement("button", { attributes: { "aria-label": "Pay" }, innerText: "Pay" });
  const box = fakeElement("input", { attributes: { type: "checkbox" } });
  box.checked = true;
  const body = fakeElement("body", { children: [button, box] });
  const context = loadPageScripts(contentScripts, { elementFromPoint: (x, y) => (y > 0 ? box : button) });
  context.sandbox.document.body = body;

  const typed = await callRpc(context, "actPrepare", { action: "type", selector: "button", text: "x" });
  assert.equal(typed.ok, false);
  assert.equal(typed.error.code, "local_browser_unsupported");
  const checked = await callRpc(context, "actPrepare", { action: "check", selector: "input" });
  assert.equal(checked.ok, true, JSON.stringify(checked.error || {}));
  assert.equal(checked.result.done, true);
});

test("actSettle reports a url change after the trusted input", async () => {
  const body = fakeElement("body");
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = body;
  const result = await callRpc(context, "actSettle", { url: "https://before.test/", mutations: 0 });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.changed, true);
});

function scrollablePage() {
  const scroller = fakeElement("div", { attributes: { "aria-label": "Results" } });
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
  scroller.style.overflowY = "auto";
  scroller.scrollHeight = 2000;
  scroller.clientHeight = 400;
  scroller.scrollWidth = 400;
  scroller.clientWidth = 400;
  scroller.scrollBy = function (options) {
    this.scrollTop += options.top || 0;
    this.scrollLeft += options.left || 0;
  };
  const target = fakeElement("button", { attributes: { "aria-label": "Row 30" }, innerText: "Row 30" });
  target.parentElement = scroller;
  target.parentNode = scroller;
  scroller.children.push(target);
  const body = fakeElement("body", { children: [scroller] });
  return { body, scroller, target };
}

test("scroll moves the target's own scroll container, not the window", async () => {
  const page = scrollablePage();
  let windowScrolls = 0;
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = page.body;
  context.sandbox.scrollBy = () => {
    windowScrolls += 1;
  };

  const result = await callRpc(context, "act", { action: "scroll", selector: "button", deltaY: 300 });
  assert.equal(result.ok, true);
  assert.equal(page.scroller.scrollTop, 300);
  assert.equal(windowScrolls, 0);
});

test("scroll falls back to the window when no ancestor scrolls", async () => {
  const button = fakeElement("button", { attributes: { "aria-label": "Plain" }, innerText: "Plain" });
  const body = fakeElement("body", { children: [button] });
  let windowScrolls = 0;
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = body;
  context.sandbox.scrollBy = (options) => {
    windowScrolls += options.top || 0;
  };

  const result = await callRpc(context, "act", { action: "scroll", selector: "button", deltaY: 120 });
  assert.equal(result.ok, true);
  assert.equal(windowScrolls, 120);
});

test("refs are invalidated when the document URL changes without a reload", async () => {
  const page = buttonPage(3);
  const context = loadPageScripts(contentScripts);
  context.sandbox.document.body = page.body;

  const first = await callRpc(context, "snapshot", { maxNodes: 20 });
  const firstRef = first.result.nodes.filter((node) => node.ref)[0].ref;

  context.sandbox.location.href = "https://fixture.test/other-route";
  const afterRoute = await callRpc(context, "act", { action: "click", ref: firstRef });
  assert.equal(afterRoute.ok, false);
  assert.equal(afterRoute.error.code, "local_browser_ref_stale");

  const second = await callRpc(context, "snapshot", { maxNodes: 20 });
  assert.equal(second.result.nodes.filter((node) => node.ref)[0].ref, "e1");
});

function belowFoldPage(top) {
  const button = fakeElement("button", { attributes: { "aria-label": "Deep" }, innerText: "Deep" });
  button.rect = { left: 100, top: top, width: 120, height: 40 };
  const body = fakeElement("body", { children: [button] });
  return { body, button };
}

test("a target below the fold is scrolled into view and then clicked", async () => {
  const page = belowFoldPage(2000);
  let scrollY = 0;
  let handlerFired = 0;
  const context = loadPageScripts(contentScripts, {
    elementFromPoint: (x, y) => {
      const top = page.button.rect.top;
      if (y < 0 || y > 600) return null;
      return y >= top && y <= top + 40 && x >= 100 && x <= 220 ? page.button : null;
    },
  });
  context.sandbox.document.body = page.body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;
  page.button.scrollIntoView = () => {
    scrollY = page.button.rect.top - 280;
    page.button.rect = { left: 100, top: 280, width: 120, height: 40 };
  };
  page.button.click = () => {
    handlerFired += 1;
  };

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.ok, true);
  assert.ok(scrollY > 0, "the page must scroll before the hit test");
  assert.equal(handlerFired, 1, "the click handler must fire");
});

test("a target below the fold accepts typing instead of being refused", async () => {
  const input = fakeElement("input", { attributes: { type: "text" } });
  input.rect = { left: 100, top: 1600, width: 200, height: 30 };
  const body = fakeElement("body", { children: [input] });
  let scrollY = 0;
  const context = loadPageScripts(contentScripts, {
    elementFromPoint: (x, y) => {
      const top = input.rect.top;
      if (y < 0 || y > 600) return null;
      return y >= top && y <= top + 30 ? input : null;
    },
  });
  context.sandbox.document.body = body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;
  input.scrollIntoView = () => {
    scrollY = input.rect.top - 280;
    input.rect = { left: 100, top: 280, width: 200, height: 30 };
  };

  const result = await callRpc(context, "act", { action: "type", selector: "input", text: "hello" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.ok(scrollY > 0);
});

test("a fixed banner covering the target is still refused after scrolling", async () => {
  const button = fakeElement("button", { attributes: { "aria-label": "Under banner" }, innerText: "Under banner" });
  button.rect = { left: 100, top: 20, width: 120, height: 40 };
  const banner = fakeElement("div", { attributes: { "aria-label": "Banner" } });
  const body = fakeElement("body", { children: [button, banner] });
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => banner });
  context.sandbox.document.body = body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_element_missing");
  assert.match(result.error.message, /covers this target/);
});

function drawerPage(left) {
  const button = fakeElement("button", { attributes: { "aria-label": "In drawer" }, innerText: "In drawer" });
  button.rect = { left: left, top: 100, width: 200, height: 40 };
  const drawer = fakeElement("div", { attributes: { "aria-label": "Drawer" }, children: [button] });
  drawer.rect = { left: left, top: 0, width: 400, height: 600 };
  const body = fakeElement("body", { children: [drawer] });
  return { body, button, drawer };
}

test("a target parked outside the visible page area is refused, not silently clicked", async () => {
  const page = drawerPage(-4000);
  let handlerFired = 0;
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => null });
  context.sandbox.document.body = page.body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;
  page.button.scrollIntoView = () => {
    return undefined;
  };
  page.button.click = () => {
    handlerFired += 1;
  };

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, false, "an unreachable off-canvas target must be refused");
  assert.equal(result.error.code, "local_browser_element_missing");
  assert.match(result.error.message, /outside the visible page area/);
  assert.match(String(result.error.hint), /scroll|snapshot/i);
  assert.equal(handlerFired, 0, "no synthetic click may fire on an unreachable target");
});

test("an off-canvas target that becomes reachable after scrolling still works", async () => {
  const page = drawerPage(-4000);
  let scrollX = 0;
  const context = loadPageScripts(contentScripts, {
    elementFromPoint: (x, y) => (scrollX > 0 && y >= 100 && y <= 140 && x >= 100 && x <= 300 ? page.button : null),
  });
  context.sandbox.document.body = page.body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;
  page.button.scrollIntoView = () => {
    scrollX = 4000;
    page.button.rect = { left: 100, top: 100, width: 200, height: 40 };
  };

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
});

function scrollListenerPage(top) {
  const button = fakeElement("button", { attributes: { "aria-label": "Plain" }, innerText: "Plain" });
  button.rect = { left: 100, top: top, width: 120, height: 40 };
  const body = fakeElement("body", { children: [button] });
  return { body, button };
}

test("a scroll listener mutating the DOM does not make a click look like it changed the page", async () => {
  const page = scrollListenerPage(2000);
  const context = loadPageScripts(contentScripts, {
    elementFromPoint: () => page.button,
  });
  context.sandbox.document.body = page.body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;

  let marker = 0;
  page.button.scrollIntoView = () => {
    marker += 1;
    page.body.children.push(fakeElement("div", { attributes: { "aria-label": "back-to-top" } }));
    const observerCallback = context.observers[0].callback;
    observerCallback([{ type: "childList" }]);
  };

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(marker, 1, "the scroll must actually have run");
  assert.equal(
    result.result.changed,
    false,
    "DOM churn from the scroll itself must not be reported as the action changing the page",
  );
});

test("a click that really mutates the page still reports changed", async () => {
  const page = scrollListenerPage(100);
  const context = loadPageScripts(contentScripts, { elementFromPoint: () => page.button });
  context.sandbox.document.body = page.body;
  context.sandbox.innerWidth = 800;
  context.sandbox.innerHeight = 600;

  page.button.click = () => {
    const observerCallback = context.observers[0].callback;
    observerCallback([{ type: "childList" }]);
  };

  const result = await callRpc(context, "act", { action: "click", selector: "button" });
  assert.equal(result.ok, true);
  assert.equal(result.result.changed, true, "a real mutation caused by the click must be reported");
});

test("the registered listener refuses RPCs addressed to another tab", async () => {
  const context = loadPageScripts(contentScripts);
  const listener = context.listeners[0];
  const outcome = await new Promise((resolve) => {
    const returned = listener({ type: "lb:rpc", op: "snapshot", args: {}, tabId: 99 }, { tab: { id: 7 } }, () =>
      resolve("answered"),
    );
    if (returned !== true) resolve("ignored");
  });
  assert.equal(outcome, "ignored");
});
