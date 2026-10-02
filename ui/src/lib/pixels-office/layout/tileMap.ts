import type { TileType as TileTypeVal } from '../types';
import { TileType } from '../types';

export interface TileRef {
  col: number;
  row: number;
}

const PATH_CACHE_LIMIT = 4096;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly walkableTiles: TileRef[] = [];
  private readonly open: Uint8Array;
  private readonly visitedStamp: Int32Array;
  private readonly parent: Int32Array;
  private readonly queue: Int32Array;
  private readonly cache = new Map<number, Int32Array>();
  private stamp = 0;

  constructor(tileMap: TileTypeVal[][], blockedTiles: Set<string>) {
    this.rows = tileMap.length;
    this.cols = this.rows > 0 ? tileMap[0].length : 0;
    const size = this.cols * this.rows;
    this.open = new Uint8Array(size);
    this.visitedStamp = new Int32Array(size);
    this.parent = new Int32Array(size);
    this.queue = new Int32Array(size);

    for (let row = 0; row < this.rows; row++) {
      const line = tileMap[row];
      for (let col = 0; col < this.cols; col++) {
        const tile = line[col];
        if (tile === TileType.WALL || tile === TileType.VOID) continue;
        if (blockedTiles.has(`${col},${row}`)) continue;
        this.open[row * this.cols + col] = 1;
        this.walkableTiles.push({ col, row });
      }
    }
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  isWalkable(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    return this.open[row * this.cols + col] === 1;
  }

  setWalkable(col: number, row: number, walkable: boolean): void {
    if (!this.inBounds(col, row)) return;
    const idx = row * this.cols + col;
    const next = walkable ? 1 : 0;
    if (this.open[idx] === next) return;
    this.open[idx] = next;
    this.cache.clear();
  }

  findPath(
    startCol: number,
    startRow: number,
    endCol: number,
    endRow: number,
    allowBlockedGoal = false,
  ): TileRef[] {
    if (!this.inBounds(startCol, startRow) || !this.inBounds(endCol, endRow)) return [];
    const start = startRow * this.cols + startCol;
    const goal = endRow * this.cols + endCol;
    if (start === goal) return [];
    if (this.open[goal] !== 1 && !allowBlockedGoal) return [];

    const cacheKey = (start * this.open.length + goal) * 2 + (allowBlockedGoal ? 1 : 0);
    const cached = this.cache.get(cacheKey);
    if (cached) return this.materialise(cached);

    const found = this.search(start, goal);
    if (!found) return [];

    let length = 0;
    for (let node = goal; node !== start; node = this.parent[node]) length++;
    const steps = new Int32Array(length);
    let cursor = length - 1;
    for (let node = goal; node !== start; node = this.parent[node]) {
      steps[cursor] = node;
      cursor--;
    }

    if (this.cache.size >= PATH_CACHE_LIMIT) this.cache.clear();
    this.cache.set(cacheKey, steps);
    return this.materialise(steps);
  }

  private search(start: number, goal: number): boolean {
    this.stamp++;
    const { open, visitedStamp, parent, queue, cols } = this;
    const size = open.length;
    visitedStamp[start] = this.stamp;
    queue[0] = start;
    let head = 0;
    let tail = 1;

    while (head < tail) {
      const current = queue[head];
      head++;
      if (current === goal) return true;
      const col = current % cols;

      for (let d = 0; d < 4; d++) {
        let next: number;
        if (d === 0) {
          next = current - cols;
          if (next < 0) continue;
        } else if (d === 1) {
          next = current + cols;
          if (next >= size) continue;
        } else if (d === 2) {
          if (col === 0) continue;
          next = current - 1;
        } else {
          if (col === cols - 1) continue;
          next = current + 1;
        }
        if (visitedStamp[next] === this.stamp) continue;
        if (open[next] !== 1 && next !== goal) continue;
        visitedStamp[next] = this.stamp;
        parent[next] = current;
        if (next === goal) return true;
        queue[tail] = next;
        tail++;
      }
    }
    return false;
  }

  private materialise(steps: Int32Array): TileRef[] {
    const path: TileRef[] = new Array(steps.length);
    for (let i = 0; i < steps.length; i++) {
      path[i] = { col: steps[i] % this.cols, row: (steps[i] / this.cols) | 0 };
    }
    return path;
  }
}
