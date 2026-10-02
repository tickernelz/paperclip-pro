import { describe, expect, it } from "vitest";
import { NavGrid } from "../layout/tileMap";
import type { FurnitureInstance, Seat, TileType as TileTypeVal } from "../types";
import { TileType } from "../types";
import { classifyOccluders } from "./staticLayer";

function instance(x: number, y: number, w: number, h: number, zY: number): FurnitureInstance {
  const sprite = Array.from({ length: h }, () => Array<string>(w).fill("#ffffff"));
  return { sprite, x, y, zY, sourceIndex: 0 };
}

describe("classifyOccluders", () => {
  it("draws items resting on an occluding desk dynamically too", () => {
    const tiles: TileTypeVal[][] = Array.from({ length: 6 }, () =>
      Array<TileTypeVal>(6).fill(TileType.FLOOR_1),
    );
    const nav = new NavGrid(tiles, new Set(["2,1", "2,2", "2,3", "2,4"]));
    const seat = { seatCol: 2, seatRow: 3 } as Seat;
    const desk = instance(32, 16, 16, 64, 80);
    const pcOnDesk = instance(32, 64, 16, 16, 80.5);
    const backdrop = instance(80, 0, 16, 16, 0);
    const flags = classifyOccluders([desk, pcOnDesk, backdrop], nav, [seat]);
    expect(Array.from(flags)).toEqual([1, 1, 0]);
  });
});
