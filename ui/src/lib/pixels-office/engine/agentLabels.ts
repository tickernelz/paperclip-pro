import type { Character } from "../types";

const LABEL_FILL = "#f9fafb";
const LABEL_STROKE = "#000";
const LABEL_MIN_FONT_PX = 10;
const LABEL_FONT_ZOOM_FACTOR = 5;
const LABEL_MIN_STROKE_PX = 2;
const LABEL_BASELINE_OFFSET_PX = 8;

export function drawAgentLabels(
  ctx: CanvasRenderingContext2D,
  characters: Iterable<Character>,
  labelById: Map<string, string>,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  ctx.save();
  ctx.font = `${Math.max(LABEL_MIN_FONT_PX, Math.floor(LABEL_FONT_ZOOM_FACTOR * zoom))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = LABEL_FILL;
  ctx.strokeStyle = LABEL_STROKE;
  ctx.lineWidth = Math.max(LABEL_MIN_STROKE_PX, zoom);
  for (const character of characters) {
    const label = labelById.get(character.id);
    if (!label) continue;
    const x = offsetX + character.x * zoom;
    const y = offsetY + (character.y + LABEL_BASELINE_OFFSET_PX) * zoom;
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}
