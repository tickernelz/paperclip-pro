import test from "node:test";
import assert from "node:assert/strict";

import { REQUIRED, bootBackground, flush, plain } from "./harness.test.mjs";

function fireInstalled(harness, reason) {
  const results = harness.browser.runtime.onInstalled.fire({ reason });
  return flush().then(() => results);
}

const opened = (harness) => harness.callsOf("tabs.create").map((entry) => plain(entry[1]).url);

test("a fresh install opens the control center on the welcome section", async () => {
  const harness = bootBackground({ permissions: REQUIRED, origins: [] });
  await fireInstalled(harness, "install");
  assert.deepEqual(opened(harness), ["moz-extension://uuid/ui/control.html#welcome"]);
});

test("an update without full site access opens the welcome section again", async () => {
  const harness = bootBackground({ permissions: REQUIRED, origins: [] });
  await fireInstalled(harness, "update");
  assert.deepEqual(opened(harness), ["moz-extension://uuid/ui/control.html#welcome"]);
});

test("an update with full site access stays quiet", async () => {
  const harness = bootBackground();
  await fireInstalled(harness, "update");
  assert.deepEqual(opened(harness), []);
});

test("a browser update does not open anything", async () => {
  const harness = bootBackground({ permissions: REQUIRED, origins: [] });
  await fireInstalled(harness, "browser_update");
  assert.deepEqual(opened(harness), []);
});

test("an unpaired browser paints the attention badge when nothing is pending", async () => {
  const harness = bootBackground();
  await flush();
  assert.ok(harness.callsOf("badge.text").some((entry) => entry[1] === "!"));
});
