import test from "node:test";
import assert from "node:assert/strict";

import { bootBackground, flush, pairAndAck } from "./harness.test.mjs";

function boot() {
  const harness = bootBackground({ clock: true });
  return { ...harness, storage: harness.store };
}

test("server pings alone keep the socket open past 150s with no reconnect", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  for (let elapsed = 0; elapsed < 150; elapsed += 25) {
    harness.clock.advance(25000);
    await flush();
    socket.deliver({ type: "ping", at: "2026-01-01T00:00:00.000Z" });
    await flush();
  }

  assert.equal(socket.readyState, 1, "the socket must still be open");
  assert.equal(harness.sockets.length, before, "no reconnect may have been attempted");
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "connected");
});

test("hello advertises every capability with the access snapshot and guards", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const hello = socket.sent.find((frame) => frame.type === "hello");
  assert.deepEqual([...hello.capabilities].sort(), [...harness.sandbox.LB.protocol.CAPABILITIES].sort());
  assert.equal(hello.access.siteAccess, "all");
  assert.ok(Array.isArray(hello.access.granted));
  assert.deepEqual(hello.guards, { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 });
  assert.equal(hello.tabs[0].cookieStoreId, "firefox-default");
});

test("a call carries the server budget into the tool and times out on it", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  let seen = null;
  harness.sandbox.LB.tools.dispatch = (tool, args, ctx) => {
    seen = ctx;
    return new Promise(() => {});
  };
  socket.sent.length = 0;
  socket.deliver({ type: "call", id: "slow", tool: "local_browser_snapshot", args: {}, budgetMs: 4000 });
  await flush();
  assert.equal(seen.budgetMs, 3000);
  harness.clock.advance(2999);
  await flush();
  assert.equal(socket.sent.filter((frame) => frame.type === "result").length, 0);
  harness.clock.advance(2);
  await flush();
  const result = socket.sent.find((frame) => frame.type === "result" && frame.id === "slow");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_timeout");
});

test("a permission refusal reaches the server with the missing ids", async () => {
  const harness = boot();
  harness.revoke(["cookies"]);
  const socket = await pairAndAck(harness);
  socket.sent.length = 0;
  socket.deliver({ type: "call", id: "jar", tool: "local_browser_storage", args: { kind: "cookies", op: "get", allDomains: true } });
  await flush(20);
  const result = socket.sent.find((frame) => frame.type === "result" && frame.id === "jar");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_permission_required");
  assert.deepEqual(result.error.permissions, ["cookies"]);
  assert.equal(result.error.retryable, true);
});

test("access and guards changes are sent as events", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  socket.sent.length = 0;
  harness.revoke(["history"]);
  await flush(20);
  const access = socket.sent.find((frame) => frame.type === "event" && frame.event === "access");
  assert.ok(access, "an access event must follow a permission change");
  assert.ok(access.data.missing.includes("history"));
  await harness.control({ channel: "lb-control", op: "guards.set", patch: { networkBufferSize: 75 } });
  await flush(20);
  const guards = socket.sent.find((frame) => frame.type === "event" && frame.event === "guards");
  assert.equal(guards.data.networkBufferSize, 75);
});

test("the client keeps sending its own ping so the server can check for silence", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  socket.sent.length = 0;

  harness.clock.advance(25000);
  await flush();

  const pings = socket.sent.filter((frame) => frame.type === "ping");
  assert.equal(pings.length, 1);
  assert.equal(typeof pings[0].at, "string");
});

test("a socket that goes silent still reconnects", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  for (let elapsed = 0; elapsed < 150; elapsed += 25) {
    harness.clock.advance(25000);
    await flush();
  }

  assert.equal(socket.readyState, 3, "the silent socket must be closed");
  assert.ok(harness.sockets.length > before, "a reconnect must have been attempted");
});

test("an inbound call also counts as liveness", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  for (let elapsed = 0; elapsed < 150; elapsed += 25) {
    harness.clock.advance(25000);
    await flush();
    socket.deliver({ type: "call", id: "c" + elapsed, tool: "local_browser_sessions", args: {} });
    await flush();
  }

  assert.equal(socket.readyState, 1);
  assert.equal(harness.sockets.length, before);
});

