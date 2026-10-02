export const PIXEL_FONT_HEIGHT = 5;
export const PIXEL_GLYPH_WIDTH = 3;
export const PIXEL_GLYPH_ADVANCE = 4;
export const PIXEL_SPACE_ADVANCE = 3;

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_/#!?:+@'(), ";

const GLYPH_ROWS = [
  "###" + "#.#" + "###" + "#.#" + "#.#",
  "##." + "#.#" + "##." + "#.#" + "##.",
  ".##" + "#.." + "#.." + "#.." + ".##",
  "##." + "#.#" + "#.#" + "#.#" + "##.",
  "###" + "#.." + "##." + "#.." + "###",
  "###" + "#.." + "##." + "#.." + "#..",
  ".##" + "#.." + "#.#" + "#.#" + ".##",
  "#.#" + "#.#" + "###" + "#.#" + "#.#",
  "###" + ".#." + ".#." + ".#." + "###",
  "..#" + "..#" + "..#" + "#.#" + ".#.",
  "#.#" + "#.#" + "##." + "#.#" + "#.#",
  "#.." + "#.." + "#.." + "#.." + "###",
  "#.#" + "###" + "###" + "#.#" + "#.#",
  "#.#" + "##." + "###" + ".##" + "#.#",
  ".#." + "#.#" + "#.#" + "#.#" + ".#.",
  "##." + "#.#" + "##." + "#.." + "#..",
  ".#." + "#.#" + "#.#" + "###" + ".##",
  "##." + "#.#" + "##." + "#.#" + "#.#",
  ".##" + "#.." + ".#." + "..#" + "##.",
  "###" + ".#." + ".#." + ".#." + ".#.",
  "#.#" + "#.#" + "#.#" + "#.#" + "###",
  "#.#" + "#.#" + "#.#" + "#.#" + ".#.",
  "#.#" + "#.#" + "###" + "###" + "#.#",
  "#.#" + "#.#" + ".#." + "#.#" + "#.#",
  "#.#" + "#.#" + ".#." + ".#." + ".#.",
  "###" + "..#" + ".#." + "#.." + "###",
  ".#." + "#.#" + "#.#" + "#.#" + ".#.",
  ".#." + "##." + ".#." + ".#." + "###",
  "##." + "..#" + ".#." + "#.." + "###",
  "##." + "..#" + ".#." + "..#" + "##.",
  "#.#" + "#.#" + "###" + "..#" + "..#",
  "###" + "#.." + "##." + "..#" + "##.",
  ".##" + "#.." + "###" + "#.#" + "###",
  "###" + "..#" + ".#." + ".#." + ".#.",
  "###" + "#.#" + "###" + "#.#" + "###",
  "###" + "#.#" + "###" + "..#" + "##.",
  "..." + "..." + "..." + "..." + ".#.",
  "..." + "..." + "###" + "..." + "...",
  "..." + "..." + "..." + "..." + "###",
  "..#" + "..#" + ".#." + "#.." + "#..",
  "#.#" + "###" + "#.#" + "###" + "#.#",
  ".#." + ".#." + ".#." + "..." + ".#.",
  "##." + "..#" + ".#." + "..." + ".#.",
  "..." + ".#." + "..." + ".#." + "...",
  "..." + ".#." + "###" + ".#." + "...",
  "###" + "#.#" + "###" + "#.." + ".##",
  ".#." + ".#." + "..." + "..." + "...",
  "..#" + ".#." + ".#." + ".#." + "..#",
  "#.." + ".#." + ".#." + ".#." + "#..",
  "..." + "..." + "..." + ".#." + "#..",
  "..." + "..." + "..." + "..." + "...",
];

const SPACE_INDEX = CHARSET.length - 1;
const GLYPH_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < CHARSET.length; i += 1) {
  GLYPH_LOOKUP[CHARSET.charCodeAt(i)] = i;
}
for (let code = 97; code <= 122; code += 1) {
  GLYPH_LOOKUP[code] = GLYPH_LOOKUP[code - 32];
}

