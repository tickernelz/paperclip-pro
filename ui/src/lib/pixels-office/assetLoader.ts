import { setFloorSprites } from "./floorTiles";
import { layoutToSeats } from "./layout/layoutSerializer";
import { buildDynamicCatalog, getCatalogEntry } from "./layout/furnitureCatalog";
import { setCharacterTemplates } from "./sprites/spriteData";
import type { OfficeLayout, PlacedFurniture, SpriteData } from "./types";
import { setWallSprites } from "./wallTiles";

type CharacterDirectionSprites = {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
};

type AssetIndex = {
  characters: string[];
  floors: string[];
  walls: string[];
  furniture: Array<{
    id: string;
    label: string;
    category: string;
    width: number;
    height: number;
    footprintW: number;
    footprintH: number;
    isDesk: boolean;
    groupId?: string;
    orientation?: string;
    state?: string;
    rotationScheme?: string;
    animationGroup?: string;
    frame?: number;
    canPlaceOnSurfaces?: boolean;
    backgroundTiles?: number;
    canPlaceOnWalls?: boolean;
    mirrorSide?: boolean;
    furniturePath: string;
  }>;
  layouts?: {
    office: string;
    boardroomKitchen: string;
  };
  defaultLayout: string;
};

type DecodedPng = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type CameraBounds = {
  col: number;
  row: number;
  cols: number;
  rows: number;
};

export type OfficeCameraBounds = {
  office: CameraBounds;
  boardroomKitchen: CameraBounds;
  overflowOffice: CameraBounds;
  rooms: CameraBounds[];
};

export type LoadedPixelAssets = {
  layouts: {
    office: OfficeLayout;
    boardroomKitchen: OfficeLayout;
    combined: OfficeLayout;
  };
  cameraBounds: OfficeCameraBounds;
};

const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const FLOOR_TILE_SIZE = 16;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;
const WALL_GRID_COLS = 4;
const WALL_BITMASK_COUNT = 16;

const ASSET_BASE_URL = "/pixels/";

let loadPromise: Promise<LoadedPixelAssets> | null = null;

function trimLayoutToVisibleRoom(layout: OfficeLayout): OfficeLayout {
  const occupied: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      if (layout.tiles[row * layout.cols + col] !== 255) occupied.push({ col, row });
    }
  }

  if (occupied.length === 0) return layout;

  const minCol = Math.max(0, Math.min(...occupied.map((tile) => tile.col)) - 1);
  const maxCol = Math.min(layout.cols - 1, Math.max(...occupied.map((tile) => tile.col)) + 1);
  const minRow = Math.max(0, Math.min(...occupied.map((tile) => tile.row)) - 1);
  const maxRow = Math.min(layout.rows - 1, Math.max(...occupied.map((tile) => tile.row)) + 1);
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;

  const tiles: OfficeLayout["tiles"] = [];
  const tileColors: OfficeLayout["tileColors"] = layout.tileColors ? [] : undefined;
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const index = row * layout.cols + col;
      tiles.push(layout.tiles[index]);
      tileColors?.push(layout.tileColors?.[index] ?? null);
    }
  }

  return {
    ...layout,
    cols,
    rows,
    tiles,
    tileColors,
    furniture: layout.furniture.map((item) => ({
      ...item,
      col: item.col - minCol,
      row: item.row - minRow,
    })),
  };
}

function recolorLayout(
  layout: OfficeLayout,
  floorColor: NonNullable<OfficeLayout["tileColors"]>[number],
  wallColor: NonNullable<OfficeLayout["tileColors"]>[number],
): OfficeLayout {
  return {
    ...layout,
    tileColors: layout.tiles.map((tile) => {
      if (tile === 0) return wallColor;
      if (tile === 255) return null;
      return floorColor;
    }),
    furniture: layout.furniture.map((item) => {
      if (!["DESK_FRONT", "TABLE_FRONT", "SMALL_TABLE_FRONT", "SMALL_TABLE_SIDE", "COFFEE_TABLE"].includes(item.type)) {
        return item;
      }
      return {
        ...item,
        color: { h: 150, s: 18, b: -10, c: -20 },
      };
    }),
  };
}

