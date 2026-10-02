import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  combineLayouts,
  loadPixelAssets,
  TARGET_SEAT_CAPACITY,
  type OfficeCameraBounds,
} from "./assetLoader";
import { buildDynamicCatalog, type LoadedAssetData } from "./layout/furnitureCatalog";
import { layoutToSeats } from "./layout/layoutSerializer";
import { OFFICE_OBJECT_FURNITURE } from "./officeModel";
import type { OfficeLayout } from "./types";

function readJson<T>(relative: string): T {
  const url = new URL(`../../../public/pixels/${relative}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

interface AssetIndexFixture {
  furniture: LoadedAssetData["catalog"];
}

function buildCombined(): { layout: OfficeLayout; cameraBounds: OfficeCameraBounds } {
  const index = readJson<AssetIndexFixture>("pixels-office-assets.json");
  const sprites: LoadedAssetData["sprites"] = {};
  for (const asset of index.furniture) sprites[asset.id] = [["#ffffff"]];
  expect(buildDynamicCatalog({ catalog: index.furniture, sprites })).toBe(true);
  return combineLayouts(
    readJson<OfficeLayout>("default-layout-1.json"),
    readJson<OfficeLayout>("agent-pixels-layout-boardroom-kitchen.json"),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPixelAssets", () => {
  it("names the failing url and retries after a rejection", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPixelAssets()).rejects.toThrow(
      "Failed to fetch /pixels/pixels-office-assets.json",
    );
    const afterFirst = fetchMock.mock.calls.length;

    await expect(loadPixelAssets()).rejects.toThrow(
      "Failed to fetch /pixels/pixels-office-assets.json",
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe("combineLayouts", () => {
  it("adds overflow rooms until the office seats the whole agent target", () => {
    const { layout, cameraBounds } = buildCombined();
    expect(layoutToSeats(layout.furniture).size).toBeGreaterThanOrEqual(TARGET_SEAT_CAPACITY);
    expect(cameraBounds.rooms.length).toBeGreaterThanOrEqual(3);
    expect(cameraBounds.rooms[0]).toEqual(cameraBounds.office);
    const last = cameraBounds.rooms[cameraBounds.rooms.length - 1];
    expect(last.col + last.cols).toBeLessThanOrEqual(layout.cols);
  });

  it("gives every room a distinct column band and keeps uids unique", () => {
    const { layout, cameraBounds } = buildCombined();
    const uids = new Set(layout.furniture.map((item) => item.uid));
    expect(uids.size).toBe(layout.furniture.length);

    for (let i = 1; i < cameraBounds.rooms.length; i++) {
      const previous = cameraBounds.rooms[i - 1];
      expect(cameraBounds.rooms[i].col).toBeGreaterThan(previous.col + previous.cols - 1);
    }
  });

  it("anchors every interactive object somewhere in the combined layout", () => {
    const { layout } = buildCombined();
    const types = new Set(layout.furniture.map((item) => item.type));
    for (const type of Object.values(OFFICE_OBJECT_FURNITURE)) {
      expect(types.has(type)).toBe(true);
    }
  });
});
