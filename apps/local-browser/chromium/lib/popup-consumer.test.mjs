import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import "./popup-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function createShim() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        textContent: "",
        value: "",
        hidden: false,
        disabled: false,
        className: "",
        handlers: {},
        addEventListener(type, handler) {
          this.handlers[type] = handler;
        },
      });
    }
    return nodes.get(id);
  }
  const document = {
    addEventListener: () => undefined,
    getElementById: (id) => node(id),
  };
  const sandbox = {
    console,
    document,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => undefined,
    Promise,
    chrome: {
      runtime: { getManifest: () => ({ version: "1.0.0" }), sendMessage: (message, callback) => callback(null) },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  return { sandbox, nodes, node };
}

function bootPopup() {
  const shim = createShim();
  vm.createContext(shim.sandbox);
  shim.sandbox.LB = globalThis.LB;
  for (const file of ["popup.js"]) {
    const source = readFileSync(join(root, file), "utf8");
    vm.runInContext(source, shim.sandbox, { filename: file });
  }
  return shim;
}

test("the popup applies the module's decisions instead of deciding inline", () => {
  const source = readFileSync(join(root, "popup.js"), "utf8");
  assert.equal(source.includes("LB.popup.view("), true, "popup.js must delegate to LB.popup.view");
  for (const leaked of ["statusLabel(", "dotClass(", "retiredReason", "allowedOrigins"]) {
    assert.equal(
      source.includes(leaked),
      false,
      "popup.js must not re-derive display decisions itself: found " + leaked,
    );
  }
});

test("a retired status renders the reason and keeps the pair form usable", () => {
  const shim = bootPopup();
  const apply = shim.sandbox.apply;
  assert.equal(typeof apply, "function", "popup.js must expose apply() for the renderer");

  apply(
    globalThis.LB.popup.view({
      paired: false,
      connected: false,
      socketState: "idle",
      origin: "https://p.test",
      label: "Chrome on my laptop",
      retiredReason: "session token is not usable",
    }),
  );

  assert.equal(shim.node("state").textContent, "Not paired");
  assert.equal(shim.node("detail").textContent, "Session ended: session token is not usable");
  assert.equal(shim.node("pair-form").hidden, false, "the form must stay visible so the user is not stuck");
  assert.equal(shim.node("server").value, "https://p.test", "the origin must be prefilled");
  assert.equal(shim.node("label").value, "Chrome on my laptop");
  assert.equal(shim.node("reconnect").disabled, true);
  assert.equal(shim.node("disconnect").disabled, true);
});

test("a live status enables the actions and shows the tier", () => {
  const shim = bootPopup();
  shim.sandbox.apply(
    globalThis.LB.popup.view({
      paired: true,
      connected: true,
      socketState: "open",
      origin: "https://p.test",
      label: "Chrome",
      tier: "full",
      allowedOrigins: [],
      sessionId: "11111111-1111-4111-8111-111111111111",
      tabCount: 3,
    }),
  );

  assert.equal(shim.node("state").textContent, "Connected");
  assert.equal(shim.node("tier").textContent, "full");
  assert.equal(shim.node("tabs").textContent, "3");
  assert.equal(shim.node("session").textContent, "11111111");
  assert.equal(shim.node("reconnect").disabled, false);
  assert.equal(shim.node("disconnect").disabled, false);
  assert.equal(shim.node("pair-form").hidden, false);
});