export const TARGET_SEAT_CAPACITY = 50;

const ROOM_GAP = 5;

const OVERFLOW_PALETTE = [
  { floor: { h: 145, s: 16, b: -8, c: -35 }, wall: { h: 270, s: 18, b: -20, c: -45 } },
  { floor: { h: 60, s: 20, b: -6, c: -30 }, wall: { h: 310, s: 22, b: -24, c: -40 } },
  { floor: { h: 200, s: 18, b: -10, c: -32 }, wall: { h: 20, s: 20, b: -22, c: -42 } },
  { floor: { h: 95, s: 22, b: -12, c: -28 }, wall: { h: 240, s: 16, b: -18, c: -48 } },
];

function placeAnchorFurniture(office: OfficeLayout): PlacedFurniture[] {
  const occupied = new Set<string>();
  for (const item of office.furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry) continue;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        occupied.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }

  const tileAt = (col: number, row: number) => office.tiles[row * office.cols + col];
  let wallRow = -1;
  for (let row = 0; row < office.rows - 1 && wallRow < 0; row++) {
    for (let col = 0; col < office.cols; col++) {
      const below = tileAt(col, row + 1);
      if (tileAt(col, row) === 0 && below !== 0 && below !== 255) {
        wallRow = row;
        break;
      }
    }
  }

  const placed: PlacedFurniture[] = [];

  function claim(type: string, col: number, row: number, width: number, height: number) {
    for (let dr = 0; dr < height; dr++) {
      for (let dc = 0; dc < width; dc++) occupied.add(`${col + dc},${row + dr}`);
    }
    placed.push({ uid: `anchor-${type}`, type, col, row });
  }

  function placeOnWall(type: string, fromRight: boolean): boolean {
    const entry = getCatalogEntry(type);
    if (wallRow < 1 || !entry) return false;
    const width = entry.footprintW;
    const columns = Array.from({ length: office.cols - width + 1 }, (_, index) => index);
    if (fromRight) columns.reverse();
    for (const col of columns) {
      let free = true;
      for (let dc = 0; dc < width && free; dc++) {
        if (tileAt(col + dc, wallRow) !== 0) free = false;
        if (occupied.has(`${col + dc},${wallRow}`)) free = false;
        if (occupied.has(`${col + dc},${wallRow - 1}`)) free = false;
      }
      if (!free) continue;
      claim(type, col, wallRow - 1, width, 2);
      return true;
    }
    return false;
  }

  function placeOnFloor(type: string, fromRight: boolean): boolean {
    const entry = getCatalogEntry(type);
    if (!entry) return false;
    const width = entry.footprintW;
    const height = entry.footprintH;
    for (let row = office.rows - height; row > wallRow; row--) {
      const columns = Array.from({ length: office.cols - width + 1 }, (_, index) => index);
      if (fromRight) columns.reverse();
      for (const col of columns) {
        let free = true;
        for (let dr = 0; dr < height && free; dr++) {
          for (let dc = 0; dc < width && free; dc++) {
            const tile = tileAt(col + dc, row + dr);
            if (tile === 0 || tile === 255) free = false;
            if (occupied.has(`${col + dc},${row + dr}`)) free = false;
          }
        }
        if (!free) continue;
        claim(type, col, row, width, height);
        return true;
      }
    }
    return false;
  }

  if (!placeOnWall("KANBAN_BOARD", false)) placeOnFloor("KANBAN_BOARD", false);
  if (!placeOnWall("ALARM_LIGHT", true)) placeOnFloor("ALARM_LIGHT", true);
  if (!placeOnFloor("MAILBOX", false)) placeOnWall("MAILBOX", false);
  if (!placeOnFloor("COIN_STACK", true)) placeOnWall("COIN_STACK", true);
  return placed;
}

