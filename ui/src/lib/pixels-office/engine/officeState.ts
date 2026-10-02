import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  FURNITURE_ANIM_INTERVAL_SEC,
  HOP_DURATION_SEC,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  WAITING_BUBBLE_DURATION_SEC,
} from '../constants';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer';
import { NavGrid } from '../layout/tileMap';
import { getLoadedCharacterCount } from '../sprites/spriteData';
import { getWallInstances, hasWallSprites } from '../wallTiles';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
} from '../types';
import { CharacterState, Direction, TILE_SIZE } from '../types';
import { createCharacter, isCharacterAnimating, updateCharacter } from './characters';
import { classifyOccluders } from './staticLayer';
import { TileClaims } from './tileClaims';

export interface RestoredPose {
  tileCol: number;
  tileRow: number;
  x: number;
  y: number;
  dir: Direction;
  state: CharacterState;
  palette: number;
  hueShift: number;
  seatId: string | null;
}

export interface AddAgentOptions {
  palette?: number;
  hueShift?: number;
  seatId?: string;
  pose?: RestoredPose;
}

interface SwitchableFurniture {
  off: FurnitureInstance;
  on: FurnitureInstance[];
  tiles: number[];
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  nav: NavGrid;
  claims: TileClaims;
  staticFurniture: FurnitureInstance[] = [];
  dynamicFurniture: FurnitureInstance[] = [];
  switchable: SwitchableFurniture[] = [];
  characters: Map<string, Character> = new Map();
  furnitureAnimTimer = 0;
  selectedAgentId: string | null = null;
  hoveredAgentId: string | null = null;
  private autoOnTiles = new Set<number>();

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.nav = new NavGrid(this.tileMap, this.blockedTiles);
    this.claims = new TileClaims(this.nav.cols, this.nav.rows);
    this.buildFurniture();
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  private buildFurniture(): void {
    const base = this.layout.furniture;
    const variants: PlacedFurniture[] = [];
    const variantRange: Array<{ start: number; count: number } | null> = [];

    for (const item of base) {
      const onType = getOnStateType(item.type);
      if (onType === item.type) {
        variantRange.push(null);
        continue;
      }
      const frames = getAnimationFrames(onType) ?? [onType];
      const start = variants.length;
      for (const frameType of frames) {
        variants.push({ ...item, uid: `${item.uid}:on:${frameType}`, type: frameType });
      }
      variantRange.push({ start, count: frames.length });
    }

    const instances = layoutToFurnitureInstances([...base, ...variants]);
    const baseInstances: Array<FurnitureInstance | null> = new Array(base.length).fill(null);
    const variantInstances: Array<FurnitureInstance | null> = new Array(variants.length).fill(null);
    for (const instance of instances) {
      const source = instance.sourceIndex ?? 0;
      if (source < base.length) baseInstances[source] = instance;
      else variantInstances[source - base.length] = instance;
    }

    const plain: FurnitureInstance[] = [];
    this.switchable = [];
    for (let i = 0; i < base.length; i++) {
      const instance = baseInstances[i];
      if (!instance) continue;
      const range = variantRange[i];
      if (!range) {
        plain.push(instance);
        continue;
      }
      const on: FurnitureInstance[] = [];
      for (let f = 0; f < range.count; f++) {
        const variant = variantInstances[range.start + f];
        if (variant) on.push(variant);
      }
      this.switchable.push({
        off: instance,
        on: on.length > 0 ? on : [instance],
        tiles: this.footprintTiles(base[i]),
      });
    }

    const walls = hasWallSprites()
      ? getWallInstances(this.tileMap, this.layout.tileColors, this.layout.cols)
      : [];
    if (walls.length > 0) plain.push(...walls);
    const occluders = classifyOccluders(plain, this.nav, this.seats.values());
    this.staticFurniture = [];
    this.dynamicFurniture = [];
    for (let i = 0; i < plain.length; i++) {
      if (occluders[i] === 1) this.dynamicFurniture.push(plain[i]);
      else this.staticFurniture.push(plain[i]);
    }
  }

