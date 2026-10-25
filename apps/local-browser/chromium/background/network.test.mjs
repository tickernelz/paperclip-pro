import test from "node:test";
import assert from "node:assert/strict";
import { boot, everyPermission, flush, sleep } from "./harness.test.mjs";

function fire(context, name, details) {
  context.api.webRequest[name].fire(details);
}

function request(context, id, extra = {}) {
  const at = extra.timeStamp || Date.now();
  fire(context, "onBeforeRequest", {
    requestId: id,
    url: extra.url || "https://api.test/items?id=" + id,
    method: extra.method || "GET",
    type: extra.type || "xmlhttprequest",
    tabId: extra.tabId === undefined ? 7 : extra.tabId,
    frameId: 0,
    documentId: "DOC-" + id,
    initiator: "https://p.test",
    timeStamp: at,
  });
  fire(context, "onBeforeSendHeaders", {
    requestId: id,
    requestHeaders: [
      { name: "Cookie", value: "sid=abc" },
      { name: "Authorization", value: "Bearer token" },
      { name: "Accept", value: "application/json" },
    ],
  });
  fire(context, "onHeadersReceived", {
    requestId: id,
    statusCode: extra.status || 200,
    responseHeaders: [
      { name: "Content-Type", value: "application/json; charset=utf-8" },
      { name: "Set-Cookie", value: "a=1" },
      { name: "Set-Cookie", value: "b=2" },
    ],
  });
  if (extra.error) fire(context, "onErrorOccurred", { requestId: id, error: extra.error, timeStamp: at + 10 });
  else fire(context, "onCompleted", { requestId: id, statusCode: extra.status || 200, fromCache: false, ip: "10.0.0.1", timeStamp: at + 25 });
}

test("webRequest listeners ask for extra headers on both directions", async () => {
  const context = await boot();
  assert.deepEqual([...context.api.webRequest.onBeforeSendHeaders.extras[0]], ["requestHeaders", "extraHeaders"]);
  assert.deepEqual([...context.api.webRequest.onHeadersReceived.extras[0]], ["responseHeaders", "extraHeaders"]);
  assert.equal(context.api.webRequest.onBeforeRequest.listeners.length, 1);
  assert.equal(context.api.webRequest.onCompleted.listeners.length, 1);
  assert.equal(context.api.webRequest.onErrorOccurred.listeners.length, 1);
});

