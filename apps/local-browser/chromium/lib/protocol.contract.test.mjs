import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  await readFile(path.join(here, "protocol.contract.json"), "utf8"),
);
const source = await readFile(path.join(here, "protocol.js"), "utf8");

const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
new vm.Script(source, { filename: "protocol.js" }).runInContext(sandbox);
const protocol = sandbox.LB.protocol;

test("the extension protocol version matches the shared contract", () => {
  assert.equal(protocol.PROTOCOL_VERSION, contract.protocol);
});

test("the extension error codes match the shared contract", () => {
  assert.deepEqual(
    Object.values(protocol.ERROR_CODES).sort(),
    [...contract.errorCodes].sort(),
  );
});

test("the extension defaults match the shared contract limits", () => {
  const limits = contract.limits;
  assert.equal(protocol.DEFAULTS.callTimeoutMs, limits.callTimeoutMs);
  assert.equal(protocol.DEFAULTS.snapshotNodes, limits.snapshotDefaultNodes);
  assert.equal(protocol.DEFAULTS.snapshotMaxNodes, limits.snapshotMaxNodes);
  assert.equal(protocol.DEFAULTS.textChars, limits.textDefaultChars);
  assert.equal(protocol.DEFAULTS.textMaxChars, limits.textMaxChars);
  assert.equal(protocol.DEFAULTS.viewerIntervalMs, limits.viewerFrameIntervalMs);
});

test("the full tier tools are a subset of the contract tool names", () => {
  const known = new Set(contract.toolNames);
  for (const tool of protocol.FULL_TIER_TOOLS) {
    assert.equal(known.has(tool), true, tool + " is not a contract tool name");
  }
});

test("the internal tools stay out of the model-facing tool list", () => {
  const known = new Set(contract.toolNames);
  for (const tool of protocol.INTERNAL_TOOLS) {
    assert.equal(known.has(tool), false, tool + " must not be a contract tool");
  }
});

test("the cursor pattern matches the shared contract", () => {
  const pattern = new RegExp(contract.cursorPattern.slice(1, -1));
  assert.equal(pattern.test("120"), true);
  assert.equal(pattern.test("eyJvIjoxMjB9"), false);
  assert.equal(pattern.test("-3"), false);
});

test("the bridge path matches the server route", async () => {
  const route = await readFile(
    path.join(here, "..", "..", "..", "..", "server", "src", "routes", "local-browser.ts"),
    "utf8",
  );
  assert.equal(protocol.BRIDGE_PATH, "/api/local-browser/bridge");
  assert.equal(route.includes(protocol.BRIDGE_PATH + "?code="), true);
});
