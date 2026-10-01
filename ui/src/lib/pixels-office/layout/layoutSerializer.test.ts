import { beforeAll, describe, expect, it } from "vitest";
import { TILE_SIZE, TileType } from "../types";
import { buildDynamicCatalog, type LoadedAssetData } from "./furnitureCatalog";
import {
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from "./layoutSerializer";

const CHAIR = "CHAIR_FRONT";
const DESK = "DESK_FRONT";
const COUCH = "COUCH_FRONT";

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
    {
      id: DESK,
      label: "Desk",
      category: "desks",
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      isDesk: true,
    },
    {
      id: COUCH,
      label: "Couch",
      category: "chairs",
      width: 32,
      height: 16,
      footprintW: 2,
      footprintH: 1,
      isDesk: false,
    },
  ],
  sprites: {
    [CHAIR]: [["#aabbcc"]],
    [DESK]: [["#112233"]],
    [COUCH]: [["#445566", "#445566"]],
  },
};

beforeAll(() => {
  expect(buildDynamicCatalog(assets)).toBe(true);
});

function floorLayout(cols: number, rows: number) {
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1) as TileType[];
  return { version: 1 as const, cols, rows, tiles, furniture: [] };
}

describe("layoutToTileMap", () => {
  it("reshapes the flat tile array into rows of the declared width", () => {
    const layout = floorLayout(3, 2);
    layout.tiles[1] = TileType.WALL;
    const map = layoutToTileMap(layout);
    expect(map).toHaveLength(2);
    expect(map[0]).toEqual([TileType.FLOOR_1, TileType.WALL, TileType.FLOOR_1]);
    expect(map[1]).toEqual([TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1]);
  });

  it("round-trips dimensions: every row has layout.cols entries and there are layout.rows rows", () => {
    const layout = floorLayout(5, 3);
    const map = layoutToTileMap(layout);
    expect(map.length).toBe(layout.rows);
    for (const row of map) expect(row.length).toBe(layout.cols);
  });
});

describe("layoutToSeats", () => {
  it("creates one seat per chair footprint tile, ignoring desks", () => {
    const seats = layoutToSeats([
      { uid: "c1", type: CHAIR, col: 2, row: 2 },
      { uid: "d1", type: DESK, col: 2, row: 3 },
    ]);
    expect([...seats.keys()]).toEqual(["c1"]);
    expect(seats.get("c1")).toEqual({
      uid: "c1",
      seatCol: 2,
      seatRow: 2,
      facingDir: 0,
      assigned: false,
    });
  });

  it("produces multiple seats for a multi-tile chair with suffixed uids", () => {
    const seats = layoutToSeats([{ uid: "couch", type: COUCH, col: 4, row: 4 }]);
    expect([...seats.keys()]).toEqual(["couch", "couch:1"]);
    expect(seats.get("couch")).toMatchObject({ seatCol: 4, seatRow: 4 });
    expect(seats.get("couch:1")).toMatchObject({ seatCol: 5, seatRow: 4 });
  });

  it("faces the chair toward an adjacent desk when the chair has no orientation", () => {
    const seats = layoutToSeats([
      { uid: "c1", type: CHAIR, col: 2, row: 2 },
      { uid: "d1", type: DESK, col: 2, row: 1 },
    ]);
    expect(seats.get("c1")!.facingDir).toBe(3);
  });
});

describe("getBlockedTiles", () => {
  it("blocks every desk footprint tile and honours excludeTiles", () => {
    const furniture = [
      { uid: "d1", type: DESK, col: 1, row: 1 },
      { uid: "c1", type: CHAIR, col: 5, row: 5 },
    ];
    const blocked = getBlockedTiles(furniture);
    expect(blocked.has("1,1")).toBe(true);
    expect(blocked.has("5,5")).toBe(true);
    expect(getBlockedTiles(furniture, new Set(["1,1"])).has("1,1")).toBe(false);
  });

  it("ignores furniture whose type is not in the catalog", () => {
    expect(getBlockedTiles([{ uid: "x", type: "MISSING", col: 0, row: 0 }]).size).toBe(0);
  });
});

describe("layoutToFurnitureInstances", () => {
  it("converts tile coordinates to pixel coordinates", () => {
    const instances = layoutToFurnitureInstances([{ uid: "d1", type: DESK, col: 3, row: 2 }]);
    expect(instances).toHaveLength(1);
    expect(instances[0].x).toBe(3 * TILE_SIZE);
    expect(instances[0].y).toBe(2 * TILE_SIZE);
    expect(instances[0].zY).toBe(2 * TILE_SIZE + 1);
  });

  it("drops items whose type has no catalog entry", () => {
    expect(layoutToFurnitureInstances([{ uid: "x", type: "MISSING", col: 0, row: 0 }])).toEqual([]);
  });
});
