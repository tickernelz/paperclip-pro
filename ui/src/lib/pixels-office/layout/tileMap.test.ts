import { readFileSync } from "fs";
import { beforeAll, describe, expect, it } from "vitest";
import { combineLayouts } from "../assetLoader";
import { buildDynamicCatalog, type LoadedAssetData } from "./furnitureCatalog";
import { getBlockedTiles, layoutToTileMap } from "./layoutSerializer";
import { NavGrid } from "./tileMap";
import type { OfficeLayout, TileType as TileTypeVal } from "../types";
import { TileType } from "../types";

const F = TileType.FLOOR_1;

function readJson<T>(relative: string): T {
  const url = new URL(`../../../../public/pixels/${relative}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

interface AssetIndexFixture {
  furniture: LoadedAssetData["catalog"];
}

function referencePath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): Array<{ col: number; row: number }> {
  const walkable = (col: number, row: number) => {
    if (row < 0 || row >= tileMap.length || col < 0 || col >= tileMap[0].length) return false;
    const tile = tileMap[row][col];
    if (tile === TileType.WALL || tile === TileType.VOID) return false;
    return !blockedTiles.has(`${col},${row}`);
  };
  if (startCol === endCol && startRow === endRow) return [];
  if (!walkable(endCol, endRow)) return [];

  const startKey = `${startCol},${startRow}`;
  const endKey = `${endCol},${endRow}`;
  const visited = new Set<string>([startKey]);
  const parent = new Map<string, string>();
  const queue = [{ col: startCol, row: startRow }];
  const dirs = [
    { dc: 0, dr: -1 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = `${current.col},${current.row}`;
    if (currentKey === endKey) {
      const path: Array<{ col: number; row: number }> = [];
      let key = endKey;
      while (key !== startKey) {
        const [col, row] = key.split(",").map(Number);
        path.unshift({ col, row });
        key = parent.get(key)!;
      }
      return path;
    }
    for (const dir of dirs) {
      const col = current.col + dir.dc;
      const row = current.row + dir.dr;
      const key = `${col},${row}`;
      if (visited.has(key) || !walkable(col, row)) continue;
      visited.add(key);
      parent.set(key, currentKey);
      queue.push({ col, row });
    }
  }
  return [];
}

describe("NavGrid", () => {
  it("rejects walls, voids, out-of-bounds and furniture-blocked tiles", () => {
    const nav = new NavGrid([[TileType.WALL, F, TileType.VOID], [F, F, F]], new Set(["1,1"]));
    expect(nav.isWalkable(0, 0)).toBe(false);
    expect(nav.isWalkable(2, 0)).toBe(false);
    expect(nav.isWalkable(1, 0)).toBe(true);
    expect(nav.isWalkable(-1, 0)).toBe(false);
    expect(nav.isWalkable(1, 1)).toBe(false);
    expect(nav.walkableTiles).toEqual([
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 2, row: 1 },
    ]);
  });

  it("walks a straight line, excludes the start tile and routes around blocked tiles", () => {
    const nav = new NavGrid([[F, F, F], [F, F, F]], new Set(["1,0"]));
    expect(nav.findPath(0, 0, 0, 0)).toEqual([]);
    expect(nav.findPath(0, 0, 2, 0)).toEqual([
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 2, row: 0 },
    ]);
  });

  it("refuses a blocked goal unless the caller owns it", () => {
    const nav = new NavGrid([[F, F, F]], new Set(["2,0"]));
    expect(nav.findPath(0, 0, 2, 0)).toEqual([]);
    expect(nav.findPath(0, 0, 2, 0, true)).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it("returns an empty path when the goal is walled off", () => {
    const nav = new NavGrid(
      [
        [F, TileType.WALL, F],
        [F, TileType.WALL, F],
      ],
      new Set(),
    );
    expect(nav.findPath(0, 0, 2, 0)).toEqual([]);
  });

  it("serves a cached path without handing out the same mutable array", () => {
    const nav = new NavGrid([[F, F, F]], new Set());
    const first = nav.findPath(0, 0, 2, 0);
    first.shift();
    const second = nav.findPath(0, 0, 2, 0);
    expect(second).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });
});

describe("NavGrid on the combined office layout", () => {
  let nav: NavGrid;
  let tileMap: TileTypeVal[][];
  let blocked: Set<string>;

  beforeAll(() => {
    const index = readJson<AssetIndexFixture>("pixels-office-assets.json");
    const sprites: LoadedAssetData["sprites"] = {};
    for (const asset of index.furniture) sprites[asset.id] = [["#ffffff"]];
    expect(buildDynamicCatalog({ catalog: index.furniture, sprites })).toBe(true);

    const office = readJson<OfficeLayout>("default-layout-1.json");
    const boardroom = readJson<OfficeLayout>("agent-pixels-layout-boardroom-kitchen.json");
    const combined = combineLayouts(office, boardroom).layout;
    tileMap = layoutToTileMap(combined);
    blocked = getBlockedTiles(combined.furniture);
    nav = new NavGrid(tileMap, blocked);
  });

  it("matches the reference breadth-first search on sampled tile pairs", () => {
    const tiles = nav.walkableTiles;
    expect(tiles.length).toBeGreaterThan(200);
    let compared = 0;
    for (let i = 0; i < tiles.length; i += 53) {
      const from = tiles[i];
      const to = tiles[(i * 7 + 11) % tiles.length];
      const mine = nav.findPath(from.col, from.row, to.col, to.row);
      const reference = referencePath(from.col, from.row, to.col, to.row, tileMap, blocked);
      expect(mine.length).toBe(reference.length);
      if (mine.length > 0) {
        expect(mine[mine.length - 1]).toEqual({ col: to.col, row: to.row });
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });
});
