import test from "node:test";
import assert from "node:assert/strict";

import "./frames.js";

const { tabsEvent, frameEvent, stateEvent, canSendFrame, cssPixels, cropRect, corroborateViewport } = globalThis.LB.frames;

const tab = { tabId: 7, windowId: 1, title: "Example", url: "https://example.test/", active: true, status: "complete" };

test("tabs events wrap the array in a tabs object", () => {
  const frame = tabsEvent([tab]);
  assert.deepEqual(frame, { type: "event", event: "tabs", data: { tabs: [tab] } });
  assert.equal(Array.isArray(frame.data), false);
});

test("tabs events never emit a bare array or undefined", () => {
  assert.deepEqual(tabsEvent(undefined), { type: "event", event: "tabs", data: { tabs: [] } });
  assert.deepEqual(tabsEvent([]), { type: "event", event: "tabs", data: { tabs: [] } });
});

test("frame events carry dataUrl, width, height and an optional tabId", () => {
  assert.deepEqual(frameEvent("data:image/jpeg;base64,AA", 1280, 720, 7), {
    type: "event",
    event: "frame",
    data: { dataUrl: "data:image/jpeg;base64,AA", width: 1280, height: 720, tabId: 7 },
  });
  assert.deepEqual(frameEvent("data:image/jpeg;base64,AA", 1280, 720), {
    type: "event",
    event: "frame",
    data: { dataUrl: "data:image/jpeg;base64,AA", width: 1280, height: 720 },
  });
});

test("state events carry only state, tabId and message", () => {
  assert.deepEqual(stateEvent("connected", 7), { type: "event", event: "state", data: { state: "connected", tabId: 7 } });
  assert.deepEqual(stateEvent("disconnected"), { type: "event", event: "state", data: { state: "disconnected" } });
  const withMessage = stateEvent("viewer_unavailable", 7, "capture failed");
  assert.deepEqual(withMessage.data, { state: "viewer_unavailable", tabId: 7, message: "capture failed" });
  assert.equal("streaming" in withMessage.data, false);
});

test("state messages are capped at 400 characters", () => {
  const frame = stateEvent("viewer_unavailable", 1, "x".repeat(600));
  assert.equal(frame.data.message.length, 400);
});

test("viewer frame width equals the CSS viewport width when dpr is 2", () => {
  const size = cssPixels(2560, 1600, 2);
  assert.equal(size.width, 1280);
  assert.equal(size.height, 800);
  assert.equal(size.dpr, 2);
});

test("dpr 1 keeps the bitmap size unchanged", () => {
  assert.deepEqual(cssPixels(1280, 800, 1), { width: 1280, height: 800, dpr: 1, source: "bitmap" });
});

test("a fractional dpr rounds to whole CSS pixels", () => {
  const size = cssPixels(2879, 1799, 1.5);
  assert.equal(size.width, 1919);
  assert.equal(size.height, 1199);
});

test("a missing or nonsense dpr is treated as 1", () => {
  assert.equal(cssPixels(1280, 800, undefined).width, 1280);
  assert.equal(cssPixels(1280, 800, 0).width, 1280);
  assert.equal(cssPixels(1280, 800, -2).width, 1280);
  assert.equal(cssPixels(1280, 800, Number.NaN).width, 1280);
});

test("an empty bitmap yields a zero size instead of a bogus one", () => {
  assert.deepEqual(cssPixels(0, 0, 2), { width: 0, height: 0, dpr: 2, source: "bitmap" });
});

test("a dpr-scaled frame still passes the frozen frame check", () => {
  const size = cssPixels(2560, 1600, 2);
  assert.equal(canSendFrame("data:image/jpeg;base64,AA", size.width, size.height), true);
});

test("an element fully inside the viewport crops to its own box", () => {
  assert.deepEqual(cropRect({ x: 10, y: 20, width: 100, height: 40 }, 2, 2560, 1600), { x: 20, y: 40, width: 200, height: 80 });
});

