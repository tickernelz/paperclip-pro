import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function createDom() {
  const elements = new Map();
  function element(id) {
    const node = {
      id,
      textContent: "",
      value: "",
      hidden: false,
      disabled: false,
      dataset: {},
      listeners: {},
      appendChild(child) {
        this.children = this.children || [];
        this.children.push(child);
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
    };
    elements.set(id, node);
    return node;
  }
  for (const id of [
    "status",
    "label",
    "tier",
    "origin",
    "since",
    "version",
    "bidi",
    "message",
    "bidi-hint",
    "pair-form",
    "actions",
    "detected",
    "pair-input",
    "pair",
    "reconnect",
    "disconnect",
  ]) {
    element(id);
  }
  return {
    elements,
    document: {
      getElementById: (id) => elements.get(id) || null,
      createTextNode: (text) => ({ text }),
      createElement: (tag) => ({ tag, textContent: "" }),
    },
  };
}

function bootPopup() {
  const dom = createDom();
  const sent = [];
  const sandbox = {
    document: dom.document,
    console,
    setTimeout,
    clearTimeout,
    browser: {
      runtime: {
        sendMessage: async (message) => {
          sent.push(message);
          if (message.op === "status") return { ok: true, state: sandbox.__state, pairing: sandbox.__pairing };
          if (message.op === "bidi") return { ok: true, bidi: { available: false, launchHint: "firefox --remote-debugging-port 9222" } };
          return { ok: true, state: sandbox.__state };
        },
        onMessage: { addListener: () => {} },
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.__state = { status: "unpaired", label: "FF", tier: null, origin: "https://paperclip.test", clientVersion: "1.0.0", connectedAt: null, lastError: "" };
  sandbox.__pairing = null;
  sandbox.__exposeRender = (render) => {
    sandbox.__render = render;
  };
  createContext(sandbox);
  runInContext(readFileSync(root + "lib/pairing.js", "utf8"), sandbox, { filename: "lib/pairing.js" });
  runInContext(readFileSync(root + "lib/popup-state.js", "utf8"), sandbox, { filename: "lib/popup-state.js" });
  runInContext(readFileSync(root + "popup/popup.js", "utf8"), sandbox, { filename: "popup/popup.js" });
  assert.equal(typeof sandbox.__render, "function", "popup.js must expose render for testing");
  return { dom, sandbox };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function show(state, pairing) {
  const harness = bootPopup();
  harness.sandbox.__state = state;
  harness.sandbox.__pairing = pairing;
  await harness.sandbox.__render(state, pairing);
  return harness.dom.elements;
}

test("the popup displays the retired reason when lastError is empty", async () => {
  const elements = await show(
    { status: "unpaired", label: "FF", tier: null, origin: "https://paperclip.test", clientVersion: "1.0.0", connectedAt: null, lastError: "" },
    {
      origin: "https://paperclip.test",
      label: "FF",
      hasToken: false,
      retiredAt: "2026-01-01T00:00:00.000Z",
      retiredReason: "the pairing code was not accepted",
    },
  );
  assert.equal(elements.get("message").hidden, false, "the reason must be visible");
  assert.match(elements.get("message").textContent, /Session ended/);
  assert.match(elements.get("message").textContent, /the pairing code was not accepted/);
  assert.match(elements.get("message").textContent, /Pair this browser again/);
});

test("the popup shows the pair form and hides nothing the user needs when retired", async () => {
  const elements = await show(
    { status: "unpaired", label: "FF", tier: null, origin: "https://paperclip.test", clientVersion: "1.0.0", connectedAt: null, lastError: "" },
    { origin: "https://paperclip.test", label: "FF", hasToken: false, retiredAt: "2026-01-01T00:00:00.000Z", retiredReason: "the pairing code was not accepted" },
  );
  assert.equal(elements.get("pair-form").hidden, false, "the form must be visible");
  assert.equal(elements.get("actions").hidden, false, "Disconnect must stay visible");
  assert.equal(elements.get("reconnect").disabled, true, "Reconnect must be disabled");
  assert.equal(elements.get("pair-input").value, "https://paperclip.test", "the known address is prefilled");
});

test("the popup shows nothing when a live pairing is connected", async () => {
  const elements = await show(
    { status: "connected", label: "FF", tier: "refine", origin: "https://paperclip.test", clientVersion: "1.0.0", connectedAt: "2026-01-01T00:00:00.000Z", lastError: "" },
    { origin: "https://paperclip.test", label: "FF", hasToken: true, retiredAt: null, retiredReason: null },
  );
  assert.equal(elements.get("message").hidden, true);
  assert.equal(elements.get("pair-form").hidden, true);
  assert.equal(elements.get("reconnect").disabled, false);
});

test("the popup prefers an explicit lastError over the retired reason", async () => {
  const elements = await show(
    { status: "unpaired", label: "FF", tier: null, origin: "https://paperclip.test", clientVersion: "1.0.0", connectedAt: null, lastError: "Session ended: custom detail" },
    { origin: "https://paperclip.test", label: "FF", hasToken: false, retiredAt: "2026-01-01T00:00:00.000Z", retiredReason: "the pairing code was not accepted" },
  );
  assert.equal(elements.get("message").textContent, "Session ended: custom detail");
});

test("an unpaired browser shows the form and no actions", async () => {
  const elements = await show(
    { status: "unpaired", label: null, tier: null, origin: null, clientVersion: "1.0.0", connectedAt: null, lastError: "" },
    null,
  );
  assert.equal(elements.get("pair-form").hidden, false);
  assert.equal(elements.get("actions").hidden, true);
  assert.equal(elements.get("message").hidden, true);
});
