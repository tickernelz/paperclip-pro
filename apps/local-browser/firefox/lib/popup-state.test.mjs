import test from "node:test";
import assert from "node:assert/strict";

import "./popup-state.js";

const { view } = globalThis.LB.popupState;

const RETIRED = {
  origin: "https://paperclip.test",
  label: "FF",
  hasToken: false,
  retiredAt: "2026-01-01T00:00:00.000Z",
  retiredReason: "the pairing code was not accepted",
};

const LIVE = { origin: "https://paperclip.test", label: "FF", hasToken: true, retiredAt: null, retiredReason: null };

test("a retired pairing shows the pair form so the user can enter a new code", () => {
  const result = view(RETIRED, { status: "unpaired", lastError: "" });
  assert.equal(result.showPairForm, true);
  assert.equal(result.retired, true);
});

test("a retired pairing still offers Disconnect", () => {
  const result = view(RETIRED, { status: "unpaired", lastError: "" });
  assert.equal(result.showActions, true);
});

test("a retired pairing cannot Reconnect", () => {
  const result = view(RETIRED, { status: "unpaired", lastError: "" });
  assert.equal(result.reconnectEnabled, false);
});

test("a retired pairing explains itself even with no lastError", () => {
  const result = view(RETIRED, { status: "unpaired", lastError: "" });
  assert.match(result.message, /Session ended/);
  assert.match(result.message, /the pairing code was not accepted/);
  assert.match(result.message, /Pair this browser again/);
});

test("a live pairing hides the form and enables Reconnect", () => {
  const result = view(LIVE, { status: "connected", lastError: "" });
  assert.equal(result.showPairForm, false);
  assert.equal(result.showActions, true);
  assert.equal(result.reconnectEnabled, true);
  assert.equal(result.retired, false);
  assert.equal(result.message, "");
});

test("an unpaired browser hides the actions and shows the form", () => {
  const result = view(null, { status: "unpaired", lastError: "" });
  assert.equal(result.showPairForm, true);
  assert.equal(result.showActions, false);
  assert.equal(result.reconnectEnabled, false);
});

test("a pairing without a token is never treated as live", () => {
  const result = view({ origin: "https://paperclip.test", label: "FF", hasToken: false }, { status: "connecting", lastError: "" });
  assert.equal(result.showPairForm, true);
  assert.equal(result.reconnectEnabled, false);
});

test("an origin-only pairing prefills the form", () => {
  const result = view(RETIRED, { status: "unpaired", lastError: "" });
  assert.equal(result.prefillOrigin, "https://paperclip.test");
});

test("an explicit lastError wins over the retired reason", () => {
  const result = view(RETIRED, { status: "unpaired", lastError: "Session ended: custom detail" });
  assert.equal(result.message, "Session ended: custom detail");
});
