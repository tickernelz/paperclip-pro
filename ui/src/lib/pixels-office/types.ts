export { DEFAULT_COLS, DEFAULT_ROWS, MAX_COLS, MAX_ROWS, TILE_SIZE } from './constants';

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  FLOOR_8: 8,
  FLOOR_9: 9,
  VOID: 255,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export interface ColorValue {
  h: number;
  s: number;
  b: number;
  c: number;
  colorize?: boolean;
}

export const CharacterState = {
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export type SpriteData = string[][];

export interface Seat {

  uid: string;

  seatCol: number;

  seatRow: number;

  facingDir: Direction;
  assigned: boolean;
}

export interface FurnitureInstance {
  sprite: SpriteData;

  x: number;

  y: number;

  zY: number;

  mirrored?: boolean;

  sourceIndex?: number;
}

export interface FurnitureCatalogEntry {
  type: string;
  label: string;
  footprintW: number;
  footprintH: number;
  sprite: SpriteData;
  isDesk: boolean;
  category?: string;

  orientation?: string;

  canPlaceOnSurfaces?: boolean;

  backgroundTiles?: number;

  canPlaceOnWalls?: boolean;

  mirrorSide?: boolean;
}

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;

  color?: ColorValue;
}

export interface OfficeLayout {
  version: 1;
  cols: number;
  rows: number;
  tiles: TileType[];
  furniture: PlacedFurniture[];

  spawnTile?: { col: number; row: number };

  tileColors?: Array<ColorValue | null>;

  layoutRevision?: number;
}

export interface Character {
  id: string;
  state: CharacterState;
  dir: Direction;

  x: number;
  y: number;

  tileCol: number;

  tileRow: number;

  path: Array<{ col: number; row: number }>;

  moveProgress: number;

  currentTool: string | null;

  palette: number;

  hueShift: number;

  frame: number;

  frameTimer: number;

  wanderTimer: number;

  wanderCount: number;

  wanderLimit: number;

  isActive: boolean;

  still: boolean;

  pinned: boolean;

  hop: number;

  seatId: string | null;

  bubbleType: 'permission' | 'waiting' | null;

  bubbleTimer: number;

  seatTimer: number;

  folderName?: string;

  inputTokens: number;

  outputTokens: number;
}