export function measureLabelWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const index = code < 128 ? GLYPH_LOOKUP[code] : -1;
    if (index < 0) continue;
    width += index === SPACE_INDEX ? PIXEL_SPACE_ADVANCE : PIXEL_GLYPH_ADVANCE;
  }
  return width > 0 ? width - 1 : 0;
}

export interface GlyphAtlas {
  readonly zoom: number;
  readonly color: string;
  readonly height: number;
  drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void;
}

const ATLAS_CACHE_LIMIT = 4;
const atlasCache = new Map<string, GlyphAtlas | null>();

function createAtlas(zoom: number, color: string): GlyphAtlas | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = CHARSET.length * PIXEL_GLYPH_WIDTH * zoom;
  canvas.height = PIXEL_FONT_HEIGHT * zoom;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = color;
  for (let g = 0; g < GLYPH_ROWS.length; g += 1) {
    const rows = GLYPH_ROWS[g];
    const baseX = g * PIXEL_GLYPH_WIDTH * zoom;
    for (let r = 0; r < PIXEL_FONT_HEIGHT; r += 1) {
      for (let c = 0; c < PIXEL_GLYPH_WIDTH; c += 1) {
        if (rows.charCodeAt(r * PIXEL_GLYPH_WIDTH + c) !== 35) continue;
        ctx.fillRect(baseX + c * zoom, r * zoom, zoom, zoom);
      }
    }
  }
  const cellWidth = PIXEL_GLYPH_WIDTH * zoom;
  const cellHeight = PIXEL_FONT_HEIGHT * zoom;
  return {
    zoom,
    color,
    height: cellHeight,
    drawText(target, text, x, y) {
      let penX = x;
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        const index = code < 128 ? GLYPH_LOOKUP[code] : -1;
        if (index < 0) continue;
        if (index === SPACE_INDEX) {
          penX += PIXEL_SPACE_ADVANCE * zoom;
          continue;
        }
        target.drawImage(
          canvas,
          index * cellWidth,
          0,
          cellWidth,
          cellHeight,
          penX,
          y,
          cellWidth,
          cellHeight,
        );
        penX += PIXEL_GLYPH_ADVANCE * zoom;
      }
    },
  };
}

export function getGlyphAtlas(zoom: number, color: string): GlyphAtlas | null {
  const scale = Math.max(1, Math.round(zoom));
  const key = `${scale}|${color}`;
  const cached = atlasCache.get(key);
  if (cached !== undefined) {
    atlasCache.delete(key);
    atlasCache.set(key, cached);
    return cached;
  }
  const atlas = createAtlas(scale, color);
  atlasCache.set(key, atlas);
  if (atlasCache.size > ATLAS_CACHE_LIMIT) {
    const oldest = atlasCache.keys().next();
    if (!oldest.done) atlasCache.delete(oldest.value);
  }
  return atlas;
}

export function glyphAtlasCacheSize(): number {
  return atlasCache.size;
}

export function resetGlyphAtlasCache(): void {
  atlasCache.clear();
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function compareBoxes(a: LabelBox, b: LabelBox): number {
  return a.y - b.y || a.x - b.x;
}

export function declutterLabelBoxes(boxes: LabelBox[], gap: number): void {
  const n = boxes.length;
  if (n < 2) return;
  boxes.sort(compareBoxes);
  for (let i = 1; i < n; i += 1) {
    const box = boxes[i];
    for (let pass = 0; pass < n; pass += 1) {
      let moved = false;
      for (let j = 0; j < i; j += 1) {
        const other = boxes[j];
        if (box.x >= other.x + other.w || other.x >= box.x + box.w) continue;
        if (box.y >= other.y + other.h + gap || other.y >= box.y + box.h + gap) continue;
        box.y = other.y + other.h + gap;
        moved = true;
      }
      if (!moved) break;
    }
  }
}
