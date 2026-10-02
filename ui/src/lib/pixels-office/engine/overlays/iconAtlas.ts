export const ICON_SIZE = 7;

export type IconKey =
  | "read"
  | "write"
  | "run"
  | "web"
  | "think0"
  | "think1"
  | "think2"
  | "comment"
  | "other"
  | "bangRed"
  | "bangYellow"
  | "sleep"
  | "coin"
  | "mention";

interface IconDef {
  rows: string;
  primary: string;
  secondary: string;
}

const ICONS: Record<IconKey, IconDef> = {
  read: {
    rows:
      ".#####." +
      ".#...#." +
      ".#ooo#." +
      ".#...#." +
      ".#ooo#." +
      ".#...#." +
      ".#####.",
    primary: "#e5e7eb",
    secondary: "#60a5fa",
  },
  write: {
    rows:
      ".....oo" +
      "....oo#" +
      "...oo#." +
      "..oo#.." +
      ".oo#..." +
      "oo#...." +
      "##.....",
    primary: "#fbbf24",
    secondary: "#fde68a",
  },
  run: {
    rows:
      "......." +
      "#o....." +
      ".#o...." +
      "..#o..." +
      ".#o...." +
      "#o....." +
      "..#####",
    primary: "#34d399",
    secondary: "#065f46",
  },
  web: {
    rows:
      "..###.." +
      ".#ooo#." +
      "#o#o#o#" +
      "#ooooo#" +
      "#o#o#o#" +
      ".#ooo#." +
      "..###..",
    primary: "#38bdf8",
    secondary: "#0c4a6e",
  },
  think0: {
    rows:
      ".#####." +
      "#.....#" +
      "#o....#" +
      "#.....#" +
      ".####.." +
      "..#...." +
      ".#.....",
    primary: "#cbd5f5",
    secondary: "#f9fafb",
  },
  think1: {
    rows:
      ".#####." +
      "#.....#" +
      "#o.o..#" +
      "#.....#" +
      ".####.." +
      "..#...." +
      ".#.....",
    primary: "#cbd5f5",
    secondary: "#f9fafb",
  },
  think2: {
    rows:
      ".#####." +
      "#.....#" +
      "#o.o.o#" +
      "#.....#" +
      ".####.." +
      "..#...." +
      ".#.....",
    primary: "#cbd5f5",
    secondary: "#f9fafb",
  },
  comment: {
    rows:
      "#####.." +
      "#ooo#.." +
      "#ooo#.." +
      "#ooo#.." +
      "#####.." +
      "..#...." +
      ".#.....",
    primary: "#a78bfa",
    secondary: "#ede9fe",
  },
  other: {
    rows:
      "......." +
      "..###.." +
      ".#ooo#." +
      ".#ooo#." +
      ".#ooo#." +
      "..###.." +
      ".......",
    primary: "#9ca3af",
    secondary: "#d1d5db",
  },
  bangRed: {
    rows:
      "..###.." +
      "..###.." +
      "..###.." +
      "..###.." +
      "..oo#.." +
      "......." +
      "..###..",
    primary: "#f87171",
    secondary: "#991b1b",
  },
  bangYellow: {
    rows:
      "..###.." +
      "..###.." +
      "..###.." +
      "..###.." +
      "..oo#.." +
      "......." +
      "..###..",
    primary: "#facc15",
    secondary: "#854d0e",
  },
  sleep: {
    rows:
      "###...." +
      "..#...." +
      ".#....." +
      "###.###" +
      ".....#." +
      "....#.." +
      "....###",
    primary: "#93c5fd",
    secondary: "#93c5fd",
  },
  coin: {
    rows:
      "......." +
      "..###.." +
      ".#ooo#." +
      ".#o#o#." +
      ".#ooo#." +
      "..###.." +
      ".......",
    primary: "#fbbf24",
    secondary: "#fde68a",
  },
  mention: {
    rows:
      ".#####." +
      "#.....#" +
      "#.###.#" +
      "#.#.#.#" +
      "#.###.#" +
      "#......" +
      ".#####.",
    primary: "#67e8f9",
    secondary: "#155e75",
  },
};

const ICON_ORDER = Object.keys(ICONS) as IconKey[];
const ICON_INDEX = {} as Record<IconKey, number>;
for (let i = 0; i < ICON_ORDER.length; i += 1) {
  ICON_INDEX[ICON_ORDER[i]] = i;
}

export interface IconAtlas {
  readonly zoom: number;
  readonly size: number;
  draw(ctx: CanvasRenderingContext2D, key: IconKey, x: number, y: number): void;
}

const ATLAS_CACHE_LIMIT = 3;
const atlasCache = new Map<number, IconAtlas | null>();

function createIconAtlas(zoom: number): IconAtlas | null {
  if (typeof document === "undefined") return null;
  const cell = ICON_SIZE * zoom;
  const canvas = document.createElement("canvas");
  canvas.width = cell * ICON_ORDER.length;
  canvas.height = cell;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (let i = 0; i < ICON_ORDER.length; i += 1) {
    const def = ICONS[ICON_ORDER[i]];
    const baseX = i * cell;
    for (let r = 0; r < ICON_SIZE; r += 1) {
      for (let c = 0; c < ICON_SIZE; c += 1) {
        const code = def.rows.charCodeAt(r * ICON_SIZE + c);
        if (code === 46) continue;
        ctx.fillStyle = code === 35 ? def.primary : def.secondary;
        ctx.fillRect(baseX + c * zoom, r * zoom, zoom, zoom);
      }
    }
  }
  return {
    zoom,
    size: cell,
    draw(target, key, x, y) {
      const index = ICON_INDEX[key];
      target.drawImage(canvas, index * cell, 0, cell, cell, x, y, cell, cell);
    },
  };
}

export function getIconAtlas(zoom: number): IconAtlas | null {
  const scale = Math.max(1, Math.round(zoom));
  const cached = atlasCache.get(scale);
  if (cached !== undefined) {
    atlasCache.delete(scale);
    atlasCache.set(scale, cached);
    return cached;
  }
  const atlas = createIconAtlas(scale);
  atlasCache.set(scale, atlas);
  if (atlasCache.size > ATLAS_CACHE_LIMIT) {
    const oldest = atlasCache.keys().next();
    if (!oldest.done) atlasCache.delete(oldest.value);
  }
  return atlas;
}

export function iconAtlasCacheSize(): number {
  return atlasCache.size;
}
