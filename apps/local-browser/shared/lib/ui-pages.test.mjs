import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFakeApi, flush, loadShared, sharedDir } from "./test-ext.mjs";

const PAGES = ["popup", "control"];
const LOAD_ORDER = ["lib/contract.js", "lib/ext-api.js", "lib/pairing.js", "lib/access.js", "lib/ui-state.js"];

function read(file) {
  return readFileSync(path.join(sharedDir, file), "utf8");
}

class FakeElement {
  constructor(document, tag, attrs = {}) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.textContent = "";
    this.hidden = "hidden" in attrs;
    this.disabled = false;
    this.value = "";
    this.checked = false;
    this.type = attrs.type || "";
    this.name = "";
    this.className = attrs.class || "";
  }
  get id() {
    return this.attrs.id;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  dispatch(name, target = this) {
    const event = { type: name, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    let node = target;
    while (node) {
      for (const fn of node.listeners?.[name] || []) fn(event);
      node = node.parent;
    }
    return event;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  matches(selector) {
    const match = /^(\w+)?(?:\[([\w-]+)(?:=([\w-]+))?\])?$/.exec(selector);
    if (!match) return false;
    if (match[1] && this.tagName !== match[1].toUpperCase()) return false;
    if (match[2] === "type") return this.type === match[3];
    if (match[2]) return this.getAttribute(match[2]) !== null;
    return true;
  }
  closest(selector) {
    let node = this;
    while (node && node instanceof FakeElement) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector));
  }
  click() {
    this.dispatch("click");
  }
}

function createDocument(html) {
  const document = {
    elements: [],
    createElement(tag) {
      return new FakeElement(document, tag);
    },
    getElementById(id) {
      return document.elements.find((node) => node.id === id) || null;
    },
    querySelectorAll(selector) {
      return document.elements.filter((node) => node.matches(selector));
    },
  };
  for (const match of html.matchAll(/<(\w+)\s([^>]*)>/g)) {
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = attr[2] ?? "";
    if (attrs.id || attrs["data-section"] || attrs["data-nav"]) document.elements.push(new FakeElement(document, match[1], attrs));
  }
  return document;
}

const connectedStatus = {
  client: "chromium",
  version: "1.1.0",
  state: "connected",
  label: "Laptop",
  origin: "https://paperclip.test",
  sessionId: "abcdef123456",
  tier: "full",
  allowedOrigins: [],
  tabs: [],
  guards: { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 },
  trustedInput: { mode: "synthetic", command: "firefox --remote-debugging-port 9222" },
};

async function openPage(page, { client = "chromium", hash = "", status = connectedStatus, storage = {} } = {}) {
  const sent = [];
  const fake = createFakeApi({
    client,
    storage,
    onMessage(message) {
      sent.push(message);
      if (message.op === "status") return { ok: true, status };
      if (message.op === "detect") return { ok: true, detected: null };
      return { ok: true, status };
    },
  });
  const document = createDocument(read("ui/" + page + ".html"));
  const windowListeners = {};
  const globals = {
    document,
    location: { hash },
    navigator: { clipboard: { writeText: async () => undefined } },
    window: { close() {}, addEventListener: (name, fn) => ((windowListeners[name] ||= []).push(fn)) },
  };
  const files = LOAD_ORDER.concat("ui/" + page + ".js");
  const sandbox = loadShared(files, { api: fake.api, client, globals });
  await flush(10);
  return { fake, document, sent, sandbox, windowListeners, byId: (id) => document.getElementById(id) };
}

for (const page of PAGES) {
  test(page + " asks for every permission inside the click, before any await", async () => {
    const { fake, byId } = await openPage(page, { client: "firefox" });
    byId("allow-all").click();
    const calls = fake.callsOf("permissions.request");
    assert.equal(calls.length, 1);
    assert.deepEqual([...calls[0][1].origins], ["<all_urls>"]);
    assert.ok(calls[0][1].permissions.includes("webRequestBlocking"));
    await flush(10);
  });
}

test("popup renders the connection and pending requests with Allow buttons", async () => {
  const at = Date.now();
  const { byId, fake } = await openPage("popup", { storage: { "lb.pending": [{ permission: "cookies", reason: "read cookies", tool: "local_browser_storage", at }] } });
  assert.equal(byId("state").textContent, "Connected");
  assert.equal(byId("pending-section").hidden, false);
  const allow = byId("pending-list").descendants().find((node) => node.getAttribute("data-permission") === "cookies");
  assert.ok(allow);
  allow.click();
  const calls = fake.callsOf("permissions.request");
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0][1].permissions], ["cookies"]);
  await flush(10);
  assert.equal(byId("pending-section").hidden, true);
});

test("popup hides the pair form once connected and shows it when unpaired", async () => {
  assert.equal((await openPage("popup")).byId("pair-form").hidden, true);
  assert.equal((await openPage("popup", { status: { state: "unpaired", client: "chromium" } })).byId("pair-form").hidden, false);
});

