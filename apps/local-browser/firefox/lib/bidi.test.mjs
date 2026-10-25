import test from "node:test";
import assert from "node:assert/strict";

import { bootBackground, plain } from "./harness.test.mjs";

const TAB = { id: 12, windowId: 1, title: "Example", url: "https://example.test/", active: true, status: "complete" };

function reachable() {
  return { ok: false, status: 0, type: "opaque" };
}

function refused() {
  throw new TypeError("NetworkError when attempting to fetch resource.");
}

function answers(map) {
  return (frame) => {
    const value = map[frame.method];
    return typeof value === "function" ? value(frame) : value;
  };
}

const READY = { "session.status": { ready: true, message: "" }, "session.new": { sessionId: "s1", capabilities: {} } };

function boot(options = {}) {
  return bootBackground({ tabs: [TAB], executeScript: () => [null], ...options });
}

function send(harness, op, payload = {}) {
  return harness.control({ ...payload, channel: "lb-control", op });
}

function bidiSockets(harness) {
  return harness.sockets.filter((socket) => socket.bidi);
}

function fetched(harness) {
  return harness.callsOf("fetch").map((call) => call[1]);
}

test("not_running when nothing answers on the port", async () => {
  const harness = boot({ fetch: refused, bidi: { reply: answers(READY) } });
  const input = (await send(harness, "status")).status.trustedInput;
  assert.deepEqual(Object.keys(input).sort(), ["checkedAt", "mode", "origin", "port", "reason"]);
  assert.equal(input.mode, "synthetic");
  assert.equal(input.reason, "not_running");
  assert.equal(input.port, 9222);
  assert.equal(input.origin, "moz-extension://uuid");
  assert.equal(bidiSockets(harness).length, 0);
  const call = harness.callsOf("fetch")[0];
  assert.equal(call[1], "http://127.0.0.1:9222/");
  assert.equal(call[2].mode, "no-cors");
  assert.equal(call[2].cache, "no-store");
});

test("origin_refused when HTTP answers but the WebSocket handshake fails", async () => {
  const harness = boot({ fetch: reachable, bidi: { accept: false } });
  const input = (await send(harness, "status")).status.trustedInput;
  assert.equal(input.mode, "synthetic");
  assert.equal(input.reason, "origin_refused");
  assert.deepEqual(bidiSockets(harness).map((socket) => socket.url), ["ws://127.0.0.1:9222/session"]);
});

test("busy when session.new is refused, and the socket is closed", async () => {
  const harness = boot({ fetch: reachable, bidi: { reply: answers({ ...READY, "session.new": { error: "session not created" } }) } });
  const input = (await send(harness, "status")).status.trustedInput;
  assert.equal(input.mode, "synthetic");
  assert.equal(input.reason, "busy");
  const [socket] = bidiSockets(harness);
  assert.deepEqual(socket.sent.map((frame) => frame.method), ["session.status", "session.new"]);
  assert.deepEqual(plain(socket.sent[1].params), { capabilities: { alwaysMatch: {} } });
  assert.equal(socket.readyState, 3);
  assert.equal(await harness.LB.bidi.connect(), null);
});

test("busy when session.status says another session holds the browser", async () => {
  const harness = boot({ fetch: reachable, bidi: { reply: answers({ ...READY, "session.status": { ready: false, message: "Session already started" } }) } });
  const input = (await send(harness, "status")).status.trustedInput;
  assert.equal(input.reason, "busy");
  assert.deepEqual(bidiSockets(harness)[0].sent.map((frame) => frame.method), ["session.status"]);
  assert.equal(bidiSockets(harness)[0].readyState, 3);
});

