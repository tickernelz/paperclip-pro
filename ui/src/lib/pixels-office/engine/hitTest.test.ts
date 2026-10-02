import { describe, expect, it } from "vitest";
import type { Character } from "../types";
import { CharacterState, Direction, TILE_SIZE } from "../types";
import { hitTestWorld, type ObjectBox } from "./hitTest";

function character(
  id: string,
  col: number,
  row: number,
  state: CharacterState = CharacterState.IDLE,
): Character {
  return {
    id,
    state,
    dir: Direction.DOWN,
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette: 0,
    hueShift: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 3,
    isActive: false,
    still: false,
    pinned: false,
    hop: 0,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

const kanban: ObjectBox = { kind: "kanban", x: 0, y: 0, width: 48, height: 32 };

describe("hitTestWorld", () => {
  it("picks the character drawn last when two sprites overlap", () => {
    const behind = character("behind", 2, 4);
    const front = character("front", 2, 5);
    const worldX = front.x;
    const worldY = front.y - 4;

    expect(hitTestWorld(worldX, worldY, [behind, front], [])).toEqual({
      kind: "agent",
      agentId: "front",
    });
    expect(hitTestWorld(worldX, worldY, [front, behind], [])).toEqual({
      kind: "agent",
      agentId: "front",
    });
  });

  it("covers the full 16 by 32 sprite box and nothing outside it", () => {
    const ch = character("solo", 3, 6);
    expect(hitTestWorld(ch.x, ch.y - 31, [ch], [])).toEqual({ kind: "agent", agentId: "solo" });
    expect(hitTestWorld(ch.x, ch.y - 33, [ch], [])).toBeNull();
    expect(hitTestWorld(ch.x + 9, ch.y - 4, [ch], [])).toBeNull();
  });

  it("lifts the box when the character is seated and typing", () => {
    const seated = character("seated", 3, 6, CharacterState.TYPE);
    expect(hitTestWorld(seated.x, seated.y + 5, [seated], [])).toEqual({
      kind: "agent",
      agentId: "seated",
    });
  });

  it("falls through to interactive objects only when no character is hit", () => {
    const ch = character("solo", 10, 10);
    expect(hitTestWorld(20, 16, [ch], [kanban])).toEqual({ kind: "object", object: "kanban" });
    expect(hitTestWorld(200, 200, [ch], [kanban])).toBeNull();
  });

  it("prefers a character standing in front of an object", () => {
    const ch = character("solo", 1, 1);
    expect(hitTestWorld(ch.x, ch.y - 2, [ch], [kanban])).toEqual({
      kind: "agent",
      agentId: "solo",
    });
  });
});
