import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));

function createClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map();

  function schedule(fn, delay, repeat) {
    const id = seq;
    seq += 1;
    timers.set(id, { fn, at: now + Math.max(0, delay || 0), repeat: repeat ? Math.max(1, delay || 1) : null });
    return id;
  }

  return {
    now: () => now,
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const target = now + ms;
      for (let guard = 0; guard < 100000; guard += 1) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, timer] of timers) {
          if (timer.at < nextAt) {
            nextAt = timer.at;
            nextId = id;
          }
        }
        if (nextId === null || nextAt > target) break;
        now = nextAt;
        const timer = timers.get(nextId);
        if (timer.repeat === null) timers.delete(nextId);
        else timer.at = now + timer.repeat;
        timer.fn();
      }
      now = target;
    },
  };
}

function boot() {
  const clock = createClock();
  const sockets = [];
  const storage = new Map();

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(payload) {
      this.sent.push(JSON.parse(payload));
    }
    close(code, reason) {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: typeof code === "number" ? code : 1006, reason: reason || "" });
    }
    open() {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    deliver(frame) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) });
    }
  }
  FakeSocket.OPEN = 1;

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(clock.now());
      else super(...args);
    }
    static now() {
      return clock.now();
    }
  }

  const browser = {
    runtime: {
      getManifest: () => ({ version: manifest.version }),
      getPlatformInfo: async () => ({ os: "linux" }),
      onMessage: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      sendMessage: async () => undefined,
    },
    storage: {
      local: {
        get: async (key) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
        set: async (value) => Object.entries(value).forEach(([k, v]) => storage.set(k, v)),
        remove: async (key) => storage.delete(key),
      },
    },
    browserAction: { setBadgeBackgroundColor: async () => undefined, setBadgeText: async () => undefined },
    tabs: {
      query: async () => [{ id: 7, windowId: 1, title: "t", url: "https://example.test/", active: true, status: "complete" }],
      get: async (id) => ({ id, windowId: 1, title: "t", url: "https://example.test/", active: true, status: "complete" }),
      onCreated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      onActivated: { addListener: () => {} },
      sendMessage: async () => ({ ok: true, result: {} }),
      captureVisibleTab: async () => "data:image/png;base64,AAA",
      update: async () => undefined,
      remove: async () => undefined,
    },
    webRequest: {
      onBeforeRequest: { addListener: () => {} },
      onHeadersReceived: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
      filterResponseData: () => ({}),
    },
    cookies: { getAll: async () => [], set: async () => ({}), remove: async () => ({}) },
    downloads: { search: async () => [] },
    scripting: { executeScript: async () => [] },
    windows: { update: async () => undefined },
    profiles: { getProfileName: async () => "work" },
  };

  const sandbox = {
    browser,
    console,
    Date: FakeDate,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    btoa,
    atob,
    WebSocket: FakeSocket,
    fetch: async () => {
      throw new Error("offline");
    },
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of manifest.background.scripts) {
    runInContext(readFileSync(root + file, "utf8"), sandbox, { filename: file });
  }
  return { sandbox, clock, sockets, storage };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function pairAndAck(harness) {
  const { sandbox, clock, sockets } = harness;
  await flush();
  await sandbox.LB.bridge.pair({ origin: "https://app.example", code: "ABC12345", label: "Work" });
  const socket = sockets[sockets.length - 1];
  socket.open();
  await flush();
  socket.deliver({
    type: "hello_ack",
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionToken: "tok",
    tier: "refine",
    allowedOrigins: [],
  });
  await flush();
  clock.advance(1);
  return socket;
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
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "unpaired");
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
  assert.equal(state.status, "unpaired");
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
  assert.equal(state.status, "unpaired");
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
  assert.equal(state.status, "unpaired", "a dead code must not leave the popup on connecting");
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
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "unpaired", "one failure must still retry");

  const second = harness.sockets[harness.sockets.length - 1];
  second.close(1006, "upgrade rejected");
  await flush();
  harness.clock.advance(60000);
  await flush();
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "unpaired", "two failures must still retry");

  const third = harness.sockets[harness.sockets.length - 1];
  third.close(1006, "upgrade rejected");
  await flush();
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "unpaired", "three failures retire the code");
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
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "unpaired");
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
  assert.equal(harness.sandbox.LB.bridge.snapshotState().status, "unpaired");

  await harness.sandbox.LB.bridge.pair({ origin: "https://app.example", code: "GOODCODE", label: "Work" });
  await flush();
  const fresh = harness.sockets[harness.sockets.length - 1];
  assert.match(fresh.url, /\?code=GOODCODE/);
  assert.notEqual(harness.sandbox.LB.bridge.snapshotState().status, "unpaired");
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

  const response = await harness.sandbox.LB.bridge.control({ op: "status" });
  assert.equal(response.pairing.hasToken, false);
  assert.equal(typeof response.pairing.retiredAt, "string");
  assert.equal(response.pairing.retiredReason, "session token is not usable");
  assert.equal(response.pairing.origin, "https://app.example");
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