test("ready keeps the session socket and later probes reuse it", async () => {
  const harness = boot({ fetch: reachable, bidi: { reply: answers(READY) } });
  const first = (await send(harness, "status")).status.trustedInput;
  assert.equal(first.mode, "bidi");
  assert.equal(first.port, 9222);
  assert.equal("reason" in first, false);
  const [socket] = bidiSockets(harness);
  assert.equal(socket.readyState, 1);
  const checked = (await send(harness, "bidi.check")).status.trustedInput;
  assert.equal(checked.mode, "bidi");
  assert.equal((await harness.LB.bidi.connect()) === socket, true);
  assert.equal(bidiSockets(harness).length, 1);
  assert.equal(socket.sent.filter((frame) => frame.method === "session.new").length, 1);
  assert.equal(fetched(harness).length, 1);
});

test("concurrent probes share one attempt and one session", async () => {
  const harness = boot({ fetch: reachable, bidi: { reply: answers(READY) } });
  const results = await Promise.all([harness.LB.bidi.trustedInput(true), harness.LB.bidi.trustedInput(true), harness.LB.bidi.connect()]);
  assert.deepEqual(results.slice(0, 2).map((input) => input.mode), ["bidi", "bidi"]);
  assert.ok(results[2]);
  assert.equal(bidiSockets(harness).length, 1);
  assert.equal(bidiSockets(harness)[0].sent.filter((frame) => frame.method === "session.new").length, 1);
});

test("bidi.check skips the probe cache and broadcasts the answer", async () => {
  let up = false;
  const harness = boot({ fetch: () => (up ? reachable() : refused()), bidi: { reply: answers(READY) } });
  assert.equal((await send(harness, "status")).status.trustedInput.reason, "not_running");
  up = true;
  assert.equal((await send(harness, "status")).status.trustedInput.reason, "not_running");
  assert.equal(fetched(harness).length, 1);
  const response = await send(harness, "bidi.check");
  assert.equal(response.ok, true);
  assert.equal(response.status.trustedInput.mode, "bidi");
  assert.equal(fetched(harness).length, 2);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const broadcasts = harness.callsOf("runtime.sendMessage").map((call) => call[1]).filter((message) => message && message.channel === "lb-status");
  assert.ok(broadcasts.some((message) => message.status.trustedInput.mode === "bidi"));
});

test("a closed session socket is noticed by the next probe", async () => {
  const harness = boot({ fetch: reachable, bidi: { reply: answers(READY) } });
  assert.equal((await harness.LB.bidi.trustedInput()).mode, "bidi");
  bidiSockets(harness)[0].close();
  const again = await harness.LB.bidi.trustedInput();
  assert.equal(again.mode, "bidi");
  assert.equal(bidiSockets(harness).length, 2);
});

test("screenshots go through the open session without a second session.new", async () => {
  const harness = boot({
    fetch: reachable,
    bidi: {
      reply: answers({
        ...READY,
        "browsingContext.getTree": { contexts: [{ context: "ctx-1", url: TAB.url, children: [] }] },
        "browsingContext.captureScreenshot": { data: "QUJD" },
      }),
    },
  });
  assert.equal((await harness.LB.bidi.trustedInput()).mode, "bidi");
  assert.equal(await harness.LB.bidi.captureScreenshot(TAB), "data:image/png;base64,QUJD");
  const [socket] = bidiSockets(harness);
  assert.deepEqual(socket.sent.map((frame) => frame.method), ["session.status", "session.new", "browsingContext.getTree", "browsingContext.captureScreenshot"]);
});

test("the probe never asks for /json/version or /session over HTTP", async () => {
  const harness = boot({ fetch: reachable, bidi: { reply: answers(READY) } });
  await send(harness, "status");
  await send(harness, "bidi.set", { port: 9444 });
  await send(harness, "bidi.check");
  assert.ok(fetched(harness).length >= 2);
  for (const url of fetched(harness)) assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.deepEqual(bidiSockets(harness).map((socket) => socket.url), ["ws://127.0.0.1:9222/session", "ws://127.0.0.1:9444/session"]);
  assert.equal(bidiSockets(harness)[0].readyState, 3);
});
