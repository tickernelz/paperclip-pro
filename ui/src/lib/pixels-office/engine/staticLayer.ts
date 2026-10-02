import {
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  FALLBACK_FLOOR_COLOR,
} from '../constants';
import { getColorizedFloorSprite, hasFloorSprites, WALL_COLOR } from '../floorTiles';
import type { NavGrid } from '../layout/tileMap';
import { getCachedSprite } from '../sprites/spriteCache';
import type {
  ColorValue,
  FurnitureInstance,
  OfficeLayout,
  Seat,
  TileType as TileTypeVal,
} from '../types';
import { TILE_SIZE, TileType } from '../types';
import { wallColorToHex } from '../wallTiles';

const CHARACTER_SPRITE_W = 16;
const CHARACTER_SPRITE_H = 32;

export interface StaticLayer {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  originY: number;
}

export function classifyOccluders(
  instances: FurnitureInstance[],
  nav: NavGrid,
  seats: Iterable<Seat>,
): Uint8Array {
  const seatTiles = new Set<number>();
  for (const seat of seats) seatTiles.add(seat.seatRow * nav.cols + seat.seatCol);

  const flags = new Uint8Array(instances.length);
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    const left = instance.x;
    const right = instance.x + instance.sprite[0].length;
    const top = instance.y;
    const bottom = instance.y + instance.sprite.length;

    const firstCol = Math.max(0, Math.floor(left / TILE_SIZE) - 1);
    const lastCol = Math.min(nav.cols - 1, Math.ceil(right / TILE_SIZE));
    const firstRow = Math.max(0, Math.floor(top / TILE_SIZE) - 1);
    const lastRow = Math.min(nav.rows - 1, Math.ceil(bottom / TILE_SIZE) + 2);

    for (let row = firstRow; row <= lastRow && flags[i] === 0; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        if (!nav.isWalkable(col, row) && !seatTiles.has(row * nav.cols + col)) continue;
        const charZY = row * TILE_SIZE + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;
        if (charZY >= instance.zY) continue;
        const charLeft = col * TILE_SIZE + TILE_SIZE / 2 - CHARACTER_SPRITE_W / 2;
        const charBottom = row * TILE_SIZE + TILE_SIZE / 2 + CHARACTER_SITTING_OFFSET_PX;
        const charTop = charBottom - CHARACTER_SPRITE_H;
        if (charLeft >= right || charLeft + CHARACTER_SPRITE_W <= left) continue;
        if (charTop >= bottom || charBottom <= top) continue;
        flags[i] = 1;
        break;
      }
    }
  }
  liftStackedItems(instances, flags);
  return flags;
}

function spriteOverlaps(a: FurnitureInstance, b: FurnitureInstance): boolean {
  return (
    a.x < b.x + b.sprite[0].length &&
    b.x < a.x + a.sprite[0].length &&
    a.y < b.y + b.sprite.length &&
    b.y < a.y + a.sprite.length
  );
}

function liftStackedItems(instances: FurnitureInstance[], flags: Uint8Array): void {
  const dynamic: number[] = [];
  for (let i = 0; i < instances.length; i++) if (flags[i] === 1) dynamic.push(i);
  for (let cursor = 0; cursor < dynamic.length; cursor++) {
    const below = instances[dynamic[cursor]];
    for (let i = 0; i < instances.length; i++) {
      if (flags[i] === 1) continue;
      const above = instances[i];
      if (above.zY <= below.zY || !spriteOverlaps(above, below)) continue;
      flags[i] = 1;
      dynamic.push(i);
    }
  }
}

export function drawablesTop(drawables: readonly FurnitureInstance[]): number {
  let top = 0;
  for (const instance of drawables) {
    if (instance.y < top) top = Math.floor(instance.y);
  }
  return top;
}

export function buildStaticLayer(
  layout: OfficeLayout,
  tileMap: TileTypeVal[][],
  drawables: FurnitureInstance[],
): StaticLayer {
  const originY = drawablesTop(drawables);

  const width = layout.cols * TILE_SIZE;
  const height = layout.rows * TILE_SIZE - originY;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(0, -originY);

  drawTiles(ctx, tileMap, layout.tileColors, layout.cols);

  const order = drawables.map((_, index) => index);
  order.sort((a, b) => drawables[a].zY - drawables[b].zY);
  for (const index of order) {
    const instance = drawables[index];
    const cached = getCachedSprite(instance.sprite, 1);
    if (instance.mirrored) {
      ctx.save();
      ctx.translate(instance.x + cached.width, instance.y);
      ctx.scale(-1, 1);
      ctx.drawImage(cached, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(cached, instance.x, instance.y);
    }
  }

  return { canvas, width, height, originY };
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  tileColors: Array<ColorValue | null> | undefined,
  cols: number,
): void {
  const useSpriteFloors = hasFloorSprites();
  for (let row = 0; row < tileMap.length; row++) {
    const line = tileMap[row];
    for (let col = 0; col < line.length; col++) {
      const tile = line[col];
      if (tile === TileType.VOID) continue;
      const colorIndex = row * cols + col;

      if (tile === TileType.WALL || !useSpriteFloors) {
        if (tile === TileType.WALL) {
          const wallColor = tileColors?.[colorIndex];
          ctx.fillStyle = wallColor ? wallColorToHex(wallColor) : WALL_COLOR;
        } else {
          ctx.fillStyle = FALLBACK_FLOOR_COLOR;
        }
        ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        continue;
      }

      const color = tileColors?.[colorIndex] ?? { h: 0, s: 0, b: 0, c: 0 };
      ctx.drawImage(
        getCachedSprite(getColorizedFloorSprite(tile, color), 1),
        col * TILE_SIZE,
        row * TILE_SIZE,
      );
    }
  }
}
