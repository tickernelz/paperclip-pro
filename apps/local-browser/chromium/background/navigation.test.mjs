import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./harness.test.mjs";

const UNGUARDED = { protectPaperclipTab: false, protectFocusedTab: false, networkBufferSize: 1000 };

function historyPage(entries, startIndex) {
  const state = { index: startIndex, origin: 1 };
  return {
    state,
    executeScript: async (injection) => {
      if (Array.isArray(injection.args) && typeof injection.args[0] === "number") {
        const next = state.index + injection.args[0];
        if (next >= 0 && next < entries.length) {
          state.index = next;
          state.origin += 1;
        }
        return [{ result: undefined }];
      }
      return [{ result: state.origin + " " + entries[state.index] }];
    },
  };
}

test("back falls back to the page history when Chrome skips entries the user never touched", async () => {
  const page = historyPage(["https://a.test/", "https://b.test/"], 1);
  const context = await boot({ tab: { active: false, url: "https://b.test/" }, executeScript: page.executeScript, storage: { "lb.guards": UNGUARDED } });
  context.api.tabs.goBack = async () => {
    throw new Error("Cannot find a next page in history.");
  };
  const result = await context.call("local_browser_navigate", { tabId: 7, back: true });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.equal(page.state.index, 0);
});

test("back with no earlier page reports navigation_blocked instead of a silent success", async () => {
  const page = historyPage(["https://only.test/"], 0);
  const context = await boot({ tab: { active: false, url: "https://only.test/" }, executeScript: page.executeScript, storage: { "lb.guards": UNGUARDED } });
  context.api.tabs.goBack = async () => {
    throw new Error("Cannot find a next page in history.");
  };
  const result = await context.call("local_browser_navigate", { tabId: 7, back: true }, { waitMs: 8000 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "local_browser_navigation_blocked");
  assert.match(result.error.message, /no page to go back/);
});
