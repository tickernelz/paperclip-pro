import {
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  HOP_DURATION_SEC,
  HOP_HEIGHT_PX,
  HOVERED_OUTLINE_ALPHA,
  OUTLINE_Z_SORT_OFFSET,
  SELECTED_OUTLINE_ALPHA,
} from '../constants';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache';
import { getCharacterSprites } from '../sprites/spriteData';
import type { FurnitureInstance } from '../types';
import { CharacterState, TILE_SIZE } from '../types';
import { getCharacterSprite } from './characters';
import type { OfficeState } from './officeState';
import type { StaticLayer } from './staticLayer';

export interface SceneView {
  zoom: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export class SceneRenderer {
  private capacity = 0;
  private sprites: HTMLCanvasElement[] = [];
  private drawX = new Float64Array(0);
  private drawY = new Float64Array(0);
  private depth = new Float64Array(0);
  private alpha = new Float64Array(0);
  private mirrored = new Uint8Array(0);
  private order = new Int32Array(0);
  private buckets = new Int32Array(0);
  private count = 0;

  render(
    ctx: CanvasRenderingContext2D,
    state: OfficeState,
    layer: StaticLayer | null,
    view: SceneView,
  ): void {
    ctx.clearRect(0, 0, view.width, view.height);
    if (layer) blitStaticLayer(ctx, layer, view);

    this.count = 0;
    for (const instance of state.dynamicFurniture) this.pushInstance(instance, view);
    for (let i = 0; i < state.switchable.length; i++) {
      this.pushInstance(state.resolveSwitchable(i), view);
    }

    for (const ch of state.characters.values()) {
      const spriteData = getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift));
      const cached = getCachedSprite(spriteData, view.zoom);
      const sitting = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const hop =
        ch.hop > 0
          ? Math.sin((1 - ch.hop / HOP_DURATION_SEC) * Math.PI) * HOP_HEIGHT_PX
          : 0;
      const drawX = Math.round(view.offsetX + ch.x * view.zoom - cached.width / 2);
      const drawY = Math.round(view.offsetY + (ch.y + sitting - hop) * view.zoom - cached.height);
      if (drawX > view.width || drawX + cached.width < 0) continue;
      if (drawY > view.height || drawY + cached.height < 0) continue;
      const depth = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;

      const selected = state.selectedAgentId === ch.id;
      const hovered = state.hoveredAgentId === ch.id;
      if (selected || hovered) {
        const outline = getCachedSprite(getOutlineSprite(spriteData), view.zoom);
        this.push(
          outline,
          drawX - view.zoom,
          drawY - view.zoom,
          depth - OUTLINE_Z_SORT_OFFSET,
          selected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA,
          false,
        );
      }
      this.push(cached, drawX, drawY, depth, 1, false);
    }

    this.sortByDepth();

    for (let i = 0; i < this.count; i++) {
      const index = this.order[i];
      const sprite = this.sprites[index];
      const alpha = this.alpha[index];
      const faded = alpha < 1;
      if (faded) {
        ctx.save();
        ctx.globalAlpha = alpha;
      }
      if (this.mirrored[index] === 1) {
        ctx.save();
        ctx.translate(this.drawX[index] + sprite.width, this.drawY[index]);
        ctx.scale(-1, 1);
        ctx.drawImage(sprite, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, this.drawX[index], this.drawY[index]);
      }
      if (faded) ctx.restore();
    }
  }

  private sortByDepth(): void {
    const n = this.count;
    let maxDepth = 0;
    for (let i = 0; i < n; i++) {
      const depth = this.depth[i] | 0;
      if (depth > maxDepth) maxDepth = depth;
    }
    if (this.buckets.length < maxDepth + 2) this.buckets = new Int32Array(maxDepth + 128);
    if (this.order.length < n) this.order = new Int32Array(this.capacity);
    const buckets = this.buckets;
    buckets.fill(0, 0, maxDepth + 2);
    for (let i = 0; i < n; i++) buckets[(this.depth[i] | 0) + 1]++;
    for (let b = 1; b <= maxDepth + 1; b++) buckets[b] += buckets[b - 1];
    for (let i = 0; i < n; i++) {
      const depth = this.depth[i] | 0;
      this.order[buckets[depth]] = i;
      buckets[depth]++;
    }
  }

  private pushInstance(instance: FurnitureInstance, view: SceneView): void {
    const cached = getCachedSprite(instance.sprite, view.zoom);
    const drawX = view.offsetX + instance.x * view.zoom;
    const drawY = view.offsetY + instance.y * view.zoom;
    if (drawX > view.width || drawX + cached.width < 0) return;
    if (drawY > view.height || drawY + cached.height < 0) return;
    this.push(cached, drawX, drawY, instance.zY, 1, instance.mirrored === true);
  }

  private push(
    sprite: HTMLCanvasElement,
    x: number,
    y: number,
    depth: number,
    alpha: number,
    mirrored: boolean,
  ): void {
    if (this.count === this.capacity) this.grow();
    this.sprites[this.count] = sprite;
    this.drawX[this.count] = x;
    this.drawY[this.count] = y;
    this.depth[this.count] = depth;
    this.alpha[this.count] = alpha;
    this.mirrored[this.count] = mirrored ? 1 : 0;
    this.count++;
  }

  private grow(): void {
    const next = this.capacity === 0 ? 256 : this.capacity * 2;
    const drawX = new Float64Array(next);
    const drawY = new Float64Array(next);
    const depth = new Float64Array(next);
    const alpha = new Float64Array(next);
    const mirrored = new Uint8Array(next);
    drawX.set(this.drawX);
    drawY.set(this.drawY);
    depth.set(this.depth);
    alpha.set(this.alpha);
    mirrored.set(this.mirrored);
    this.drawX = drawX;
    this.drawY = drawY;
    this.depth = depth;
    this.alpha = alpha;
    this.mirrored = mirrored;
    this.sprites.length = next;
    this.capacity = next;
  }
}

function blitStaticLayer(
  ctx: CanvasRenderingContext2D,
  layer: StaticLayer,
  view: SceneView,
): void {
  const layerOffsetY = view.offsetY + layer.originY * view.zoom;
  const sourceX = Math.max(0, Math.floor(-view.offsetX / view.zoom));
  const sourceY = Math.max(0, Math.floor(-layerOffsetY / view.zoom));
  const sourceRight = Math.min(layer.width, Math.ceil((view.width - view.offsetX) / view.zoom));
  const sourceBottom = Math.min(layer.height, Math.ceil((view.height - layerOffsetY) / view.zoom));
  const sourceW = sourceRight - sourceX;
  const sourceH = sourceBottom - sourceY;
  if (sourceW <= 0 || sourceH <= 0) return;

  ctx.drawImage(
    layer.canvas,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    view.offsetX + sourceX * view.zoom,
    layerOffsetY + sourceY * view.zoom,
    sourceW * view.zoom,
    sourceH * view.zoom,
  );
}
