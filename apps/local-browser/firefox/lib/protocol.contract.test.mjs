import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ownContractText = await readFile(path.join(here, "protocol.contract.json"), "utf8");
const contract = JSON.parse(ownContractText);
const chromiumContract = JSON.parse(
  await readFile(path.join(here, "..", "..", "chromium", "lib", "protocol.contract.json"), "utf8"),
);

test("the firefox contract file parses and carries the fields the assertions read", () => {
  for (const key of ["protocol", "tiers", "clients", "errorCodes", "actions", "toolNames", "limits"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(contract, key), "contract is missing " + key);
  }
  assert.ok(Array.isArray(contract.errorCodes) && contract.errorCodes.length > 0, "errorCodes must be a non-empty array");
  assert.ok(Array.isArray(contract.toolNames) && contract.toolNames.length > 0, "toolNames must be a non-empty array");
  assert.equal(typeof contract.limits.callTimeoutMs, "number");
  assert.equal(typeof contract.limits.snapshotMaxNodes, "number");
});

test("the firefox and chromium contract files are identical", () => {
  assert.deepEqual(contract, chromiumContract);
});
const source = await readFile(path.join(here, "protocol.js"), "utf8");

const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
new vm.Script(source, { filename: "protocol.js" }).runInContext(sandbox);
const protocol = sandbox.LB.protocol;

test("the firefox protocol version matches the shared contract", () => {
  assert.equal(protocol.PROTOCOL_VERSION, contract.protocol);
  assert.equal(protocol.CLIENT, "firefox");
});

test("the firefox error codes match the shared contract", () => {
  assert.deepEqual(
    Object.values(protocol.ERROR_CODES).sort(),
    [...contract.errorCodes].sort(),
  );
});

test("the firefox defaults match the shared contract limits", () => {
  const limits = contract.limits;
  assert.equal(protocol.DEFAULTS.callTimeoutMs, limits.callTimeoutMs);
  assert.equal(protocol.DEFAULTS.snapshotMaxNodes, limits.snapshotMaxNodes);
  assert.equal(protocol.DEFAULTS.textMaxChars, limits.textMaxChars);
  assert.equal(protocol.DEFAULTS.viewerIntervalMs, limits.viewerFrameIntervalMs);
});

test("the firefox cursor pattern matches the shared contract", () => {
  assert.equal("/" + protocol.CURSOR_PATTERN.source + "/", contract.cursorPattern);
  assert.equal(protocol.CURSOR_PATTERN.test("120"), true);
  assert.equal(protocol.CURSOR_PATTERN.test("eyJvIjoxMjB9"), false);
});

test("every firefox tool name is a contract tool name", () => {
  const known = new Set(contract.toolNames);
  for (const tool of protocol.AGENT_TOOLS) {
    assert.equal(known.has(tool), true, tool + " is not a contract tool name");
  }
  for (const tool of protocol.INTERNAL_TOOLS) {
    assert.equal(known.has(tool), false, tool + " must not be a contract tool");
  }
});

test("accepts a hint string and a retryable boolean", () => {
  const payload = protocol.error("local_browser_timeout", "Slow", "Retry the call", true);
  assert.equal(payload.hint, "Retry the call");
  assert.equal(payload.retryable, true);
});

test("accepts an options object", () => {
  const payload = protocol.error("local_browser_timeout", "Slow", { hint: "Retry", retryable: false });
  assert.equal(payload.hint, "Retry");
  assert.equal(payload.retryable, false);
});

test("omits empty hints and unknown retryability", () => {
  const payload = protocol.error("local_browser_timeout", "Slow");
  assert.deepEqual(Object.keys(payload).sort(), ["code", "message"]);
  const blank = protocol.error("local_browser_timeout", "Slow", "", undefined);
  assert.equal(blank.hint, undefined);
  assert.equal(blank.retryable, undefined);
});

test("pins the navigate and wait defaults the server table also hardcodes", () => {
  assert.equal(protocol.DEFAULTS.navigateTimeoutMs, 15000);
  assert.equal(protocol.DEFAULTS.waitTimeoutMs, 10000);
  assert.equal(protocol.DEFAULTS.callTimeoutMs, 30000);
  assert.equal(protocol.DEFAULTS.snapshotNodes, 120);
  assert.equal(protocol.DEFAULTS.snapshotMaxNodes, 400);
});

test("the navigate and wait defaults sit inside the clamp range the budgets use", () => {
  const min = 100;
  const max = 120000;
  for (const key of ["navigateTimeoutMs", "waitTimeoutMs", "callTimeoutMs"]) {
    const value = protocol.DEFAULTS[key];
    assert.ok(value >= min && value <= max, key + " is outside " + min + ".." + max);
  }
  assert.notEqual(protocol.DEFAULTS.navigateTimeoutMs, protocol.DEFAULTS.callTimeoutMs);
  assert.notEqual(protocol.DEFAULTS.waitTimeoutMs, protocol.DEFAULTS.callTimeoutMs);
});