  private footprintTiles(item: PlacedFurniture): number[] {
    const entry = getCatalogEntry(item.type);
    const tiles: number[] = [];
    if (!entry) return tiles;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        tiles.push((item.row + dr) * this.layout.cols + item.col + dc);
      }
    }
    return tiles;
  }

  private getSpawnTile(): { col: number; row: number } {
    const spawn = this.layout.spawnTile;
    if (spawn && this.nav.isWalkable(spawn.col, spawn.row)) return spawn;
    return this.nav.walkableTiles[0] ?? { col: 1, row: 1 };
  }

  private findFreeSeat(): string | null {
    const electronicsTiles = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          electronicsTiles.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }

    const pcSeats: string[] = [];
    const otherSeats: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (seat.assigned) continue;

      let facesPC = false;
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH && !facesPC; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        if (electronicsTiles.has(`${tileCol},${tileRow}`)) {
          facesPC = true;
          break;
        }
        if (dCol !== 0) {
          if (
            electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
            electronicsTiles.has(`${tileCol},${tileRow + 1}`)
          ) {
            facesPC = true;
            break;
          }
        } else if (
          electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
          electronicsTiles.has(`${tileCol + 1},${tileRow}`)
        ) {
          facesPC = true;
          break;
        }
      }
      (facesPC ? pcSeats : otherSeats).push(uid);
    }

    if (pcSeats.length > 0) return pcSeats[Math.floor(Math.random() * pcSeats.length)];
    if (otherSeats.length > 0) return otherSeats[Math.floor(Math.random() * otherSeats.length)];
    return null;
  }

  private pickDiversePalette(): { palette: number; hueShift: number } {
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    const minCount = Math.min(...counts);
    const available: number[] = [];
    for (let i = 0; i < paletteCount; i++) {
      if (counts[i] === minCount) available.push(i);
    }
    const palette = available[Math.floor(Math.random() * available.length)];
    let hueShift = 0;
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG);
    }
    return { palette, hueShift };
  }

  addAgent(id: string, options: AddAgentOptions = {}): void {
    if (this.characters.has(id)) return;

    const pose = options.pose;
    let palette: number;
    let hueShift: number;
    if (pose) {
      palette = pose.palette;
      hueShift = pose.hueShift;
    } else if (options.palette !== undefined) {
      palette = options.palette;
      hueShift = options.hueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    const requestedSeat = pose?.seatId ?? options.seatId;
    let seatId: string | null = null;
    if (requestedSeat) {
      const seat = this.seats.get(requestedSeat);
      if (seat && !seat.assigned) seatId = requestedSeat;
    }
    const seatWasRequested = seatId !== null;
    if (!seatId) seatId = this.findFreeSeat();

    const seat = seatId ? this.seats.get(seatId)! : null;
    if (seat) seat.assigned = true;
    const ch = createCharacter(id, palette, seatId, seat, hueShift);

    if (pose) {
      ch.tileCol = pose.tileCol;
      ch.tileRow = pose.tileRow;
      ch.x = pose.x;
      ch.y = pose.y;
      ch.dir = pose.dir;
      ch.state = pose.state === CharacterState.WALK ? CharacterState.IDLE : pose.state;
      if (pose.state === CharacterState.WALK) this.snapToTile(ch, ch.tileCol, ch.tileRow);
    } else if (!seatWasRequested) {
      const spawn = this.getSpawnTile();
      this.snapToTile(ch, spawn.col, spawn.row);
      ch.state = CharacterState.IDLE;
      ch.dir = Direction.DOWN;
      ch.wanderTimer = Math.random() * 3;
    }

    if (!this.claims.claim(id, ch.tileCol, ch.tileRow)) {
      const free = this.nav.nearestOpen(ch.tileCol, ch.tileRow, (col, row) =>
        this.claims.isFreeFor(id, col, row),
      );
      if (free) {
        this.snapToTile(ch, free.col, free.row);
        if (ch.state === CharacterState.TYPE) ch.state = CharacterState.IDLE;
        this.claims.claim(id, free.col, free.row);
      }
    }

    this.characters.set(id, ch);
  }

  removeAgent(id: string): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.hoveredAgentId === id) this.hoveredAgentId = null;
    this.claims.releaseAll(id);
    this.characters.delete(id);
    this.rebuildAutoOnTiles();
  }

  walkToTile(agentId: string, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch) return false;
    const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
    const ownSeatTarget = seat ? seat.seatCol === col && seat.seatRow === row : false;
    if (!this.nav.isWalkable(col, row) && !ownSeatTarget) return false;
    let goal = { col, row };
    if (!this.claims.isFreeFor(agentId, col, row)) {
      const free = this.nav.nearestOpen(col, row, (c, r) => this.claims.isFreeFor(agentId, c, r));
      if (!free) return false;
      goal = free;
    }
    const path = this.nav.findPath(ch.tileCol, ch.tileRow, goal.col, goal.row, ownSeatTarget);
    if (path.length === 0) return false;
    this.settleClaims(ch);
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  setAgentActive(id: string, active: boolean): void {
    const ch = this.characters.get(id);
    if (!ch || ch.isActive === active) return;
    ch.isActive = active;
    if (!active) {
      ch.seatTimer = -1;
      this.settleClaims(ch);
      ch.path = [];
      ch.moveProgress = 0;
    }
    this.rebuildAutoOnTiles();
  }

  setAgentStill(id: string, still: boolean): void {
    const ch = this.characters.get(id);
    if (!ch || ch.still === still) return;
    ch.still = still;
    this.rebuildAutoOnTiles();
  }

  private snapToTile(ch: Character, col: number, row: number): void {
    ch.tileCol = col;
    ch.tileRow = row;
    ch.x = col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = row * TILE_SIZE + TILE_SIZE / 2;
  }

  private settleClaims(ch: Character): void {
    if (ch.moveProgress > 0 && ch.path.length > 0) {
      const next = ch.path[0];
      this.claims.release(ch.id, ch.tileCol, ch.tileRow);
      this.snapToTile(ch, next.col, next.row);
    }
    this.claims.releaseAll(ch.id);
    this.claims.claim(ch.id, ch.tileCol, ch.tileRow);
  }

  setAgentPinned(id: string, pinned: boolean): void {
    const ch = this.characters.get(id);
    if (ch) ch.pinned = pinned;
  }

  private rebuildAutoOnTiles(): void {
    this.autoOnTiles.clear();
    const cols = this.layout.cols;
    for (const ch of this.characters.values()) {
      if (!ch.isActive || ch.still || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        this.autoOnTiles.add((seat.seatRow + dRow * d) * cols + seat.seatCol + dCol * d);
      }
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          this.autoOnTiles.add((baseRow - 1) * cols + baseCol);
          this.autoOnTiles.add((baseRow + 1) * cols + baseCol);
        } else {
          this.autoOnTiles.add(baseRow * cols + baseCol - 1);
          this.autoOnTiles.add(baseRow * cols + baseCol + 1);
        }
      }
    }
  }

  resolveSwitchable(index: number): FurnitureInstance {
    const entry = this.switchable[index];
    let on = false;
    for (const tile of entry.tiles) {
      if (this.autoOnTiles.has(tile)) {
        on = true;
        break;
      }
    }
    if (!on) return entry.off;
    const frame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    return entry.on[frame % entry.on.length];
  }

  isSwitchableAnimating(): boolean {
    return this.autoOnTiles.size > 0;
  }

  setAgentTool(id: string, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) ch.currentTool = tool;
  }

  showWaitingBubble(id: string): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  startHop(id: string): void {
    const ch = this.characters.get(id);
    if (ch) ch.hop = HOP_DURATION_SEC;
  }

  update(dt: number): boolean {
    this.furnitureAnimTimer += dt;
    let busy = this.isSwitchableAnimating();

    for (const ch of this.characters.values()) {
      updateCharacter(ch, dt, this.nav, this.seats, this.claims);
      if (isCharacterAnimating(ch)) busy = true;
      if (ch.hop > 0) {
        ch.hop = Math.max(0, ch.hop - dt);
        busy = true;
      }

      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        busy = true;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    return busy;
  }

  nextWakeSeconds(): number {
    let soonest = Number.POSITIVE_INFINITY;
    for (const ch of this.characters.values()) {
      if (ch.pinned) continue;
      if (ch.state === CharacterState.IDLE && !ch.isActive) {
        soonest = Math.min(soonest, Math.max(0, ch.wanderTimer));
      } else if (ch.state === CharacterState.TYPE && !ch.isActive) {
        soonest = Math.min(soonest, Math.max(0, ch.seatTimer));
      }
    }
    return soonest;
  }
}
