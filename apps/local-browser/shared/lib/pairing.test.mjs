import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = here + path.sep;

function load() {
  const sandbox = { URL, URLSearchParams, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(readFileSync(root + "pairing.js", "utf8"), { filename: "pairing.js" }).runInContext(sandbox);
  return sandbox.LB.pairing;
}

const pairing = load();

test("the owner's exact address is accepted", () => {
  const parsed = pairing.parsePairingInput("https://app.paperclip.example");
  assert.equal(parsed.reason, null);
  assert.equal(parsed.origin, "https://app.paperclip.example");
  assert.equal(parsed.needsCode, true);
});

test("a bare address gets a scheme and keeps a local port on http", () => {
  assert.equal(pairing.normalizeOrigin("app.paperclip.example"), "https://app.paperclip.example");
  assert.equal(pairing.normalizeOrigin("localhost:3100"), "http://localhost:3100");
  assert.equal(pairing.normalizeOrigin("127.0.0.1:3100"), "http://127.0.0.1:3100");
});

test("a pasted bridge link pairs without any other input", () => {
  const parsed = pairing.parsePairingInput("https://paperclip.test/api/local-browser/bridge?code=F6BX2X8R");
  assert.deepEqual(
    { origin: parsed.origin, code: parsed.code, needsCode: parsed.needsCode, reason: parsed.reason },
    { origin: "https://paperclip.test", code: "F6BX2X8R", needsCode: false, reason: null },
  );
});

test("a websocket link and a trailing slash still pair", () => {
  const parsed = pairing.parsePairingInput("ws://localhost:3100/api/local-browser/bridge?code=ABCD2345");
  assert.equal(parsed.origin, "http://localhost:3100");
  assert.equal(parsed.code, "ABCD2345");
  const slash = pairing.parsePairingInput("https://Paperclip.Test/api/local-browser/bridge/?code=ABCD2345");
  assert.equal(slash.origin, "https://paperclip.test");
  assert.equal(slash.code, "ABCD2345");
});

test("a bare code is a code, not a host", () => {
  const parsed = pairing.parsePairingInput("F6BX2X8R");
  assert.equal(parsed.code, "F6BX2X8R");
  assert.equal(parsed.origin, null);
  assert.equal(parsed.needsCode, false);
});

test("a non-web scheme is refused by name", () => {
  const parsed = pairing.parsePairingInput("ftp://paperclip.test");
  assert.equal(parsed.origin, null);
  assert.match(parsed.reason, /ftp:/);
});

test("junk is refused instead of becoming a host", () => {
  for (const junk of ["nonsense!!", "http://", "https://", "   "]) {
    const parsed = pairing.parsePairingInput(junk);
    assert.equal(parsed.origin, null, junk + " must not produce an origin");
  }
});

test("a bridge url is built from the normalised origin", () => {
  assert.equal(
    pairing.pairUrl("app.paperclip.example", "F6BX2X8R"),
    "wss://app.paperclip.example/api/local-browser/bridge?code=F6BX2X8R",
  );
  assert.equal(pairing.pairUrl("!!", "F6BX2X8R"), null);
  assert.equal(pairing.pairUrl("paperclip.test", ""), null);
});
