import type { OfficeCameraState } from '../officeModel';
import { TILE_SIZE } from '../types';

const MAX_ZOOM_FACTOR = 6;
const TWEEN_RATE = 9;
const TWEEN_EPSILON = 0.4;

export interface CameraRoom {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export class Camera implements OfficeCameraState {
  centerX = 0;
  centerY = 0;
  zoom = 1;
  followAgentId: string | null = null;
  viewportWidth = 1;
  viewportHeight = 1;
  dpr = 1;
  offsetX = 0;
  offsetY = 0;

  private targetX = 0;
  private targetY = 0;
  private tweening = false;

  constructor(
    readonly worldWidth: number,
    readonly worldHeight: number,
  ) {
    this.centerX = worldWidth / 2;
    this.centerY = worldHeight / 2;
    this.targetX = this.centerX;
    this.targetY = this.centerY;
    this.recompute();
  }

  get minZoom(): number {
    return Math.max(1, Math.ceil(this.dpr));
  }

  get maxZoom(): number {
    return Math.max(this.minZoom, Math.round(MAX_ZOOM_FACTOR * this.dpr));
  }

  setViewport(width: number, height: number, dpr: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.dpr = dpr > 0 ? dpr : 1;
    this.setZoom(this.zoom);
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.round(zoom)));
    this.recompute();
  }

  fitRoom(room: CameraRoom): void {
    const fit = Math.min(
      this.viewportWidth / (room.cols * TILE_SIZE),
      this.viewportHeight / (room.rows * TILE_SIZE),
    );
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.floor(fit)));
    this.centerX = (room.col + room.cols / 2) * TILE_SIZE;
    this.centerY = (room.row + room.rows / 2) * TILE_SIZE;
    this.targetX = this.centerX;
    this.targetY = this.centerY;
    this.tweening = false;
    this.recompute();
  }

  panBy(dxScreenCss: number, dyScreenCss: number): void {
    this.followAgentId = null;
    this.tweening = false;
    this.centerX -= (dxScreenCss * this.dpr) / this.zoom;
    this.centerY -= (dyScreenCss * this.dpr) / this.zoom;
    this.targetX = this.centerX;
    this.targetY = this.centerY;
    this.recompute();
  }

  zoomAt(screenXCss: number, screenYCss: number, steps: number): void {
    if (steps === 0) return;
    const deviceX = screenXCss * this.dpr;
    const deviceY = screenYCss * this.dpr;
    const worldX = (deviceX - this.offsetX) / this.zoom;
    const worldY = (deviceY - this.offsetY) / this.zoom;
    const next = Math.min(
      this.maxZoom,
      Math.max(this.minZoom, this.zoom + Math.trunc(steps)),
    );
    if (next === this.zoom) return;
    this.zoom = next;
    this.centerX = worldX - (deviceX - this.viewportWidth / 2) / next;
    this.centerY = worldY - (deviceY - this.viewportHeight / 2) / next;
    this.targetX = this.centerX;
    this.targetY = this.centerY;
    this.tweening = false;
    this.recompute();
  }

  centerOn(worldX: number, worldY: number): void {
    this.targetX = worldX;
    this.targetY = worldY;
    this.tweening = true;
  }

  jumpTo(worldX: number, worldY: number): void {
    this.centerX = worldX;
    this.centerY = worldY;
    this.targetX = worldX;
    this.targetY = worldY;
    this.tweening = false;
    this.recompute();
  }

  follow(agentId: string | null): void {
    this.followAgentId = agentId;
    if (agentId === null) this.tweening = false;
  }

  update(dt: number, followX: number | null, followY: number | null): boolean {
    if (this.followAgentId !== null && followX !== null && followY !== null) {
      this.targetX = followX;
      this.targetY = followY;
      this.tweening = true;
    }
    if (!this.tweening) return false;

    const blend = 1 - Math.exp(-TWEEN_RATE * dt);
    this.centerX += (this.targetX - this.centerX) * blend;
    this.centerY += (this.targetY - this.centerY) * blend;
    const settled =
      Math.abs(this.targetX - this.centerX) < TWEEN_EPSILON &&
      Math.abs(this.targetY - this.centerY) < TWEEN_EPSILON;
    if (settled) {
      this.centerX = this.targetX;
      this.centerY = this.targetY;
      this.tweening = this.followAgentId !== null;
    }
    this.recompute();
    return !settled;
  }

  private recompute(): void {
    const halfW = this.viewportWidth / (2 * this.zoom);
    const halfH = this.viewportHeight / (2 * this.zoom);
    this.centerX =
      halfW * 2 >= this.worldWidth
        ? this.worldWidth / 2
        : Math.min(this.worldWidth - halfW, Math.max(halfW, this.centerX));
    this.centerY =
      halfH * 2 >= this.worldHeight
        ? this.worldHeight / 2
        : Math.min(this.worldHeight - halfH, Math.max(halfH, this.centerY));
    this.offsetX = Math.round(this.viewportWidth / 2 - this.centerX * this.zoom);
    this.offsetY = Math.round(this.viewportHeight / 2 - this.centerY * this.zoom);
  }
}
