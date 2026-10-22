import test from "node:test";
import assert from "node:assert/strict";

import "./popup-state.js";

const { view } = globalThis.LB.popup;

const paired = {
  paired: true,
  connected: true,
  socketState: "open",
  origin: "https://p.test",
  label: "Chrome on my laptop",
  tier: "refine",
  allowedOrigins: ["https://a.test", "https://b.test"],
  sessionId: "11111111-1111-4111-8111-111111111111",
  tabCount: 4,
};

test("a connected pairing shows Connected and enables both actions", () => {
  const state = view(paired);
  assert.equal(state.stateLabel, "Connected");
  assert.equal(state.dotClass, "dot on");
  assert.equal(state.reconnectEnabled, true);
  assert.equal(state.disconnectEnabled, true);
  assert.equal(state.showPairForm, true);
});

test("a limited site access says so, and full access stays quiet", () => {
  assert.match(view({ ...paired, siteAccess: "limited" }).access, /site access to all sites/);
  assert.equal(view({ ...paired, siteAccess: "all" }).access, "");
  assert.equal(view(paired).access, "");
});

test("the detail line shows the label and origin", () => {
  assert.equal(view(paired).detail, "Chrome on my laptop · https://p.test");
});

test("a connecting pairing shows Connecting", () => {
  const state = view({ ...paired, connected: false, socketState: "connecting" });
  assert.equal(state.stateLabel, "Connecting…");
  assert.equal(state.dotClass, "dot wait");
});

test("a dropped pairing shows Disconnected and still allows reconnect", () => {
  const state = view({ ...paired, connected: false, socketState: "idle" });
  assert.equal(state.stateLabel, "Disconnected");
  assert.equal(state.reconnectEnabled, true);
});

test("a retired pairing keeps the pair form usable so the user is not stuck", () => {
  const state = view({
    paired: false,
    connected: false,
    socketState: "idle",
    origin: "https://p.test",
    label: "Chrome on my laptop",
    retiredReason: "session token is not usable",
  });
  assert.equal(state.stateLabel, "Not paired");
  assert.equal(state.retired, true);
  assert.equal(state.showPairForm, true, "the form must stay available after retirement");
  assert.equal(state.prefilledOrigin, "https://p.test", "the origin stays so re-pairing is one click");
  assert.equal(state.prefilledLabel, "Chrome on my laptop");
});

test("a retired pairing explains why it ended", () => {
  const state = view({ paired: false, origin: "https://p.test", retiredReason: "session token is not usable" });
  assert.equal(state.detail, "Session ended: session token is not usable");
});

test("a retired pairing disables reconnect and disconnect", () => {
  const state = view({ paired: false, origin: "https://p.test", retiredReason: "gone" });
  assert.equal(state.reconnectEnabled, false);
  assert.equal(state.disconnectEnabled, false);
});

test("an unpaired browser asks for a connect URL", () => {
  const state = view({ paired: false });
  assert.equal(state.stateLabel, "Not paired");
  assert.equal(state.detail, "Paste a connect URL from Paperclip to start");
  assert.equal(state.reconnectEnabled, false);
  assert.equal(state.showPairForm, true);
});

test("origins describe the tier accurately", () => {
  assert.equal(view(paired).origins, "Allowed origins: https://a.test, https://b.test");
  assert.equal(view({ ...paired, tier: "full" }).origins, "Full tier: every origin is reachable.");
  assert.equal(
    view({ ...paired, tier: "refine", allowedOrigins: [] }).origins,
    "Refine tier with no allowed origins yet; set them in Paperclip.",
  );
});

test("the session id is shortened and missing values become dashes", () => {
  const state = view(paired);
  assert.equal(state.session, "11111111");
  assert.equal(state.tabs, "4");
  assert.equal(view({ paired: false }).session, "—");
  assert.equal(view({ paired: false }).tier, "—");
});

test("an extension error is surfaced instead of a stale state", () => {
  const state = view({ error: "no answer" });
  assert.equal(state.error, "no answer");
  assert.equal(state.reconnectEnabled, false);
});

test("a missing or malformed status never throws", () => {
  for (const value of [null, undefined, "nope", 42]) {
    const state = view(value);
    assert.equal(state.stateLabel, "Not paired");
    assert.equal(state.showPairForm, true);
  }
});
