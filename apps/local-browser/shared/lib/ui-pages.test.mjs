import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFakeApi, flush, loadShared, sharedDir } from "./test-ext.mjs";

const PAGES = ["popup", "control"];

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
  trustedInput: { mode: "cdp" },
};

function pageScripts(page) {
  return [...read("ui/" + page + ".html").matchAll(/<script src="([^"]+)"/g)].map((match) => (match[1].startsWith("../") ? match[1].slice(3) : "ui/" + match[1]));
}

async function openPage(page, { client = "chromium", hash = "", status = connectedStatus, storage = {}, browserInfo, platformInfo, answers = {} } = {}) {
  const sent = [];
  const copied = [];
  const fake = createFakeApi({
    client,
    storage,
    browserInfo,
    platformInfo,
    onMessage(message) {
      sent.push(message);
      if (answers[message.op]) return answers[message.op](message);
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
    navigator: { clipboard: { writeText: async (value) => void copied.push(value) } },
    window: { close() {}, addEventListener: (name, fn) => ((windowListeners[name] ||= []).push(fn)) },
  };
  const files = pageScripts(page);
  const sandbox = loadShared(files, { api: fake.api, client, globals });
  await flush(10);
  return { fake, document, sent, copied, sandbox, windowListeners, byId: (id) => document.getElementById(id) };
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

const firefoxInput = {
  mode: "synthetic",
  port: 9333,
  origin: "moz-extension://ext-id",
  reason: "not_running",
  checkedAt: Date.now(),
};

function openFirefoxInput(extra = {}) {
  return openPage("control", {
    client: "firefox",
    hash: "#input",
    status: { ...connectedStatus, client: "firefox", trustedInput: firefoxInput },
    browserInfo: { name: "Zen", vendor: "Zen", version: "1.17b" },
    platformInfo: { os: "win" },
    ...extra,
  });
}

const ZEN_WINDOWS = '& "C:\\Program Files\\Zen Browser\\zen.exe" --remote-debugging-port 9333 --remote-allow-origins moz-extension://ext-id';

test("Firefox input section prefills the port, detects the browser and shows the reason", async () => {
  const { byId } = await openFirefoxInput();
  assert.equal(byId("bidi-port").value, "9333");
  assert.equal(byId("port-form").hidden, false);
  assert.equal(byId("input-title-line").textContent, "Not active");
  assert.match(byId("input-detail").textContent, /not started with remote debugging/);
  assert.equal(byId("input-checked").textContent, "Last checked just now.");
  assert.equal(byId("input-check-row").hidden, false);
  assert.equal(byId("input-status").getAttribute("data-tone"), "warn");
  assert.equal(byId("input-setup").hidden, false);
  assert.equal(byId("input-setup").open, true);
  assert.equal(byId("setup-os").value, "windows");
  assert.equal(byId("setup-browser").value, "zen");
  assert.equal(byId("setup-install").value, "default");
  assert.match(byId("setup-detected").textContent, /Detected Zen on Windows/);
  assert.equal(byId("command").textContent, ZEN_WINDOWS);
  assert.equal(byId("command-label").textContent, "In PowerShell:");
  assert.equal(byId("alt-panel").hidden, false);
  assert.equal(byId("alt-command").textContent, ZEN_WINDOWS.slice(2));
  assert.equal(byId("quit-steps").children.length, 2);
  assert.ok(byId("setup-notes").children.length >= 5);
  assert.equal(byId("permanent").hidden, false);
  assert.equal(byId("setup-browser").children.length, 8);
  assert.deepEqual(byId("setup-install").children.map((node) => node.value), ["default", "custom"]);
});

test("changing the setup fields regenerates the command", async () => {
  const { byId } = await openFirefoxInput();
  const change = (id, value, kind = "change") => {
    byId(id).value = value;
    byId(id).dispatch(kind);
  };
  change("setup-os", "linux");
  assert.equal(byId("setup-install").value, "default");
  assert.deepEqual(byId("setup-install").children.map((node) => node.value), ["default", "flatpak", "custom"]);
  assert.equal(byId("command").textContent, "zen-browser --remote-debugging-port 9333 --remote-allow-origins moz-extension://ext-id");
  assert.equal(byId("alt-panel").hidden, true);
  change("setup-install", "flatpak");
  assert.equal(byId("command").textContent, "flatpak run app.zen_browser.zen --remote-debugging-port 9333 --remote-allow-origins moz-extension://ext-id");
  change("setup-install", "custom");
  assert.equal(byId("setup-path-field").hidden, false);
  assert.equal(byId("command-panel").hidden, true);
  assert.equal(byId("setup-missing").hidden, false);
  assert.match(byId("setup-path-hint").textContent, /about:support/);
  change("setup-path", "/opt/zen browser/zen", "input");
  change("setup-profile", "work", "input");
  assert.equal(byId("command-panel").hidden, false);
  assert.equal(byId("command").textContent, '"/opt/zen browser/zen" --remote-debugging-port 9333 --remote-allow-origins moz-extension://ext-id -P "work"');
  change("setup-browser", "firefox");
  assert.equal(byId("setup-install").value, "default");
  assert.deepEqual(byId("setup-install").children.map((node) => node.value), ["default", "flatpak", "snap", "custom"]);
  change("setup-install", "snap");
  assert.equal(byId("command").textContent, 'snap run firefox --remote-debugging-port 9333 --remote-allow-origins moz-extension://ext-id -P "work"');
  change("setup-os", "macos");
  assert.equal(byId("command").textContent, 'open -a "Firefox" --args --remote-debugging-port 9333 --remote-allow-origins moz-extension://ext-id -P "work"');
  assert.equal(byId("command-label").textContent, "In Terminal:");
});

test("copy buttons copy the main, alternative and permanent commands", async () => {
  const { byId, copied } = await openFirefoxInput();
  byId("copy-command").click();
  byId("copy-alt").click();
  const stepCopy = byId("permanent-steps").descendants().find((node) => node.getAttribute("data-copy"));
  assert.ok(stepCopy, "a permanent step offers Copy");
  stepCopy.click();
  await flush();
  assert.deepEqual(copied, [ZEN_WINDOWS, ZEN_WINDOWS.slice(2), ZEN_WINDOWS.slice(2)]);
  assert.equal(byId("message").textContent, "Command copied.");
});

test("Check again sends bidi.check and renders the answer", async () => {
  const ready = { ...connectedStatus, client: "firefox", trustedInput: { mode: "bidi", port: 9333, origin: "moz-extension://ext-id", checkedAt: Date.now() } };
  const { byId, sent } = await openFirefoxInput({ answers: { "bidi.check": () => ({ ok: true, status: ready }) } });
  byId("input-check").click();
  assert.equal(byId("input-check").disabled, true);
  await flush();
  assert.equal(sent.filter((message) => message.op === "bidi.check").length, 1);
  assert.equal(sent.find((message) => message.op === "bidi.check").channel, "lb-control");
  assert.equal(byId("input-check").disabled, false);
  assert.equal(byId("input-title-line").textContent, "Ready");
  assert.equal(byId("input-detail").textContent, "WebDriver BiDi, port 9333.");
  assert.equal(byId("input-status").getAttribute("data-tone"), "ok");
  assert.equal(byId("input-setup").open, false);
  assert.equal(byId("message").textContent, "Trusted input is on.");
});

test("the port form saves through bidi.set and keeps a typed port until saved", async () => {
  const { byId, sent, fake } = await openFirefoxInput();
  byId("bidi-port").value = "9444";
  byId("bidi-port").dispatch("input");
  fake.api.runtime.onMessage.fire({ channel: "lb-status", status: { ...connectedStatus, client: "firefox", trustedInput: firefoxInput } });
  assert.equal(byId("bidi-port").value, "9444");
  byId("port-form").dispatch("submit");
  await flush();
  assert.equal(sent.find((message) => message.op === "bidi.set").port, 9444);
  fake.api.runtime.onMessage.fire({ channel: "lb-status", status: { ...connectedStatus, client: "firefox", trustedInput: { ...firefoxInput, port: 9444 } } });
  assert.equal(byId("bidi-port").value, "9444");
  assert.match(byId("command").textContent, /--remote-debugging-port 9444 /);
});

test("Chromium keeps the short ready view without Firefox setup", async () => {
  const { byId } = await openPage("control", { hash: "#input" });
  assert.equal(byId("input-title-line").textContent, "Trusted input is ready (Chrome DevTools Protocol).");
  assert.equal(byId("input-setup").hidden, true);
  assert.equal(byId("port-form").hidden, true);
  assert.equal(byId("input-check-row").hidden, true);
  assert.equal(byId("input-status").getAttribute("data-tone"), "ok");
});

test("popup shows the Firefox trusted input line with a Set up link", async () => {
  const { byId, fake } = await openPage("popup", { client: "firefox", status: { ...connectedStatus, client: "firefox", trustedInput: firefoxInput } });
  assert.equal(byId("trusted-line").hidden, false);
  assert.equal(byId("trusted-text").textContent, "Trusted input: off");
  assert.equal(byId("trusted-setup").hidden, false);
  byId("trusted-setup").click();
  await flush();
  const opened = fake.callsOf("tabs.create")[0][1].url;
  assert.equal(opened, "moz-extension://ext-id/ui/control.html#input");
  fake.api.runtime.onMessage.fire({ channel: "lb-status", status: { ...connectedStatus, client: "firefox", trustedInput: { mode: "bidi", port: 9333 } } });
  assert.equal(byId("trusted-text").textContent, "Trusted input: on");
  assert.equal(byId("trusted-setup").hidden, true);
  assert.equal(byId("trusted-sep").hidden, true);
  const chromium = await openPage("popup");
  assert.equal(chromium.byId("trusted-line").hidden, true);
});

test("pages re-render on lb-status broadcasts", async () => {
  const { byId, fake } = await openPage("control");
  fake.api.runtime.onMessage.fire({ channel: "lb-status", status: { ...connectedStatus, state: "disconnected", lastError: "socket closed" } });
  assert.equal(byId("pill-text").textContent, "Disconnected");
  assert.equal(byId("detail").textContent, "socket closed");
});