test("an element running past the viewport is clamped in extent, not just offset", () => {
  assert.deepEqual(cropRect({ x: 1200, y: 760, width: 400, height: 200 }, 2, 2560, 1600), {
    x: 2400,
    y: 1520,
    width: 160,
    height: 80,
  });
});

test("an element off the viewport yields no crop instead of a blank 1x1", () => {
  assert.equal(cropRect({ x: 5000, y: 5000, width: 100, height: 100 }, 2, 2560, 1600), null);
});

test("a zero-size element yields no crop", () => {
  assert.equal(cropRect({ x: 10, y: 10, width: 0, height: 40 }, 1, 1280, 800), null);
});

test("a missing dpr is treated as 1 when cropping", () => {
  assert.deepEqual(cropRect({ x: 5, y: 5, width: 10, height: 10 }, undefined, 100, 100), {
    x: 5,
    y: 5,
    width: 10,
    height: 10,
  });
});

test("a viewport mismatch overrides a wrong dpr instead of advertising device pixels", () => {
  const size = cssPixels(1600, 1200, 1, { width: 800, height: 600 });
  assert.equal(size.width, 800);
  assert.equal(size.height, 600);
  assert.equal(size.source, "viewport");
});

test("the corrected size matches the normal dpr 2 path", () => {
  const corrected = cssPixels(1600, 1200, 1, { width: 800, height: 600 });
  const normal = cssPixels(1600, 1200, 2, { width: 800, height: 600 });
  assert.equal(corrected.width, normal.width);
  assert.equal(corrected.height, normal.height);
  assert.equal(normal.width, 800);
  assert.equal(normal.source, "bitmap");
});

test("a one pixel difference is tolerated and keeps the bitmap derivation", () => {
  const size = cssPixels(1602, 1201, 2, { width: 800, height: 600 });
  assert.equal(size.source, "bitmap");
  assert.equal(size.width, 801);
});

test("a two pixel difference is not tolerated", () => {
  const size = cssPixels(1606, 1200, 2, { width: 800, height: 600 });
  assert.equal(size.source, "viewport");
  assert.equal(size.width, 800);
});

test("without a viewport the bitmap derivation still runs", () => {
  const size = cssPixels(1600, 1200, 2, null);
  assert.equal(size.width, 800);
  assert.equal(size.source, "bitmap");
});

test("an injected viewport that agrees with the bitmap is trusted", () => {
  assert.deepEqual(corroborateViewport(1600, 1200, { width: 800, height: 600, dpr: 2 }), {
    width: 800,
    height: 600,
    dpr: 2,
  });
});

test("an injected viewport that claims device pixels is rejected", () => {
  assert.equal(corroborateViewport(1600, 1200, { width: 1600, height: 1200, dpr: 1 }), null);
});

test("an injected viewport with a nonsense dpr is rejected", () => {
  assert.equal(corroborateViewport(1600, 1200, { width: 800, height: 600, dpr: 0 }), null);
  assert.equal(corroborateViewport(1600, 1200, { width: 800, height: 600 }), null);
});

test("an injected viewport with no size is rejected", () => {
  assert.equal(corroborateViewport(1600, 1200, { width: 0, height: 0, dpr: 2 }), null);
  assert.equal(corroborateViewport(1600, 1200, null), null);
});

test("a one pixel disagreement is still corroborated", () => {
  assert.equal(corroborateViewport(1602, 1201, { width: 800, height: 600, dpr: 2 }).width, 800);
});

test("a lying page cannot choose the coordinate space", () => {
  const lie = { width: 1600, height: 1200, dpr: 1 };
  assert.equal(corroborateViewport(1600, 1200, lie), null, "claiming the bitmap size as CSS pixels must fail");
});

test("canSendFrame rejects frames the frozen schema would refuse", () => {
  assert.equal(canSendFrame("data:image/png;base64,AA", 10, 10), true);
  assert.equal(canSendFrame("data:image/png;base64,AA", 0, 10), false);
  assert.equal(canSendFrame("data:image/png;base64,AA", 10, null), false);
  assert.equal(canSendFrame("data:image/png;base64,AA", 10.5, 10), false);
  assert.equal(canSendFrame("https://example.test/a.png", 10, 10), false);
});
