import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function loadPairing() {
  const sandbox = { URL, URLSearchParams, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(readFileSync(join(here, "pairing.js"), "utf8"), { filename: "pairing.js" }).runInContext(sandbox);
  return sandbox.LB.pairing;
}

const pairing = loadPairing();

test("chromium accepts the owner's exact address without a scheme error", () => {
  const parsed = pairing.parsePairingInput("https://app.paperclip.example");
  assert.equal(parsed.reason, null);
  assert.equal(parsed.origin, "https://app.paperclip.example");
});

test("chromium accepts a bare host and a local port", () => {
  assert.equal(pairing.normalizeOrigin("app.paperclip.example"), "https://app.paperclip.example");
  assert.equal(pairing.normalizeOrigin("localhost:3100"), "http://localhost:3100");
});

test("chromium pairs from one pasted bridge link", () => {
  const parsed = pairing.parsePairingInput("https://paperclip.test/api/local-browser/bridge?code=F6BX2X8R");
  assert.equal(parsed.origin, "https://paperclip.test");
  assert.equal(parsed.code, "F6BX2X8R");
  assert.equal(parsed.reason, null);
});

test("a bare code stays a code and is not read as a host", () => {
  const parsed = pairing.parsePairingInput("F6BX2X8R");
  assert.equal(parsed.code, "F6BX2X8R");
  assert.equal(parsed.origin, null);
  assert.equal(parsed.needsCode, false);
});

test("the popup ships exactly one pairing input", () => {
  const html = readFileSync(join(root, "popup.html"), "utf8");
  assert.equal(html.includes('id="pair-input"'), true);
  for (const removed of ['id="server"', 'id="code"', 'id="label"']) {
    assert.equal(html.includes(removed), false, "the popup must not ask for " + removed);
  }
});

test("the popup reads the marker the panel writes", () => {
  const background = readFileSync(join(root, "background.js"), "utf8");
  assert.equal(background.includes("[data-paperclip-local-browser-pairing]"), true);
  assert.equal(background.includes('"lb:detect"'), true);
});
