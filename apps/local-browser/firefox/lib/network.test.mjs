import test from "node:test";
import assert from "node:assert/strict";

import { REQUIRED, bootBackground, flush } from "./harness.test.mjs";

const EVENTS = ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived", "onCompleted", "onErrorOccurred"];

function listenerCount(harness) {
  return EVENTS.reduce((sum, name) => sum + harness.webRequest[name].listeners.length, 0);
}

function request(harness, details) {
  const base = { requestId: "r1", tabId: 7, url: "https://api.test/data", method: "GET", type: "xmlhttprequest", originUrl: "https://example.test/", ...details };
  harness.webRequest.onBeforeRequest.fire(base);
  harness.webRequest.onBeforeSendHeaders.fire({
    ...base,
    requestHeaders: [
      { name: "Cookie", value: "sid=abc" },
      { name: "Authorization", value: "Bearer t" },
      { name: "X-Trace", value: "1" },
    ],
  });
  harness.webRequest.onHeadersReceived.fire({
    ...base,
    statusCode: 200,
    responseHeaders: [
      { name: "Content-Type", value: "application/json; charset=utf-8" },
      { name: "Set-Cookie", value: "a=1" },
      { name: "Set-Cookie", value: "b=2" },
      { name: "X-Custom", value: "kept" },
    ],
  });
  if (details.error) harness.webRequest.onErrorOccurred.fire({ ...base, error: details.error });
  else harness.webRequest.onCompleted.fire({ ...base, statusCode: 200, fromCache: true, ip: "203.0.113.9" });
}

async function list(harness, args = {}) {
  const outcome = await harness.call("local_browser_network", { op: "list", ...args });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.error));
  return outcome.result;
}

test("no webRequest listener exists until the user grants webRequest", async () => {
  const harness = bootBackground({ permissions: REQUIRED });
  await flush();
  assert.equal(listenerCount(harness), 0);
  harness.grant(["webRequest"]);
  await flush();
  assert.equal(harness.webRequest.onBeforeSendHeaders.listeners.length, 1);
  assert.deepEqual([...harness.webRequest.onBeforeSendHeaders.listeners[0].rest[1]], ["requestHeaders"]);
  assert.deepEqual([...harness.webRequest.onHeadersReceived.listeners[0].rest[1]], ["responseHeaders"]);
  assert.equal(harness.webRequest.onBeforeRequest.listeners[0].rest[1], undefined, "no blocking listener without webRequestBlocking");
});

test("revoking webRequest removes every listener", async () => {
  const harness = bootBackground();
  await flush();
  assert.equal(listenerCount(harness), 5);
  harness.revoke(["webRequest"]);
  await flush();
  assert.equal(listenerCount(harness), 0);
});

test("granting webRequestBlocking re-registers onBeforeRequest as blocking for body taps", async () => {
  const harness = bootBackground({ permissions: [...REQUIRED, "webRequest"] });
  await flush();
  harness.grant(["webRequestBlocking"]);
  await flush();
  assert.equal(harness.webRequest.onBeforeRequest.listeners.length, 1);
  assert.deepEqual([...harness.webRequest.onBeforeRequest.listeners[0].rest[1]], ["blocking"]);
  request(harness, {});
  assert.equal(harness.callsOf("webRequest.filterResponseData").length, 1);
});

test("without webRequestBlocking no response is ever filtered", async () => {
  const harness = bootBackground({ permissions: [...REQUIRED, "webRequest"] });
  await flush();
  request(harness, {});
  assert.equal(harness.callsOf("webRequest.filterResponseData").length, 0);
});

test("rows carry full request and response headers, cookie and auth flags, initiator, cache and ip", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, {});
  const result = await list(harness);
  assert.equal(result.requests.length, 1);
  const row = result.requests[0];
  assert.deepEqual(row.requestHeaders, { cookie: "sid=abc", authorization: "Bearer t", "x-trace": "1" });
  assert.equal(row.responseHeaders["set-cookie"], "a=1\nb=2");
  assert.equal(row.responseHeaders["x-custom"], "kept");
  assert.equal(row.hasCookie, true);
  assert.equal(row.hasAuthorization, true);
  assert.equal(row.initiator, "https://example.test/");
  assert.equal(row.fromCache, true);
  assert.equal(row.ip, "203.0.113.9");
  assert.equal(row.status, 200);
  assert.equal(row.mimeType, "application/json");
  assert.equal("documentId" in row, false, "firefox has no documentId");
  assert.equal(result.capture.mode, "continuous");
  assert.equal(typeof result.capture.since, "number");
});

