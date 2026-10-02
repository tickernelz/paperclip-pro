import { afterEach, describe, expect, it, vi } from "vitest";
import { WALK_SPEED_PX_PER_SEC } from "../constants";
import { NavGrid } from "../layout/tileMap";
import { CharacterState, Direction, TILE_SIZE, TileType } from "../types";
import type { Seat, TileType as TileTypeVal } from "../types";
import { createCharacter, isReadingTool, updateCharacter } from "./characters";

function grid(cols: number, rows: number, blocked = new Set<string>()): NavGrid {
  const tileMap: TileTypeVal[][] = Array.from(
    { length: rows },
    () => new Array(cols).fill(TileType.FLOOR_1) as TileTypeVal[],
  );
  return new NavGrid(tileMap, blocked);
}

function seat(seatCol: number, seatRow: number, facingDir: Direction): Seat {
  return { uid: "s1", seatCol, seatRow, facingDir, assigned: true };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isReadingTool", () => {
  it("recognises the read-oriented tools and rejects writing ones", () => {
    expect(isReadingTool("Read")).toBe(true);
    expect(isReadingTool("Grep")).toBe(true);
    expect(isReadingTool("WebSearch")).toBe(true);
    expect(isReadingTool("Bash")).toBe(false);
    expect(isReadingTool("Edit")).toBe(false);
    expect(isReadingTool(null)).toBe(false);
  });
});

describe("createCharacter", () => {
  it("seats a character at the seat tile facing the seat direction", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ch = createCharacter("agent-7", 2, "s1", seat(3, 4, Direction.LEFT), 90);
    expect(ch.palette).toBe(2);
    expect(ch.hueShift).toBe(90);
    expect(ch.state).toBe(CharacterState.TYPE);
    expect(ch.dir).toBe(Direction.LEFT);
    expect(ch.tileCol).toBe(3);
    expect(ch.tileRow).toBe(4);
    expect(ch.x).toBe(3 * TILE_SIZE + TILE_SIZE / 2);
    expect(ch.y).toBe(4 * TILE_SIZE + TILE_SIZE / 2);
  });

  it("falls back to tile (1,1) facing down when there is no seat", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ch = createCharacter("agent-8", 0, null, null);
    expect(ch.seatId).toBeNull();
    expect(ch.dir).toBe(Direction.DOWN);
    expect(ch.x).toBe(24);
    expect(ch.y).toBe(24);
  });
});

describe("updateCharacter", () => {
  it("advances a walking character along its path without consuming a tile early", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ch = createCharacter("agent-1", 0, null, null);
    ch.state = CharacterState.WALK;
    ch.path = [{ col: 2, row: 1 }];

    updateCharacter(ch, 0.1, grid(4, 4), new Map());

    expect(ch.moveProgress).toBeCloseTo((WALK_SPEED_PX_PER_SEC / TILE_SIZE) * 0.1);
    expect(ch.x).toBeCloseTo(24 + 16 * 0.3);
    expect(ch.tileCol).toBe(1);
    expect(ch.dir).toBe(Direction.RIGHT);
  });

  it("snaps to the next tile and pops it once progress reaches one", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ch = createCharacter("agent-1", 0, null, null);
    ch.state = CharacterState.WALK;
    ch.path = [{ col: 2, row: 1 }];
    ch.moveProgress = 0.8;
    const nav = grid(4, 4);

    updateCharacter(ch, 0.1, nav, new Map());

    expect(ch.tileCol).toBe(2);
    expect(ch.x).toBe(40);
    expect(ch.path).toEqual([]);
    expect(ch.state).toBe(CharacterState.WALK);

    updateCharacter(ch, 0.1, nav, new Map());
    expect(ch.state).toBe(CharacterState.TYPE);
  });

  it("advances the typing frame only after TYPE_FRAME_DURATION_SEC elapses", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ch = createCharacter("agent-1", 0, null, null);
    ch.state = CharacterState.TYPE;
    const nav = grid(4, 4);

    updateCharacter(ch, 0.2, nav, new Map());
    expect(ch.frame).toBe(0);

    updateCharacter(ch, 0.1, nav, new Map());
    expect(ch.frame).toBe(1);
  });

  it("holds the typing frame while the character is still", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ch = createCharacter("agent-1", 0, null, null);
    ch.state = CharacterState.TYPE;
    ch.still = true;

    updateCharacter(ch, 0.5, grid(4, 4), new Map());
    expect(ch.frame).toBe(0);
  });

  it("sits down and faces the seat when an idle character has no reachable path", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const s = seat(1, 1, Direction.UP);
    const ch = createCharacter("agent-1", 0, "s1", s);
    ch.state = CharacterState.IDLE;
    ch.isActive = true;
    ch.dir = Direction.DOWN;

    updateCharacter(ch, 0.1, grid(4, 4), new Map([["s1", s]]));

    expect(ch.state).toBe(CharacterState.TYPE);
    expect(ch.dir).toBe(Direction.UP);
  });

  it("keeps a pinned character in place instead of wandering or seat-seeking", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const s = seat(3, 3, Direction.UP);
    const ch = createCharacter("agent-1", 0, "s1", s);
    ch.state = CharacterState.IDLE;
    ch.tileCol = 1;
    ch.tileRow = 1;
    ch.pinned = true;
    ch.isActive = true;

    updateCharacter(ch, 5, grid(4, 4), new Map([["s1", s]]));

    expect(ch.state).toBe(CharacterState.IDLE);
    expect(ch.path).toEqual([]);
  });
});