test("popup pairs through the lb-control channel", async () => {
  const { byId, sent } = await openPage("popup", { status: { state: "unpaired", client: "chromium" } });
  byId("pair-input").value = "https://paperclip.test/api/local-browser/bridge?code=F6BX2X8R";
  byId("pair-form").dispatch("submit");
  await flush();
  const pair = sent.find((message) => message.op === "pair");
  assert.equal(pair.channel, "lb-control");
  assert.equal(pair.input, "https://paperclip.test/api/local-browser/bridge?code=F6BX2X8R");
});

test("popup refuses junk pairing input locally", async () => {
  const { byId, sent } = await openPage("popup", { status: { state: "unpaired", client: "chromium" } });
  byId("pair-input").value = "ftp://paperclip.test";
  byId("pair-form").dispatch("submit");
  await flush();
  assert.equal(sent.some((message) => message.op === "pair"), false);
  assert.equal(byId("pair-error").hidden, false);
});

test("control center shows the section from the hash and follows hash changes", async () => {
  const opened = await openPage("control", { hash: "#permissions" });
  const visible = () => opened.document.querySelectorAll("[data-section]").filter((node) => !node.hidden).map((node) => node.getAttribute("data-section"));
  assert.deepEqual(visible(), ["permissions"]);
  opened.sandbox.location.hash = "#guards";
  for (const fn of opened.windowListeners.hashchange) fn();
  assert.deepEqual(visible(), ["guards"]);
  const current = opened.document.querySelectorAll("[data-nav]").filter((node) => node.getAttribute("aria-current") === "page");
  assert.deepEqual(current.map((node) => node.getAttribute("data-nav")), ["guards"]);
});

test("control center lists every catalog entry with Allow and Revoke", async () => {
  const { byId, fake, sandbox } = await openPage("control", { hash: "#permissions" });
  const items = byId("permission-list").children;
  const expected = sandbox.LB.contract.permissions.filter((entry) => entry.chromium !== "unsupported").length;
  assert.equal(items.length, expected);
  const allow = byId("permission-list").descendants().find((node) => node.getAttribute("data-allow") === "history");
  allow.click();
  assert.deepEqual([...fake.callsOf("permissions.request")[0][1].permissions], ["history"]);
  await flush(10);
  const revoke = byId("permission-list").descendants().find((node) => node.getAttribute("data-revoke") === "history");
  assert.ok(revoke, "a granted optional permission offers Revoke");
  revoke.click();
  await flush(10);
  assert.deepEqual([...fake.callsOf("permissions.remove")[0][1].permissions], ["history"]);
  assert.equal(byId("permission-list").descendants().some((node) => node.getAttribute("data-revoke") === "debugger"), false);
});

test("control center dismisses pending requests through pending.clear", async () => {
  const { byId, sent } = await openPage("control", { hash: "#permissions", storage: { "lb.pending": [{ permission: "cookies", reason: "r", at: Date.now() }] } });
  assert.equal(byId("pending-panel").hidden, false);
  assert.equal(byId("nav-badge").textContent, "1");
  const dismiss = byId("pending-list").descendants().find((node) => node.getAttribute("data-dismiss") === "cookies");
  dismiss.click();
  await flush();
  const clear = sent.find((message) => message.op === "pending.clear");
  assert.deepEqual([...clear.permissions], ["cookies"]);
  byId("dismiss-all").click();
  await flush();
  assert.equal(sent.filter((message) => message.op === "pending.clear").at(-1).permissions, undefined);
});

test("control center saves guards with a patch", async () => {
  const { byId, sent } = await openPage("control", { hash: "#guards" });
  const boxes = byId("guard-toggles").querySelectorAll("input[type=checkbox]");
  assert.equal(boxes.length, 2);
  boxes[1].checked = false;
  byId("buffer-size").value = "5000";
  byId("guards-form").dispatch("submit");
  await flush();
  const set = sent.find((message) => message.op === "guards.set");
  assert.deepEqual(JSON.parse(JSON.stringify(set.patch)), { protectPaperclipTab: true, protectFocusedTab: false, networkBufferSize: 5000 });
});

test("control center offers the Firefox command and port only where they apply", async () => {
  const firefox = await openPage("control", { client: "firefox", hash: "#input", status: { ...connectedStatus, client: "firefox" } });
  assert.equal(firefox.byId("command-panel").hidden, false);
  assert.equal(firefox.byId("port-form").hidden, false);
  firefox.byId("bidi-port").value = "9333";
  firefox.byId("port-form").dispatch("submit");
  await flush();
  assert.equal(firefox.sent.find((message) => message.op === "bidi.set").port, 9333);
  const chromium = await openPage("control", { hash: "#input", status: { ...connectedStatus, trustedInput: { mode: "cdp" } } });
  assert.equal(chromium.byId("command-panel").hidden, true);
  assert.equal(chromium.byId("port-form").hidden, true);
});

test("pages re-render on lb-status broadcasts", async () => {
  const { byId, fake } = await openPage("control");
  fake.api.runtime.onMessage.fire({ channel: "lb-status", status: { ...connectedStatus, state: "disconnected", lastError: "socket closed" } });
  assert.equal(byId("pill-text").textContent, "Disconnected");
  assert.equal(byId("detail").textContent, "socket closed");
});
