import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDynamicCatalog, type LoadedAssetData } from "../layout/furnitureCatalog";
import type { OfficeLayout, PlacedFurniture } from "../types";
import { CharacterState, Direction, TILE_SIZE, TileType } from "../types";
import { OfficeState } from "./officeState";
import { loadStoredPoses, storePoses } from "./persistence";

const CHAIR = "CHAIR_FRONT";

const assets: LoadedAssetData = {
  catalog: [
    {
      id: CHAIR,
      label: "Chair",
      category: "chairs",
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
    },
  ],
  sprites: { [CHAIR]: [["#aabbcc"]] },
};

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  } as Storage;
}

function layoutWith(furniture: PlacedFurniture[], cols = 6, rows = 4): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array(cols * rows).fill(TileType.FLOOR_1) as TileType[],
    furniture,
    spawnTile: { col: 0, row: 0 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pose persistence", () => {
  it("restores the exact pose of a known agent instead of spawning it again", () => {
    expect(buildDynamicCatalog(assets)).toBe(true);
    vi.stubGlobal("sessionStorage", fakeStorage());
    vi.spyOn(Math, "random").mockReturnValue(0);

    const layout = layoutWith([
      { uid: "c1", type: CHAIR, col: 4, row: 1 },
      { uid: "c2", type: CHAIR, col: 5, row: 3 },
    ]);
    const first = new OfficeState(layout);
    first.addAgent("agent-1", { palette: 3, hueShift: 210, seatId: "c2" });
    const original = first.characters.get("agent-1")!;
    original.tileCol = 2;
    original.tileRow = 2;
    original.x = 2 * TILE_SIZE + 7;
    original.y = 2 * TILE_SIZE + 9;
    original.dir = Direction.RIGHT;
    original.state = CharacterState.IDLE;

    storePoses("company-7", first.characters.values());

    const restored = loadStoredPoses("company-7");
    expect(restored.size).toBe(1);

    const second = new OfficeState(layout);
    second.addAgent("agent-1", { pose: restored.get("agent-1") });
    const ch = second.characters.get("agent-1")!;

    expect(ch.x).toBe(original.x);
    expect(ch.y).toBe(original.y);
    expect(ch.tileCol).toBe(2);
    expect(ch.tileRow).toBe(2);
    expect(ch.dir).toBe(Direction.RIGHT);
    expect(ch.palette).toBe(3);
    expect(ch.hueShift).toBe(210);
    expect(ch.seatId).toBe("c2");
    expect(second.seats.get("c2")!.assigned).toBe(true);
  });

  it("ignores a payload written by another version or a corrupted entry", () => {
    const storage = fakeStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem("pixels-office:v2:company-8", "{not json");
    expect(loadStoredPoses("company-8").size).toBe(0);

    storage.setItem("pixels-office:v2:company-8", JSON.stringify({ v: 1, poses: {} }));
    expect(loadStoredPoses("company-8").size).toBe(0);
  });

  it("stays silent when no storage is available", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(loadStoredPoses("company-9").size).toBe(0);
  });
});
