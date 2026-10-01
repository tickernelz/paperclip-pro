import { describe, expect, it } from "vitest";
import { TileType } from "../types";
import { findPath, getWalkableTiles, isWalkable } from "./tileMap";

const F = TileType.FLOOR_1;

describe("isWalkable", () => {
  const tileMap = [[TileType.WALL, F, TileType.VOID]];

  it("rejects out-of-bounds coordinates", () => {
    expect(isWalkable(-1, 0, tileMap, new Set())).toBe(false);
    expect(isWalkable(3, 0, tileMap, new Set())).toBe(false);
    expect(isWalkable(0, -1, tileMap, new Set())).toBe(false);
    expect(isWalkable(0, 1, tileMap, new Set())).toBe(false);
  });

  it("rejects wall and void tiles but accepts floor", () => {
    expect(isWalkable(0, 0, tileMap, new Set())).toBe(false);
    expect(isWalkable(2, 0, tileMap, new Set())).toBe(false);
    expect(isWalkable(1, 0, tileMap, new Set())).toBe(true);
  });

  it("rejects a floor tile that is blocked by furniture", () => {
    expect(isWalkable(1, 0, tileMap, new Set(["1,0"]))).toBe(false);
  });
});

describe("getWalkableTiles", () => {
  it("returns walkable tiles in row-major order, skipping blocked ones", () => {
    const tileMap = [
      [TileType.WALL, F, TileType.VOID],
      [F, F, F],
    ];
    expect(getWalkableTiles(tileMap, new Set(["1,1"]))).toEqual([
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 2, row: 1 },
    ]);
  });
});

describe("findPath", () => {
  it("returns an empty path when start equals goal", () => {
    const tileMap = [[F, F, F]];
    expect(findPath(1, 0, 1, 0, tileMap, new Set())).toEqual([]);
  });

  it("walks a straight line and excludes the start tile", () => {
    const tileMap = [[F, F, F]];
    expect(findPath(0, 0, 2, 0, tileMap, new Set())).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it("returns the documented empty array when the goal is unreachable", () => {
    const tileMap = [
      [F, TileType.WALL, F],
      [F, TileType.WALL, F],
      [F, TileType.WALL, F],
    ];
    expect(findPath(0, 0, 2, 0, tileMap, new Set())).toEqual([]);
  });

  it("returns the empty array when the goal tile is not walkable", () => {
    const tileMap = [[F, F, TileType.WALL]];
    expect(findPath(0, 0, 2, 0, tileMap, new Set())).toEqual([]);
  });

  it("routes around a blocked tile and never steps on it", () => {
    const tileMap = [
      [F, F, F],
      [F, F, F],
    ];
    const path = findPath(0, 0, 2, 0, tileMap, new Set(["1,0"]));
    expect(path).toEqual([
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 2, row: 0 },
    ]);
    expect(path).not.toContainEqual({ col: 1, row: 0 });
  });
});
