import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CharacterState, TILE_SIZE, TileType } from "../types";
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

describe("OfficeState.addAgent", () => {
  it("places a character at the spawn tile and claims a free seat", () => {
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

  it("does not create a second character for a duplicate numeric id", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);

    state.addAgent("agent-1");
    state.addAgent("agent-1");

    expect(state.characters.size).toBe(1);
    expect(state.getCharacters()).toHaveLength(1);
  });
});

describe("OfficeState.removeAgent", () => {
  it("frees the seat so a later addAgent can take it", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);

    state.addAgent("agent-1");
    expect(state.seats.get("c1")!.assigned).toBe(true);

    state.removeAgent("agent-1");
    expect(state.characters.has("agent-1")).toBe(false);
    expect(state.seats.get("c1")!.assigned).toBe(false);

    state.addAgent("agent-2");
    expect(state.characters.get("agent-2")!.seatId).toBe("c1");
    expect(state.seats.get("c1")!.assigned).toBe(true);
  });
});

describe("OfficeState.setAgentActive", () => {
  it("toggles the isActive flag on the addressed character only", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);
    state.addAgent("agent-1");
    state.addAgent("agent-2");

    state.setAgentActive("agent-1", false);

    expect(state.characters.get("agent-1")!.isActive).toBe(false);
    expect(state.characters.get("agent-2")!.isActive).toBe(true);

    state.setAgentActive("agent-1", true);
    expect(state.characters.get("agent-1")!.isActive).toBe(true);
  });
});

describe("OfficeState.update", () => {
  it("advances a walking character's position after walkToTile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = new OfficeState(oneChair);
    state.addAgent("agent-1");
    state.setAgentActive("agent-1", false);

    const started = state.walkToTile("agent-1", 4, 0);
    expect(started).toBe(true);

    const ch = state.characters.get("agent-1")!;
    expect(ch.tileCol).toBe(0);
    expect(ch.tileRow).toBe(0);
    expect(ch.path).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
      { col: 4, row: 0 },
    ]);
    expect(ch.state).toBe(CharacterState.WALK);

    state.update(0.1);

    expect(ch.x).toBeCloseTo(TILE_SIZE / 2 + TILE_SIZE * 0.3);
    expect(ch.y).toBe(TILE_SIZE / 2);
    expect(ch.moveProgress).toBeCloseTo(0.3);
    expect(ch.tileCol).toBe(0);
  });
});