test("includeHeaders false drops the header maps but keeps the flags", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, {});
  const row = (await list(harness, { includeHeaders: false })).requests[0];
  assert.equal("requestHeaders" in row, false);
  assert.equal("responseHeaders" in row, false);
  assert.equal(row.hasCookie, true);
});

test("a failed request reports its error", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, { requestId: "r9", error: "NS_ERROR_CONNECTION_REFUSED" });
  const row = (await list(harness)).requests[0];
  assert.equal(row.failed, true);
  assert.equal(row.error, "NS_ERROR_CONNECTION_REFUSED");
});

test("every resource type is captured and types filters with fetch and document aliases", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, { requestId: "a", type: "script", url: "https://cdn.test/app.js" });
  request(harness, { requestId: "b", type: "xmlhttprequest" });
  request(harness, { requestId: "c", type: "main_frame", url: "https://example.test/" });
  request(harness, { requestId: "d", type: "image", url: "https://cdn.test/a.png" });
  assert.equal((await list(harness)).requests.length, 4);
  assert.deepEqual((await list(harness, { types: ["fetch"] })).requests.map((row) => row.id), ["b"]);
  assert.deepEqual((await list(harness, { types: ["document", "script"] })).requests.map((row) => row.id), ["a", "c"]);
});

test("since keeps only requests that started at or after it", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, { requestId: "old" });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const cut = Date.now();
  request(harness, { requestId: "new" });
  assert.deepEqual((await list(harness, { since: cut })).requests.map((row) => row.id), ["new"]);
});

test("the ring follows the user's network buffer size, not a fixed 200", async () => {
  const harness = bootBackground();
  await flush();
  for (let index = 0; index < 600; index += 1) request(harness, { requestId: "q" + index });
  const all = await list(harness, { limit: 5000 });
  assert.equal(all.total, 600);
  assert.equal(all.requests.length, 600);
  await harness.control({ channel: "lb-control", op: "guards.set", patch: { networkBufferSize: 50 } });
  await flush();
  const shrunk = await list(harness, { limit: 5000 });
  assert.equal(shrunk.total, 50);
  assert.equal(shrunk.requests[0].id, "q550");
});

test("a list without a limit returns the contract default window", async () => {
  const harness = bootBackground();
  await flush();
  for (let index = 0; index < 250; index += 1) request(harness, { requestId: "q" + index });
  const result = await list(harness);
  assert.equal(result.requests.length, 200);
  assert.equal(result.total, 250);
});

test("clear empties the tab ring and moves the capture start", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, {});
  const cleared = await harness.call("local_browser_network", { op: "clear" });
  assert.equal(cleared.result.cleared, true);
  const after = await list(harness);
  assert.equal(after.requests.length, 0);
  assert.ok(after.capture.since >= cleared.result.capture.since - 5);
});

test("bodies are tapped with webRequestBlocking and returned only when asked", async () => {
  const harness = bootBackground({
    onFilter(requestId, filter) {
      queueMicrotask(() => {
        filter.ondata({ data: new TextEncoder().encode('{"ok":true}').buffer });
        filter.onstop();
      });
    },
  });
  await flush();
  harness.webRequest.onBeforeRequest.fire({ requestId: "b1", tabId: 7, url: "https://api.test/x", method: "POST", type: "xmlhttprequest" });
  harness.webRequest.onHeadersReceived.fire({ requestId: "b1", statusCode: 201, responseHeaders: [{ name: "content-type", value: "application/json" }] });
  await flush();
  harness.webRequest.onCompleted.fire({ requestId: "b1", statusCode: 201 });
  const withBodies = (await list(harness, { includeBodies: true })).requests[0];
  assert.equal(withBodies.body, '{"ok":true}');
  const without = (await list(harness)).requests[0];
  assert.equal("body" in without, false);
});

test("the network tool asks for webRequest and site access when they are missing", async () => {
  const harness = bootBackground({ permissions: REQUIRED, origins: [] });
  const { error } = await harness.call("local_browser_network", { op: "list" });
  assert.equal(error.code, "local_browser_permission_required");
  assert.deepEqual([...error.permissions].sort(), ["<all_urls>", "webRequest"]);
});

test("a tab's network info reports the last request and the count since its page loaded", async () => {
  const harness = bootBackground();
  await flush();
  request(harness, { requestId: "m", type: "main_frame", url: "https://example.test/" });
  request(harness, { requestId: "x" });
  const info = harness.LB.network.tabInfo(7);
  assert.equal(info.capturing, true);
  assert.equal(info.requestsSinceLoad, 2);
  assert.equal(typeof info.lastRequestAt, "number");
});
