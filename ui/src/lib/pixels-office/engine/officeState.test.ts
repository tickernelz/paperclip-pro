import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CharacterState, Direction, TILE_SIZE, TileType } from "../types";
import type { OfficeLayout, PlacedFurniture } from "../types";
import { buildDynamicCatalog, type LoadedAssetData } from "../layout/furnitureCatalog";
import { OfficeState } from "./officeState";

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

beforeAll(() => {
  expect(buildDynamicCatalog(assets)).toBe(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function layoutWith(furniture: PlacedFurniture[], cols = 5, rows = 3): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array(cols * rows).fill(TileType.FLOOR_1) as TileType[],
    furniture,
    spawnTile: { col: 0, row: 0 },
  };
}

const oneChair = layoutWith([{ uid: "c1", type: CHAIR, col: 3, row: 1 }]);
const twoChairs = layoutWith([
  { uid: "c1", type: CHAIR, col: 3, row: 1 },
  { uid: "c2", type: CHAIR, col: 4, row: 2 },
]);

describe("OfficeState.addAgent", () => {
  it("spawns an unknown agent at the corridor and claims a free seat", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);

    state.addAgent("agent-1");

    const ch = state.characters.get("agent-1")!;
    expect(ch.seatId).toBe("c1");
    expect(state.seats.get("c1")!.assigned).toBe(true);
    expect(ch.tileCol).toBe(0);
    expect(ch.tileRow).toBe(0);
    expect(ch.x).toBe(TILE_SIZE / 2);
  });

  it("places an agent that already owns a seat at that seat instead of the spawn tile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(twoChairs);

    state.addAgent("agent-1", { palette: 1, seatId: "c2" });

    const ch = state.characters.get("agent-1")!;
    expect(ch.seatId).toBe("c2");
    expect(ch.tileCol).toBe(4);
    expect(ch.tileRow).toBe(2);
    expect(ch.state).toBe(CharacterState.TYPE);
  });

  it("restores an exact pose without teleporting the agent to the spawn tile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(twoChairs);

    state.addAgent("agent-1", {
      pose: {
        tileCol: 2,
        tileRow: 1,
        x: 2 * TILE_SIZE + 3,
        y: 1 * TILE_SIZE + 5,
        dir: Direction.LEFT,
        state: CharacterState.IDLE,
        palette: 4,
        hueShift: 120,
        seatId: "c2",
      },
    });

    const ch = state.characters.get("agent-1")!;
    expect(ch.tileCol).toBe(2);
    expect(ch.tileRow).toBe(1);
    expect(ch.x).toBe(2 * TILE_SIZE + 3);
    expect(ch.y).toBe(1 * TILE_SIZE + 5);
    expect(ch.dir).toBe(Direction.LEFT);
    expect(ch.palette).toBe(4);
    expect(ch.hueShift).toBe(120);
    expect(ch.seatId).toBe("c2");
  });

  it("does not create a second character for a duplicate id", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);

    state.addAgent("agent-1");
    state.addAgent("agent-1");

    expect(state.characters.size).toBe(1);
  });
});

describe("OfficeState.removeAgent", () => {
  it("frees the seat so a later addAgent can take it", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);

    state.addAgent("agent-1");
    state.removeAgent("agent-1");
    expect(state.seats.get("c1")!.assigned).toBe(false);

    state.addAgent("agent-2");
    expect(state.characters.get("agent-2")!.seatId).toBe("c1");
  });
});

describe("OfficeState.update", () => {
  it("advances a walking character's position after walkToTile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);
    state.addAgent("agent-1");
    state.setAgentActive("agent-1", false);

    expect(state.walkToTile("agent-1", 4, 0)).toBe(true);

    const ch = state.characters.get("agent-1")!;
    expect(ch.path).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
      { col: 4, row: 0 },
    ]);

    state.update(0.1);

    expect(ch.x).toBeCloseTo(TILE_SIZE / 2 + TILE_SIZE * 0.3);
    expect(ch.moveProgress).toBeCloseTo(0.3);
    expect(ch.tileCol).toBe(0);
  });

  it("reports idle once every character stopped animating", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);
    state.addAgent("agent-1");
    state.setAgentActive("agent-1", false);
    const ch = state.characters.get("agent-1")!;
    ch.state = CharacterState.IDLE;
    ch.wanderTimer = 30;

    expect(state.update(0.1)).toBe(false);
    expect(state.nextWakeSeconds()).toBeCloseTo(29.9);
  });
});

describe("character overlap", () => {
  it("spawns a second new agent on a free tile instead of on top of the first", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(layoutWith([]));

    state.addAgent("agent-1");
    state.addAgent("agent-2");

    const a = state.characters.get("agent-1")!;
    const b = state.characters.get("agent-2")!;
    expect([a.tileCol, a.tileRow]).not.toEqual([b.tileCol, b.tileRow]);
  });

  it("never lets two wandering agents share a tile", () => {
    let seed = 7;
    vi.spyOn(Math, "random").mockImplementation(() => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    const state = new OfficeState(layoutWith([], 4, 2));
    for (let i = 0; i < 6; i++) {
      state.addAgent(`agent-${i}`);
      state.setAgentActive(`agent-${i}`, false);
    }

    for (let step = 0; step < 2000; step++) {
      state.update(0.05);
      const tiles = new Set<string>();
      for (const ch of state.characters.values()) {
        const key = `${ch.tileCol},${ch.tileRow}`;
        expect(tiles.has(key)).toBe(false);
        tiles.add(key);
        if (ch.moveProgress > 0 && ch.path.length > 0) {
          const next = `${ch.path[0].col},${ch.path[0].row}`;
          expect(tiles.has(next)).toBe(false);
          tiles.add(next);
        }
      }
    }
  });
});
