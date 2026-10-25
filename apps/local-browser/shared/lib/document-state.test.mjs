import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { event, libDir, loadShared } from "./test-ext.mjs";

function target() {
  const handlers = {};
  return {
    handlers,
    addEventListener(name, fn) {
      (handlers[name] ||= []).push(fn);
    },
    dispatch(name, payload = {}) {
      for (const fn of handlers[name] || []) fn(payload);
    },
  };
}

function setup({ navigation = "navigate", resources = [], observer = false, document = {} } = {}) {
  const win = target();
  const doc = Object.assign(target(), { readyState: "complete", visibilityState: "visible", URL: "https://a.test/" }, document);
  const observed = event();
  const globals = {
    document: doc,
    location: { href: "https://a.test/page" },
    performance: {
      timeOrigin: Date.now() - 5000,
      getEntriesByType: (type) => (type === "navigation" ? [{ type: navigation }] : resources),
    },
    crypto: { randomUUID: () => "uuid-1" },
    addEventListener: win.addEventListener,
  };
  if (observer) {
    globals.PerformanceObserver = class {
      constructor(callback) {
        observed.addListener((entries) => callback({ getEntries: () => entries }));
      }
      observe() {}
    };
  }
  const sandbox = loadShared(["lib/document-state.js"], { globals });
  return { LB: sandbox.LB, win, doc, observed, sandbox };
}

test("a fresh document reads every schema field", () => {
  const { LB } = setup({ resources: [{ initiatorType: "script" }, { initiatorType: "fetch" }, { initiatorType: "xmlhttprequest" }] });
  const state = LB.documentState.read();
  assert.deepEqual(Object.keys(state).sort(), [
    "ageMs", "documentId", "loadedAt", "navigationType", "prerendering", "readyState", "requestsSinceLoad",
    "restoredFromBfcache", "stale", "staleReasons", "url", "visibilityState", "wasDiscarded", "xhrSinceLoad",
  ].sort());
  assert.equal(state.documentId, "uuid-1");
  assert.equal(state.url, "https://a.test/page");
  assert.equal(state.navigationType, "navigate");
  assert.equal(state.requestsSinceLoad, 3);
  assert.equal(state.xhrSinceLoad, 2);
  assert.equal(state.stale, false);
  assert.ok(state.ageMs >= 5000);
});

test("bfcache restore flags the capture stale and reads back_forward", () => {
  const { LB, win } = setup();
  win.dispatch("pagehide", { persisted: true });
  assert.deepEqual([...LB.documentState.read().staleReasons], ["page_hidden"]);
  win.dispatch("pageshow", { persisted: true });
  const state = LB.documentState.read();
  assert.equal(state.restoredFromBfcache, true);
  assert.equal(state.navigationType, "back_forward");
  assert.equal(state.stale, true);
  assert.deepEqual([...state.staleReasons], ["restored_from_bfcache"]);
});

test("freeze and resume toggle the frozen reason", () => {
  const { LB, doc } = setup();
  doc.dispatch("freeze");
  assert.deepEqual([...LB.documentState.read().staleReasons], ["frozen"]);
  doc.dispatch("resume");
  assert.equal(LB.documentState.read().stale, false);
});

test("discarded and prerendering documents are reported", () => {
  const { LB } = setup({ navigation: "prerender", document: { wasDiscarded: true, prerendering: true } });
  const state = LB.documentState.read();
  assert.equal(state.wasDiscarded, true);
  assert.equal(state.prerendering, true);
  assert.equal(state.navigationType, "prerender");
  assert.deepEqual([...state.staleReasons], ["prerendering"]);
});

test("unknown navigation types read unknown", () => {
  assert.equal(setup({ navigation: "weird" }).LB.documentState.read().navigationType, "unknown");
});

test("a PerformanceObserver counts requests past the resource buffer", () => {
  const { LB, observed } = setup({ observer: true });
  observed.fire([{ initiatorType: "fetch" }, { initiatorType: "img" }]);
  observed.fire([{ initiatorType: "xmlhttprequest" }]);
  const state = LB.documentState.read();
  assert.equal(state.requestsSinceLoad, 3);
  assert.equal(state.xhrSinceLoad, 2);
});

test("loading the script twice keeps the first document id", () => {
  const { sandbox } = setup();
  sandbox.crypto.randomUUID = () => "uuid-2";
  new vm.Script(readFileSync(path.join(libDir, "document-state.js"), "utf8")).runInContext(sandbox);
  assert.equal(sandbox.LB.documentState.read().documentId, "uuid-1");
});