test("continuous capture returns request and response headers with the cookie and auth flags", async () => {
  const context = await boot();
  await flush(10);
  request(context, "1");
  const result = await context.call("local_browser_network", { tabId: 7, op: "list" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.capture.mode, "continuous");
  assert.equal(typeof result.result.capture.since, "number");
  assert.equal(result.result.total, 1);
  const row = result.result.requests[0];
  assert.equal(row.url, "https://api.test/items?id=1");
  assert.equal(row.method, "GET");
  assert.equal(row.status, 200);
  assert.equal(row.type, "xmlhttprequest");
  assert.equal(row.durationMs, 25);
  assert.equal(row.documentId, "DOC-1");
  assert.equal(row.frameId, 0);
  assert.equal(row.initiator, "https://p.test");
  assert.equal(row.fromCache, false);
  assert.equal(row.ip, "10.0.0.1");
  assert.equal(row.mimeType, "application/json");
  assert.equal(row.hasCookie, true);
  assert.equal(row.hasAuthorization, true);
  assert.equal(row.requestHeaders.cookie, "sid=abc");
  assert.equal(row.requestHeaders.authorization, "Bearer token");
  assert.equal(row.responseHeaders["set-cookie"], "a=1\nb=2");
  assert.equal(context.callsOf("debugger.attach").length, 0, "continuous capture never needs the debugger");
});

test("includeHeaders false leaves the headers out but keeps the flags", async () => {
  const context = await boot();
  request(context, "1");
  const result = await context.call("local_browser_network", { tabId: 7, op: "list", includeHeaders: false });
  const row = result.result.requests[0];
  assert.equal("requestHeaders" in row, false);
  assert.equal("responseHeaders" in row, false);
  assert.equal(row.hasCookie, true);
});

test("list filters by tab, since, method, url, types and limit", async () => {
  const context = await boot();
  const now = Date.now();
  request(context, "old", { timeStamp: now - 60000 });
  request(context, "doc", { type: "main_frame", url: "https://p.test/", timeStamp: now });
  request(context, "post", { method: "POST", url: "https://api.test/save", timeStamp: now + 1 });
  request(context, "other", { tabId: 9, timeStamp: now + 2 });
  request(context, "failed", { error: "net::ERR_FAILED", timeStamp: now + 3 });
  const recent = await context.call("local_browser_network", { tabId: 7, op: "list", since: now });
  assert.deepEqual(recent.result.requests.map((row) => row.documentId), ["DOC-doc", "DOC-post", "DOC-failed"]);
  const posts = await context.call("local_browser_network", { tabId: 7, op: "list", method: "post" });
  assert.deepEqual(posts.result.requests.map((row) => row.url), ["https://api.test/save"]);
  const documents = await context.call("local_browser_network", { tabId: 7, op: "list", types: ["document"] });
  assert.deepEqual(documents.result.requests.map((row) => row.documentId), ["DOC-doc"]);
  const fetches = await context.call("local_browser_network", { tabId: 7, op: "list", types: ["fetch"], urlIncludes: "items" });
  assert.deepEqual(fetches.result.requests.map((row) => row.documentId), ["DOC-old", "DOC-failed"]);
  assert.equal(fetches.result.requests[1].error, "net::ERR_FAILED");
  const limited = await context.call("local_browser_network", { tabId: 7, op: "list", limit: 2 });
  assert.equal(limited.result.total, 4);
  assert.deepEqual(limited.result.requests.map((row) => row.documentId), ["DOC-post", "DOC-failed"]);
});

test("the ring keeps only guards.networkBufferSize requests", async () => {
  const context = await boot();
  await context.control("guards.set", { patch: { networkBufferSize: 50 } });
  for (let index = 0; index < 70; index += 1) request(context, "r" + index);
  const result = await context.call("local_browser_network", { tabId: 7, op: "list", limit: 5000 });
  assert.equal(result.result.total, 50);
  assert.equal(result.result.requests[0].documentId, "DOC-r20");
});

test("clear forgets the tab's requests", async () => {
  const context = await boot({ tabs: [{ id: 9, windowId: 1, title: "N", url: "https://n.test/", active: false, status: "complete" }] });
  request(context, "1");
  request(context, "2", { tabId: 9 });
  const cleared = await context.call("local_browser_network", { tabId: 7, op: "clear" });
  assert.equal(cleared.result.cleared, true);
  const mine = await context.call("local_browser_network", { tabId: 7, op: "list" });
  assert.equal(mine.result.total, 0);
  const theirs = await context.call("local_browser_network", { tabId: 9, op: "list" });
  assert.equal(theirs.result.total, 1);
});

test("context reports capture state and requests since the last load", async () => {
  const context = await boot();
  const now = Date.now();
  request(context, "before", { timeStamp: now - 1000 });
  request(context, "doc", { type: "main_frame", timeStamp: now });
  request(context, "after", { timeStamp: now + 5 });
  const result = await context.call("local_browser_context", { tabId: 7, cookies: false });
  assert.equal(result.result.network.capturing, true);
  assert.equal(result.result.network.requestsSinceLoad, 2);
  assert.equal(result.result.network.lastRequestAt, now + 5);
});

test("without webRequest the tool falls back to a debugger window and asks for the permission", async () => {
  const granted = everyPermission();
  let context;
  context = await boot({
    withoutWebRequest: true,
    granted: { permissions: granted.permissions.filter((id) => id !== "webRequest"), origins: granted.origins },
    onCommand: (method) => {
      if (method !== "Network.enable") return;
      setTimeout(() => {
        context.api.debugger.onEvent.fire({ tabId: 7 }, "Network.requestWillBeSent", {
          requestId: "c1",
          request: { url: "https://api.test/live", method: "GET", headers: { Cookie: "sid=1" } },
          type: "XHR",
          wallTime: Date.now() / 1000,
          timestamp: 1,
        });
        context.api.debugger.onEvent.fire({ tabId: 7 }, "Network.responseReceived", {
          requestId: "c1",
          response: { status: 201, mimeType: "application/json", headers: { "Content-Type": "application/json" } },
        });
        context.api.debugger.onEvent.fire({ tabId: 7 }, "Network.loadingFinished", { requestId: "c1", timestamp: 1.05 });
      }, 20);
    },
  });
  const result = await context.call("local_browser_network", { tabId: 7, op: "list" });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(result.result.capture.mode, "window");
  assert.equal(result.result.capture.windowMs, 1200);
  assert.match(result.result.note, /webRequest/);
  const row = result.result.requests[0];
  assert.equal(row.status, 201);
  assert.equal(row.type, "xmlhttprequest");
  assert.equal(row.hasCookie, true);
  assert.equal(row.requestHeaders.cookie, "sid=1");
  assert.equal(row.responseHeaders["content-type"], "application/json");
  assert.equal(row.durationMs, 50);
  assert.equal(context.stored["lb.pending"].some((entry) => entry.permission === "webRequest"), true);
  assert.equal(context.callsOf("debugger.attach").length, 1);
  assert.equal(context.callsOf("debugger.detach").length, 1, "the window releases the debugger it borrowed");
});

test("includeBodies attaches the debugger on demand and returns bodies for requests it saw", async () => {
  const context = await boot({
    onCommand: (method, params) => (method === "Network.getResponseBody" ? { body: "payload-" + params.requestId, base64Encoded: false } : undefined),
  });
  const first = await context.call("local_browser_network", { tabId: 7, op: "list", includeBodies: true });
  assert.equal(first.ok, true, JSON.stringify(first.error || {}));
  assert.match(first.result.note, /recorded from now on/);
  assert.equal(context.callsOf("debugger.attach").length, 1);
  const now = Date.now();
  request(context, "9", { url: "https://api.test/body", timeStamp: now });
  context.api.debugger.onEvent.fire({ tabId: 7 }, "Network.requestWillBeSent", {
    requestId: "cdp-9",
    request: { url: "https://api.test/body", method: "GET", headers: {} },
    type: "XHR",
    wallTime: now / 1000,
    timestamp: 5,
  });
  context.api.debugger.onEvent.fire({ tabId: 7 }, "Network.loadingFinished", { requestId: "cdp-9", timestamp: 5.1 });
  const second = await context.call("local_browser_network", { tabId: 7, op: "list", includeBodies: true });
  const row = second.result.requests.find((entry) => entry.url === "https://api.test/body");
  assert.equal(row.body, "payload-cdp-9");
  assert.equal(row.bodyBase64, undefined);
  assert.equal(context.callsOf("debugger.attach").length, 1, "the body session stays attached between calls");
  await sleep(5);
});