test("the heartbeat window is seventy five seconds of true silence", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);

  harness.clock.advance(50000);
  await flush();
  assert.equal(socket.readyState, 1, "50s of silence is inside the window");

  harness.clock.advance(50000);
  await flush();
  assert.equal(socket.readyState, 3, "100s of silence must trip the window");
});

test("a 1008 close retires the pairing instead of reconnecting forever", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  socket.close(1008, "session token is not usable");
  await flush();
  harness.clock.advance(120000);
  await flush();

  assert.equal(harness.sockets.length, before, "no reconnect may be attempted after a 1008");
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "retired");
  const stored = harness.storage.get("lb.pairing");
  assert.equal(stored.sessionToken, null);
  assert.equal(stored.sessionId, null);
  assert.equal(stored.tier, null);
  assert.equal(stored.origin, "https://app.example", "origin is kept so the popup can offer re-pairing");
  assert.equal(stored.label, "Work", "label is kept");
  assert.equal(stored.retiredReason, "session token is not usable");
  assert.equal(typeof stored.retiredAt, "string");
});

test("a 1008 close reports the reason to the popup", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);

  socket.close(1008, "session token is not usable");
  await flush();

  const state = harness.sandbox.LB.bridge.snapshotState();
  assert.equal(state.status, "retired");
  assert.equal(state.retiredReason, "session token is not usable");
  assert.match(state.lastError, /Session ended/);
  assert.match(state.lastError, /session token is not usable/);
  assert.match(state.lastError, /Pair this browser again/);
});

test("a 1008 close stops the viewer", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  await harness.sandbox.LB.tools.dispatch("local_browser_viewer", { op: "start", intervalMs: 500 }, { tier: "refine", sessionId: "s" });
  await flush();
  assert.equal(harness.sandbox.LB.bridge.snapshotState().viewerActive, true);

  socket.close(1008, "session token is not usable");
  await flush();

  assert.equal(harness.sandbox.LB.bridge.snapshotState().viewerActive, false);
});

test("a 1006 close still reconnects and keeps the token", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  socket.close(1006, "abnormal");
  await flush();
  harness.clock.advance(4000);
  await flush();

  assert.ok(harness.sockets.length > before, "an abnormal close must reconnect");
  assert.equal(harness.storage.get("lb.pairing").sessionToken, "tok");
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "unpaired");
});

test("a 1001 close still reconnects", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  socket.close(1001, "session gone");
  await flush();
  harness.clock.advance(4000);
  await flush();

  assert.ok(harness.sockets.length > before);
});

test("a retired pairing does not reconnect on browser start and keeps its reason", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  socket.close(1008, "session token is not usable");
  await flush();
  const before = harness.sockets.length;

  await harness.sandbox.LB.bridge.start();
  await flush();
  harness.clock.advance(120000);
  await flush();

  assert.equal(harness.sockets.length, before, "a retired pairing must not open a socket");
  const state = harness.sandbox.LB.bridge.snapshotState();
  assert.equal(state.status, "retired");
  assert.match(state.lastError, /session token is not usable/, "the reason must survive a restart");
});

test("a pairing code the server never accepts is retired instead of retried forever", async () => {
  const harness = boot();
  await flush();
  await harness.sandbox.LB.bridge.pair({ origin: "https://app.example", code: "DEADCODE", label: "Work" });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const socket = harness.sockets[harness.sockets.length - 1];
    socket.close(1006, "upgrade rejected");
    await flush();
    harness.clock.advance(60000);
    await flush();
  }

  const state = harness.sandbox.LB.bridge.snapshotState();
  assert.equal(state.status, "retired", "a dead code must not leave the popup on connecting");
  assert.match(state.lastError, /pairing code was not accepted/);
  const stored = harness.storage.get("lb.pairing");
  assert.equal(stored.origin, "https://app.example");
  assert.equal(stored.label, "Work");
  assert.equal(stored.sessionToken, null);
  assert.equal(stored.retiredReason, "the pairing code was not accepted");

  const attempts = harness.sockets.length;
  harness.clock.advance(300000);
  await flush();
  assert.equal(harness.sockets.length, attempts, "no further attempts may be made with a dead code");
});

