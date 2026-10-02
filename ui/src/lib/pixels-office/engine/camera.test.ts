import { describe, expect, it } from "vitest";
import { Camera } from "./camera";

function camera(dpr: number): Camera {
  const instance = new Camera(2000, 400);
  instance.setViewport(800, 600, dpr);
  return instance;
}

describe("Camera zoom", () => {
  it("keeps zoom integral and clamped between the device floor and six times it", () => {
    const instance = camera(2);
    instance.setZoom(1);
    expect(instance.zoom).toBe(2);

    instance.zoomAt(400, 300, 50);
    expect(instance.zoom).toBe(12);

    instance.zoomAt(400, 300, -50);
    expect(instance.zoom).toBe(2);

    instance.zoomAt(400, 300, 1.7);
    expect(instance.zoom).toBe(3);
  });

  it("uses a device floor of one when the display is not high density", () => {
    const instance = camera(1);
    instance.zoomAt(400, 300, -10);
    expect(instance.zoom).toBe(1);
    instance.zoomAt(400, 300, 99);
    expect(instance.zoom).toBe(6);
  });

  it("holds the world point under the cursor while zooming", () => {
    const instance = camera(1);
    instance.setZoom(2);
    const before = (200 * instance.dpr - instance.offsetX) / instance.zoom;
    instance.zoomAt(200, 150, 2);
    const after = (200 * instance.dpr - instance.offsetX) / instance.zoom;
    expect(after).toBeCloseTo(before, 1);
  });
});

describe("Camera panning", () => {
  it("clamps the viewport inside the world and keeps an axis smaller than the viewport fully visible", () => {
    const instance = camera(1);
    instance.setZoom(1);
    instance.panBy(-10000, -10000);
    expect(instance.centerX).toBeCloseTo(2000 - 400);
    expect(instance.offsetY).toBeGreaterThanOrEqual(0);
    expect(instance.offsetY + 400 * instance.zoom).toBeLessThanOrEqual(instance.viewportHeight);

    instance.panBy(10000, 10000);
    expect(instance.centerX).toBeCloseTo(400);
    expect(instance.offsetY).toBeGreaterThanOrEqual(0);
    expect(instance.offsetY + 400 * instance.zoom).toBeLessThanOrEqual(instance.viewportHeight);
  });

  it("zooms one step further when that crops the room by at most a sixth", () => {
    const instance = new Camera(2000, 2000);
    instance.setViewport(860, 644, 2);
    instance.fitRoom({ col: 0, row: 0, cols: 20, rows: 12 });
    expect(instance.zoom).toBe(3);
  });

  it("keeps the whole room visible when the next zoom step would crop it noticeably", () => {
    const instance = new Camera(2000, 2000);
    instance.setViewport(800, 600, 1);
    instance.fitRoom({ col: 0, row: 0, cols: 30, rows: 30 });
    expect(instance.zoom).toBe(1);
  });

  it("centres a room even when the whole world height fits in the viewport", () => {
    const instance = camera(1);
    instance.fitRoom({ col: 0, row: 0, cols: 50, rows: 40 });
    expect(instance.zoom).toBe(1);
    expect(instance.centerY).toBeCloseTo(300);
    expect(instance.offsetY).toBe(0);
  });

  it("stops following when the user pans", () => {
    const instance = camera(1);
    instance.follow("agent-1");
    instance.panBy(5, 5);
    expect(instance.followAgentId).toBeNull();
  });
});

describe("Camera tween", () => {
  it("settles on the centerOn target and then reports no further movement", () => {
    const instance = camera(1);
    instance.setZoom(1);
    instance.centerOn(900, 200);
    let moving = true;
    for (let i = 0; i < 200 && moving; i++) moving = instance.update(1 / 30, null, null);
    expect(moving).toBe(false);
    expect(instance.centerX).toBeCloseTo(900);
    expect(instance.update(1 / 30, null, null)).toBe(false);
  });
});
