import { CHARACTER_SITTING_OFFSET_PX, CHARACTER_Z_SORT_OFFSET } from '../constants';
import type { OfficeHit, OfficeObjectKind } from '../officeModel';
import type { Character } from '../types';
import { CharacterState, TILE_SIZE } from '../types';

const CHARACTER_SPRITE_W = 16;
const CHARACTER_SPRITE_H = 32;

export interface ObjectBox {
  kind: OfficeObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function hitTestWorld(
  worldX: number,
  worldY: number,
  characters: Iterable<Character>,
  objects: readonly ObjectBox[],
): OfficeHit {
  let topId: string | null = null;
  let topZ = Number.NEGATIVE_INFINITY;

  for (const ch of characters) {
    const sitting = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const left = ch.x - CHARACTER_SPRITE_W / 2;
    const bottom = ch.y + sitting;
    if (worldX < left || worldX > left + CHARACTER_SPRITE_W) continue;
    if (worldY > bottom || worldY < bottom - CHARACTER_SPRITE_H) continue;
    const zY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;
    if (zY <= topZ) continue;
    topZ = zY;
    topId = ch.id;
  }

  if (topId !== null) return { kind: 'agent', agentId: topId };

  for (const object of objects) {
    if (worldX < object.x || worldX > object.x + object.width) continue;
    if (worldY < object.y || worldY > object.y + object.height) continue;
    return { kind: 'object', object: object.kind };
  }

  return null;
}
