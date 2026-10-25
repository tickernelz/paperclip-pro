import test from "node:test";
import assert from "node:assert/strict";

import { bootBackground } from "./harness.test.mjs";

const PAPERCLIP_ORIGIN = "https://p.test";

function boot(extraTabs = [], paperclipActive = true) {
  return bootBackground({
    storage: { "lb.pairing": { origin: PAPERCLIP_ORIGIN, label: "FF", sessionToken: "tok" } },
    tabs: [{ id: 7, url: PAPERCLIP_ORIGIN + "/", active: paperclipActive }, ...extraTabs],
  });
}

const created = (harness) => harness.callsOf("tabs.create").map((entry) => entry[1]);

test("open with a url uses a fresh tab and leaves the Paperclip tab alone", async () => {
  const harness = boot();
  const { result } = await harness.call("local_browser_open", { url: "https://example.test/page" });
  assert.equal(created(harness).length, 1);
  assert.equal(created(harness)[0].url, "https://example.test/page");
  assert.equal(harness.tabs.get(7).url, PAPERCLIP_ORIGIN + "/", "the Paperclip tab keeps its url");
  assert.equal(result.tab.tabId, 100);
  assert.equal(result.tab.cookieStoreId, "firefox-default");
});

test("navigate refuses the tab the user is looking at", async () => {
  const harness = boot([{ id: 8, url: "https://app.test/x", active: true }], false);
  const { error } = await harness.call("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test" });
  assert.equal(error.code, "local_browser_navigation_blocked");
  assert.match(error.message, /tab the user is looking at/);
  assert.match(error.hint, /local_browser_open/);
  assert.match(error.hint, /Agent guards/);
  assert.equal(harness.tabs.get(8).url, "https://app.test/x");
});

test("navigate refuses the Paperclip tab even when another tab is focused", async () => {
  const harness = boot([{ id: 9, url: "https://other.test/", active: true }], false);
  const { error } = await harness.call("local_browser_navigate", { tabId: 7, url: "https://elsewhere.test" });
  assert.equal(error.code, "local_browser_navigation_blocked");
  assert.match(error.message, /belongs to Paperclip/);
  assert.equal(harness.tabs.get(7).url, PAPERCLIP_ORIGIN + "/");
});

test("turning off the focused-tab guard lets the agent drive the tab the user is looking at", async () => {
  const harness = boot([{ id: 8, url: "https://app.test/x", active: true }], false);
  await harness.LB.guards.set({ protectFocusedTab: false });
  const { ok, result } = await harness.call("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test/" });
  assert.equal(ok, true);
  assert.equal(result.tab.url, "https://elsewhere.test/");
});

test("turning off the Paperclip guard lets the agent navigate the Paperclip tab", async () => {
  const harness = boot([{ id: 9, url: "https://other.test/", active: true }], false);
  await harness.LB.guards.set({ protectPaperclipTab: false });
  const { ok } = await harness.call("local_browser_navigate", { tabId: 7, url: "https://elsewhere.test/" });
  assert.equal(ok, true);
  assert.equal(harness.tabs.get(7).url, "https://elsewhere.test/");
});

test("the guard change made in another context reaches the background", async () => {
  const harness = boot([{ id: 8, url: "https://app.test/x", active: true }], false);
  await harness.browser.storage.local.set({ "lb.guards": { protectPaperclipTab: true, protectFocusedTab: false, networkBufferSize: 1000 } });
  const { ok } = await harness.call("local_browser_navigate", { tabId: 8, url: "https://elsewhere.test/" });
  assert.equal(ok, true);
});

test("opening a second url reuses the agent tab", async () => {
  const harness = boot();
  await harness.call("local_browser_open", { url: "https://example.test/one" });
  await harness.call("local_browser_open", { url: "https://example.test/two" });
  assert.equal(created(harness).length, 1, "one agent tab serves every open");
  assert.equal(harness.tabs.get(100).url, "https://example.test/two");
});

test("a tab the agent opened stays navigable", async () => {
  const harness = boot();
  await harness.call("local_browser_open", { url: "https://example.test/page" });
  const { result } = await harness.call("local_browser_navigate", { tabId: 100, url: "https://example.test/next" });
  assert.equal(result.tab.url, "https://example.test/next");
});