test("a pairing code retires after exactly three failed attempts, not before", async () => {
  const harness = boot();
  await flush();
  await harness.sandbox.LB.bridge.pair({ origin: "https://app.example", code: "DEADCODE", label: "Work" });

  const first = harness.sockets[harness.sockets.length - 1];
  first.close(1006, "upgrade rejected");
  await flush();
  harness.clock.advance(60000);
  await flush();
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "retired", "one failure must still retry");

  const second = harness.sockets[harness.sockets.length - 1];
  second.close(1006, "upgrade rejected");
  await flush();
  harness.clock.advance(60000);
  await flush();
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "retired", "two failures must still retry");

  const third = harness.sockets[harness.sockets.length - 1];
  third.close(1006, "upgrade rejected");
  await flush();
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "retired", "three failures retire the code");
});

test("an established session still reconnects on 1006 rather than retiring", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  const before = harness.sockets.length;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = harness.sockets[harness.sockets.length - 1];
    current.close(1006, "network blip");
    await flush();
    harness.clock.advance(60000);
    await flush();
  }

  assert.ok(harness.sockets.length > before, "a paired session must keep reconnecting");
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "retired");
  assert.equal(harness.storage.get("lb.pairing").sessionToken, "tok");
});

test("pairing again after a dead code resets the attempt counter", async () => {
  const harness = boot();
  await flush();
  await harness.sandbox.LB.bridge.pair({ origin: "https://app.example", code: "DEADCODE", label: "Work" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    harness.sockets[harness.sockets.length - 1].close(1006, "upgrade rejected");
    await flush();
    harness.clock.advance(60000);
    await flush();
  }
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "retired");

  await harness.sandbox.LB.bridge.pair({ origin: "https://app.example", code: "GOODCODE", label: "Work" });
  await flush();
  const fresh = harness.sockets[harness.sockets.length - 1];
  assert.match(fresh.url, /\?code=GOODCODE/);
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "connecting");
});

test("Reconnect refuses a retired pairing instead of dialling with no credential", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  socket.close(1008, "session token is not usable");
  await flush();
  const before = harness.sockets.length;

  const response = await harness.sandbox.LB.bridge.control({ op: "reconnect" });
  await flush();
  harness.clock.advance(120000);
  await flush();

  assert.equal(response.ok, false, "reconnect must be refused");
  assert.match(response.error, /session token is not usable/);
  assert.match(response.error, /Pair this browser again/);
  assert.equal(harness.sockets.length, before, "no socket may be opened without a credential");
});

test("the status payload tells the popup that a pairing is retired", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  socket.close(1008, "session token is not usable");
  await flush();

  const response = await harness.control({ channel: "lb-control", op: "status" });
  assert.equal(response.ok, true);
  assert.equal(response.status.state, "retired");
  assert.equal(response.status.retiredReason, "session token is not usable");
  assert.equal(response.status.origin, "https://app.example");
  assert.equal(response.status.sessionId, null);
});

test("a live pairing can still Reconnect", async () => {
  const harness = boot();
  await pairAndAck(harness);
  const before = harness.sockets.length;

  const response = await harness.sandbox.LB.bridge.control({ op: "reconnect" });
  await flush();

  assert.equal(response.ok, true);
  assert.ok(harness.sockets.length > before);
});

test("pairing again clears the retired marker", async () => {
  const harness = boot();
  const socket = await pairAndAck(harness);
  socket.close(1008, "session token is not usable");
  await flush();

  await harness.sandbox.LB.bridge.pair({ origin: "https://app.example", code: "ZZZ99999", label: "Work" });
  await flush();

  const stored = harness.storage.get("lb.pairing");
  assert.equal(stored.retiredReason, undefined);
  assert.equal(stored.retiredAt, undefined);
  const fresh = harness.sockets[harness.sockets.length - 1];
  assert.match(fresh.url, /\?code=ZZZ99999/);
});