export function combineLayouts(office: OfficeLayout, boardroomKitchen: OfficeLayout): {
  layout: OfficeLayout;
  cameraBounds: OfficeCameraBounds;
} {
  const officeSeats = layoutToSeats(office.furniture).size;
  const boardroomSeats = layoutToSeats(boardroomKitchen.furniture).size;
  const missingSeats = TARGET_SEAT_CAPACITY - officeSeats - boardroomSeats;
  const overflowCount =
    officeSeats > 0 && missingSeats > 0 ? Math.ceil(missingSeats / officeSeats) : 1;

  const sources: OfficeLayout[] = [office, boardroomKitchen];
  for (let i = 0; i < overflowCount; i++) {
    const palette = OVERFLOW_PALETTE[i % OVERFLOW_PALETTE.length];
    sources.push(recolorLayout(office, palette.floor, palette.wall));
  }

  const boardOffsetRow = Math.max(0, Math.floor((office.rows - boardroomKitchen.rows) / 2));
  const placements = sources.map((layout, index) => ({
    layout,
    offsetCol: 0,
    offsetRow: index === 1 ? boardOffsetRow : 0,
  }));
  let cols = 0;
  for (const placement of placements) {
    placement.offsetCol = cols;
    cols += placement.layout.cols + ROOM_GAP;
  }
  cols -= ROOM_GAP;
  const rows = Math.max(...placements.map((p) => p.offsetRow + p.layout.rows));

  const tiles = Array<OfficeLayout["tiles"][number]>(cols * rows).fill(255);
  const tileColors: NonNullable<OfficeLayout["tileColors"]> = Array(cols * rows).fill(null);
  const wallColor = { h: 214, s: 30, b: -100, c: -55 };
  const hallColor = { h: 209, s: 0, b: -16, c: -8 };
  const hallFloor = 9;

  for (const { layout, offsetCol, offsetRow } of placements) {
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const sourceIndex = row * layout.cols + col;
        const targetIndex = (row + offsetRow) * cols + col + offsetCol;
        tiles[targetIndex] = layout.tiles[sourceIndex];
        tileColors[targetIndex] = layout.tileColors?.[sourceIndex] ?? null;
      }
    }
  }

  const hallRow = Math.floor(rows / 2);
  const spawnTile = { col: office.cols - 1, row: hallRow };

  for (let i = 1; i < placements.length; i++) {
    const previous = placements[i - 1];
    const startCol = previous.offsetCol + previous.layout.cols - 2;
    const endCol = placements[i].offsetCol + 1;
    for (let row = hallRow - 1; row <= hallRow + 1; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const index = row * cols + col;
        tiles[index] = hallFloor;
        tileColors[index] = hallColor;
      }
    }
    for (let row = hallRow - 2; row <= hallRow + 2; row++) {
      for (const col of [startCol + 1, startCol + 2, endCol - 1, endCol]) {
        const index = row * cols + col;
        tiles[index] = hallFloor;
        tileColors[index] = hallColor;
      }
      for (const col of [startCol - 1, endCol + 1]) {
        const index = row * cols + col;
        if (tiles[index] === 255) {
          tiles[index] = 0;
          tileColors[index] = wallColor;
        }
      }
    }
  }

  tileColors[spawnTile.row * cols + spawnTile.col] = { h: 204, s: 10, b: -42, c: -32 };

  const furniture = placements.flatMap(({ layout, offsetCol, offsetRow }, index) =>
    layout.furniture.map((item) => ({
      ...item,
      uid: `camera${index + 1}-${item.uid}`,
      col: item.col + offsetCol,
      row: item.row + offsetRow,
    })),
  );
  furniture.push(...placeAnchorFurniture(office));

  const roomBounds = placements.map(({ layout, offsetCol, offsetRow }, index) =>
    index === 1
      ? { col: offsetCol, row: offsetRow - 1, cols: layout.cols, rows: layout.rows + 1 }
      : { col: offsetCol, row: offsetRow, cols: layout.cols, rows: layout.rows },
  );

  return {
    layout: {
      version: 1,
      cols,
      rows,
      layoutRevision: 1,
      tiles,
      tileColors,
      spawnTile,
      furniture,
    },
    cameraBounds: {
      office: roomBounds[0],
      boardroomKitchen: roomBounds[1],
      overflowOffice: roomBounds[2],
      rooms: roomBounds,
    },
  };
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < 2) return "";
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}${a === 255 ? "" : a.toString(16).padStart(2, "0")}`;
}

function pixelAt(png: DecodedPng, x: number, y: number): string {
  const idx = (y * png.width + x) * 4;
  return rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]);
}

function readSprite(png: DecodedPng, width: number, height: number, offsetX = 0, offsetY = 0): SpriteData {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => pixelAt(png, offsetX + x, offsetY + y)),
  );
}

async function decodePng(url: string): Promise<DecodedPng> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not decode PNG");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

async function decodeCharacters(index: AssetIndex): Promise<CharacterDirectionSprites[]> {
  return Promise.all(index.characters.map(async (path) => {
    const png = await decodePng(`${ASSET_BASE_URL}${path}`);
    return {
      down: Array.from({ length: CHAR_FRAMES_PER_ROW }, (_, frame) =>
        readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, frame * CHAR_FRAME_W, 0),
      ),
      up: Array.from({ length: CHAR_FRAMES_PER_ROW }, (_, frame) =>
        readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, frame * CHAR_FRAME_W, CHAR_FRAME_H),
      ),
      right: Array.from({ length: CHAR_FRAMES_PER_ROW }, (_, frame) =>
        readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, frame * CHAR_FRAME_W, CHAR_FRAME_H * 2),
      ),
    };
  }));
}

async function decodeFloors(index: AssetIndex): Promise<SpriteData[]> {
  return Promise.all(
    index.floors.map(async (path) => readSprite(await decodePng(`${ASSET_BASE_URL}${path}`), FLOOR_TILE_SIZE, FLOOR_TILE_SIZE)),
  );
}

async function decodeWalls(index: AssetIndex): Promise<SpriteData[][]> {
  return Promise.all(index.walls.map(async (path) => {
    const png = await decodePng(`${ASSET_BASE_URL}${path}`);
    return Array.from({ length: WALL_BITMASK_COUNT }, (_, mask) =>
      readSprite(
        png,
        WALL_PIECE_WIDTH,
        WALL_PIECE_HEIGHT,
        (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH,
        Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT,
      ),
    );
  }));
}

async function decodeFurniture(index: AssetIndex): Promise<Record<string, SpriteData>> {
  const entries = await Promise.all(index.furniture.map(async (asset) => {
    const png = await decodePng(`${ASSET_BASE_URL}${asset.furniturePath}`);
    return [asset.id, readSprite(png, asset.width, asset.height)] as const;
  }));
  return Object.fromEntries(entries);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return (await res.json()) as T;
}

export function loadPixelAssets(): Promise<LoadedPixelAssets> {
  loadPromise ??= (async () => {
    const index = await fetchJson<AssetIndex>(`${ASSET_BASE_URL}pixels-office-assets.json`);

    const layoutPaths = index.layouts ?? {
      office: index.defaultLayout,
      boardroomKitchen: index.defaultLayout,
    };

    const [characters, floors, walls, furnitureSprites, officeLayout, boardroomKitchenLayout] = await Promise.all([
      decodeCharacters(index),
      decodeFloors(index),
      decodeWalls(index),
      decodeFurniture(index),
      fetchJson<OfficeLayout>(`${ASSET_BASE_URL}${layoutPaths.office}`).then(trimLayoutToVisibleRoom),
      fetchJson<OfficeLayout>(`${ASSET_BASE_URL}${layoutPaths.boardroomKitchen}`).then(trimLayoutToVisibleRoom),
    ]);

    setCharacterTemplates(characters);
    setFloorSprites(floors);
    setWallSprites(walls);
    buildDynamicCatalog({ catalog: index.furniture, sprites: furnitureSprites });

    const combined = combineLayouts(officeLayout, boardroomKitchenLayout);

    return {
      layouts: {
        office: officeLayout,
        boardroomKitchen: boardroomKitchenLayout,
        combined: combined.layout,
      },
      cameraBounds: combined.cameraBounds,
    };
  })().catch((error: unknown) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}
