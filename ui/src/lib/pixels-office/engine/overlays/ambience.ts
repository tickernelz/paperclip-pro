import type { CharacterPose, OfficeController, OfficeView, OverlayLayer } from "../../officeModel";
import { CHARACTER_SITTING_OFFSET_PX } from "../../constants";

export interface Tint {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const TINT_TABLE = new Float32Array([
  18, 24, 64, 0.46,
  18, 24, 64, 0.48,
  18, 24, 64, 0.48,
  18, 24, 64, 0.46,
  24, 30, 70, 0.42,
  60, 45, 80, 0.34,
  255, 150, 90, 0.2,
  255, 180, 120, 0.1,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 255, 255, 0,
  255, 170, 100, 0.12,
  255, 130, 70, 0.22,
  200, 90, 70, 0.3,
  60, 50, 90, 0.38,
  30, 32, 72, 0.42,
  20, 26, 66, 0.45,
  18, 24, 64, 0.46,
]);

const scratchTint: Tint = { r: 255, g: 255, b: 255, alpha: 0 };

export function tintForHour(hour: number, out: Tint = scratchTint): Tint {
  const wrapped = ((hour % 24) + 24) % 24;
  const low = Math.floor(wrapped);
  const high = (low + 1) % 24;
  const t = wrapped - low;
  const a = low * 4;
  const b = high * 4;
  out.r = TINT_TABLE[a] + (TINT_TABLE[b] - TINT_TABLE[a]) * t;
  out.g = TINT_TABLE[a + 1] + (TINT_TABLE[b + 1] - TINT_TABLE[a + 1]) * t;
  out.b = TINT_TABLE[a + 2] + (TINT_TABLE[b + 2] - TINT_TABLE[a + 2]) * t;
  out.alpha = TINT_TABLE[a + 3] + (TINT_TABLE[b + 3] - TINT_TABLE[a + 3]) * t;
  return out;
}

const GLOW_RADIUS_TILES = 2.5;
const GLOW_CACHE_LIMIT = 2;
const GLOW_HEAD_OFFSET = 14;
const glowCache = new Map<number, HTMLCanvasElement | null>();

function glowSprite(zoom: number): HTMLCanvasElement | null {
  const cached = glowCache.get(zoom);
  if (cached !== undefined) return cached;
  let sprite: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined") {
    const size = Math.max(8, Math.round(GLOW_RADIUS_TILES * 2 * 16 * zoom));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, "rgba(255, 196, 108, 0.42)");
      gradient.addColorStop(0.45, "rgba(255, 170, 80, 0.18)");
      gradient.addColorStop(1, "rgba(255, 150, 60, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      sprite = canvas;
    }
  }
  glowCache.set(zoom, sprite);
  if (glowCache.size > GLOW_CACHE_LIMIT) {
    const oldest = glowCache.keys().next();
    if (!oldest.done) glowCache.delete(oldest.value);
  }
  return sprite;
}

const TINT_REFRESH_MS = 60_000;

export function createAmbienceLayer(): OverlayLayer {
  const tint: Tint = { r: 255, g: 255, b: 255, alpha: 0 };
  let tintStyle = "";
  let tintAlpha = 0;
  let tintComputedAt = -TINT_REFRESH_MS;
  let view: OfficeView | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let office: OfficeController | null = null;
  let glow: HTMLCanvasElement | null = null;
  let glowSize = 0;
  let sinceTintCheck = 0;
  let wakePending = false;

  const drawGlow = (pose: CharacterPose): void => {
    const current = view;
    const target = ctx;
    const controller = office;
    if (!current || !target || !controller || !glow) return;
    const visual = controller.visual(pose.agentId);
    if (!visual || visual.status !== "running") return;
    const sitting = pose.seated ? CHARACTER_SITTING_OFFSET_PX : 0;
    const x = Math.round(current.offsetX + pose.x * current.zoom - glowSize / 2);
    const y = Math.round(
      current.offsetY + (pose.y + sitting - GLOW_HEAD_OFFSET) * current.zoom - glowSize / 2,
    );
    if (x + glowSize < 0 || y + glowSize < 0 || x > current.width || y > current.height) return;
    target.drawImage(glow, x, y);
  };

  return {
    update(dt, controller) {
      if (!wakePending) {
        wakePending = true;
        setTimeout(() => {
          wakePending = false;
          if (typeof document !== "undefined" && document.hidden) return;
          controller.wake();
        }, TINT_REFRESH_MS);
      }
      sinceTintCheck += dt * 1000;
      if (sinceTintCheck < TINT_REFRESH_MS) return false;
      sinceTintCheck = 0;
      return true;
    },
    draw(target, current, controller) {
      if (current.nowMs - tintComputedAt >= TINT_REFRESH_MS) {
        tintComputedAt = current.nowMs;
        const date = new Date(current.nowMs);
        tintForHour(date.getHours() + date.getMinutes() / 60, tint);
        tintAlpha = tint.alpha;
        const r = Math.round(255 + (tint.r - 255) * tint.alpha);
        const g = Math.round(255 + (tint.g - 255) * tint.alpha);
        const b = Math.round(255 + (tint.b - 255) * tint.alpha);
        tintStyle = `rgb(${r}, ${g}, ${b})`;
      }

      if (tintAlpha > 0.01) {
        target.save();
        target.globalCompositeOperation = "multiply";
        target.fillStyle = tintStyle;
        target.fillRect(0, 0, current.width, current.height);
        target.restore();

        const zoom = Math.max(1, Math.round(current.zoom));
        glow = glowSprite(zoom);
        if (glow) {
          glowSize = glow.width;
          view = current;
          ctx = target;
          office = controller;
          target.save();
          target.globalCompositeOperation = "lighter";
          controller.forEachPose(drawGlow);
          target.restore();
          view = null;
          ctx = null;
        }
      }
    },
  };
}
