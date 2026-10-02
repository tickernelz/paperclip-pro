import type { SceneView } from './renderer';
import type { OfficeState } from './officeState';
import type { StaticLayer } from './staticLayer';

const DOT_COLOR = '#f5f5f5';
const DOT_ACTIVE_COLOR = '#4ade80';
const VIEWPORT_COLOR = 'rgba(255, 255, 255, 0.85)';
const BACKDROP_COLOR = 'rgba(12, 12, 16, 0.9)';

export class Minimap {
  private cache: HTMLCanvasElement | null = null;
  private cacheSource: HTMLCanvasElement | null = null;
  private cacheWidth = 0;
  private cacheHeight = 0;

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layer: StaticLayer | null,
    state: OfficeState,
    view: SceneView,
  ): void {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = BACKDROP_COLOR;
    ctx.fillRect(0, 0, width, height);
    if (!layer || layer.width === 0 || layer.height === 0) return;

    const scale = Math.min(width / layer.width, height / layer.height);
    const drawWidth = Math.max(1, Math.floor(layer.width * scale));
    const drawHeight = Math.max(1, Math.floor(layer.height * scale));
    const originX = Math.floor((width - drawWidth) / 2);
    const originY = Math.floor((height - drawHeight) / 2);

    if (
      !this.cache ||
      this.cacheSource !== layer.canvas ||
      this.cacheWidth !== drawWidth ||
      this.cacheHeight !== drawHeight
    ) {
      const cache = this.cache ?? document.createElement('canvas');
      cache.width = drawWidth;
      cache.height = drawHeight;
      const cacheCtx = cache.getContext('2d')!;
      cacheCtx.clearRect(0, 0, drawWidth, drawHeight);
      cacheCtx.imageSmoothingEnabled = true;
      cacheCtx.drawImage(layer.canvas, 0, 0, drawWidth, drawHeight);
      this.cache = cache;
      this.cacheSource = layer.canvas;
      this.cacheWidth = drawWidth;
      this.cacheHeight = drawHeight;
    }

    ctx.drawImage(this.cache, originX, originY);

    const dotSize = Math.max(1, Math.round(scale * 6));
    for (const ch of state.characters.values()) {
      ctx.fillStyle = ch.isActive && !ch.still ? DOT_ACTIVE_COLOR : DOT_COLOR;
      ctx.fillRect(
        originX + Math.round(ch.x * scale) - (dotSize >> 1),
        originY + Math.round(ch.y * scale) - (dotSize >> 1),
        dotSize,
        dotSize,
      );
    }

    const viewWorldX = -view.offsetX / view.zoom;
    const viewWorldY = -view.offsetY / view.zoom;
    const viewWorldW = view.width / view.zoom;
    const viewWorldH = view.height / view.zoom;
    ctx.strokeStyle = VIEWPORT_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      originX + Math.round(viewWorldX * scale) + 0.5,
      originY + Math.round(viewWorldY * scale) + 0.5,
      Math.max(2, Math.round(viewWorldW * scale)),
      Math.max(2, Math.round(viewWorldH * scale)),
    );
  }
}
