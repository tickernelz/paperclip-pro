import {
  BLOCKED_GIVE_UP_AFTER_SEC,
  BLOCKED_REPATH_AFTER_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_TARGET_ATTEMPTS,
} from '../constants';
import type { NavGrid } from '../layout/tileMap';
import type { TileClaims } from './tileClaims';
import type { CharacterSprites } from '../sprites/spriteData';
import type { Character, Seat, SpriteData } from '../types';
import { CharacterState, Direction, TILE_SIZE } from '../types';

const READING_TOOLS: Record<string, true> = {
  Read: true,
  Grep: true,
  Glob: true,
  WebFetch: true,
  WebSearch: true,
};

export function isReadingTool(tool: string | null): boolean {
  return tool !== null && READING_TOOLS[tool] === true;
}

function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: string,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    blockedTimer: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    still: false,
    pinned: false,
    hop: 0,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export function isCharacterAnimating(ch: Character): boolean {
  if (ch.state === CharacterState.WALK) return true;
  if (ch.state === CharacterState.TYPE) return !ch.still;
  return false;
}

export function updateCharacter(
  ch: Character,
  dt: number,
  nav: NavGrid,
  seats: Map<string, Seat>,
  claims: TileClaims,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.still) {
        ch.frame = 0;
        ch.frameTimer = 0;
      } else if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }

      if (!ch.isActive && !ch.pinned) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0;
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.IDLE: {
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0;
      if (ch.pinned) break;

      if (ch.isActive) {
        const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
        if (!seat) {
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const path = nav.findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, true);
        if (path.length > 0) {
          ch.path = path;
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
        } else {
          ch.state = CharacterState.TYPE;
          ch.dir = seat.facingDir;
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        if (ch.wanderCount >= ch.wanderLimit) {
          ch.wanderCount = 0;
          ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
        }
        const tiles = nav.walkableTiles;
        let target = null;
        for (let attempt = 0; attempt < WANDER_TARGET_ATTEMPTS && tiles.length > 0; attempt++) {
          const candidate = tiles[Math.floor(Math.random() * tiles.length)];
          if (claims.isFreeFor(ch.id, candidate.col, candidate.row)) {
            target = candidate;
            break;
          }
        }
        if (target) {
          const path = nav.findPath(ch.tileCol, ch.tileRow, target.col, target.row);
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2;

        const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
        const atSeat = seat ? ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow : false;
        if (atSeat && seat) {
          ch.state = CharacterState.TYPE;
          ch.dir = seat.facingDir;
        } else if (ch.isActive && !ch.pinned && !seat) {
          ch.state = CharacterState.TYPE;
        } else if (ch.isActive && !ch.pinned) {
          ch.state = CharacterState.IDLE;
        } else {
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);
      if (ch.moveProgress === 0 && !claims.claim(ch.id, nextTile.col, nextTile.row)) {
        ch.blockedTimer += dt;
        ch.frame = 1;
        if (ch.blockedTimer < BLOCKED_REPATH_AFTER_SEC) break;
        const goal = ch.path[ch.path.length - 1];
        const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
        const toOwnSeat = seat !== undefined && seat.seatCol === goal.col && seat.seatRow === goal.row;
        const detour = claims.isFreeFor(ch.id, goal.col, goal.row)
          ? nav.findPath(ch.tileCol, ch.tileRow, goal.col, goal.row, toOwnSeat, claims.blockedFor(ch.id))
          : [];
        if (detour.length > 0) {
          ch.path = detour;
          ch.blockedTimer = 0;
        } else if (ch.blockedTimer >= BLOCKED_GIVE_UP_AFTER_SEC) {
          ch.path = [];
          ch.blockedTimer = 0;
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(0.5, 2);
          ch.frame = 0;
          ch.frameTimer = 0;
        }
        break;
      }
      ch.blockedTimer = 0;
      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromX = ch.tileCol * TILE_SIZE + TILE_SIZE / 2;
      const fromY = ch.tileRow * TILE_SIZE + TILE_SIZE / 2;
      const toX = nextTile.col * TILE_SIZE + TILE_SIZE / 2;
      const toY = nextTile.row * TILE_SIZE + TILE_SIZE / 2;
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromX + (toX - fromX) * t;
      ch.y = fromY + (toY - fromY) * t;

      if (ch.moveProgress >= 1) {
        claims.release(ch.id, ch.tileCol, ch.tileRow);
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toX;
        ch.y = toY;
        ch.path.shift();
        ch.moveProgress = 0;
      }
      break;
    }
  }
}

export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    default:
      return sprites.walk[ch.dir][1];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
