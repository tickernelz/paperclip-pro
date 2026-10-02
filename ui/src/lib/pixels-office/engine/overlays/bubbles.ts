import type {
  ActivityIcon,
  AgentActivity,
  CharacterPose,
  OfficeController,
  OfficeView,
  OverlayLayer,
} from "../../officeModel";
import { CHARACTER_SITTING_OFFSET_PX } from "../../constants";
import {
  PIXEL_FONT_HEIGHT,
  getGlyphAtlas,
  measureLabelWidth,
  type GlyphAtlas,
} from "../agentLabels";
import { getIconAtlas, ICON_SIZE, type IconAtlas, type IconKey } from "./iconAtlas";
import type { OfficeEffectState } from "./effectState";

const BUBBLE_PAD = 1;
const BUBBLE_HEAD_OFFSET = 34;
const BUBBLE_GAP = 2;
const BUBBLE_BG = "rgba(12, 14, 20, 0.8)";
const BUBBLE_BORDER = "rgba(148, 163, 184, 0.45)";
const ACTIVITY_MAX_AGE_MS = 10_000;
const THINK_FRAME_MS = 320;
const PROGRESS_TEXT_COLOR = "#cbd5e1";
const PROGRESS_TEXT_MAX_CHARS = 22;
const PROGRESS_TEXT_PAD_X = 2;
const PROGRESS_TEXT_DETAIL_ZOOM = 2;

interface ProgressCaption {
  message: string;
  text: string;
  width: number;
}

export function progressCaption(message: string): string {
  let text = "";
  for (const char of message) {
    const drawable = char !== " " && char.charCodeAt(0) < 128 && measureLabelWidth(char) > 0;
    if (drawable) text += char;
    else if (text.length > 0 && !text.endsWith(" ")) text += " ";
  }
  text = text.trim();
  if (text.length <= PROGRESS_TEXT_MAX_CHARS) return text;
  return `${text.slice(0, PROGRESS_TEXT_MAX_CHARS - 2).trimEnd()}..`;
}

const ACTIVITY_ICON_KEY: Record<Exclude<ActivityIcon, "think">, IconKey> = {
  read: "read",
  write: "write",
  run: "run",
  web: "web",
  comment: "comment",
  other: "other",
};

export function createBubblesLayer(effects: OfficeEffectState): OverlayLayer {
  let atlas: IconAtlas | null = null;
  let atlasZoom = 0;
  let view: OfficeView | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let office: OfficeController | null = null;
  let animating = false;
  let glyphs: GlyphAtlas | null = null;
  let glyphZoom = 0;
  const captions = new Map<string, ProgressCaption>();

  const captionFor = (agentId: string, message: string): ProgressCaption => {
    const cached = captions.get(agentId);
    if (cached && cached.message === message) return cached;
    const text = progressCaption(message);
    const next = { message, text, width: measureLabelWidth(text) };
    captions.set(agentId, next);
    return next;
  };

  const drawCaption = (x: number, y: number, size: number, caption: ProgressCaption): number => {
    if (!ctx || !atlas || !glyphs || caption.width === 0) return x;
    const zoom = atlas.zoom;
    const pad = BUBBLE_PAD * zoom;
    const width = caption.width * zoom + PROGRESS_TEXT_PAD_X * 2 * zoom;
    const height = size + pad * 2;
    ctx.fillStyle = BUBBLE_BG;
    ctx.fillRect(x - pad, y - pad, width, height);
    ctx.strokeStyle = BUBBLE_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - pad + 0.5, y - pad + 0.5, width - 1, height - 1);
    const textY = y - pad + Math.round((height - PIXEL_FONT_HEIGHT * zoom) / 2);
    glyphs.drawText(ctx, caption.text, x - pad + PROGRESS_TEXT_PAD_X * zoom, textY);
    return x - pad + width;
  };

  const drawBubble = (x: number, y: number, size: number, key: IconKey): void => {
    if (!ctx || !atlas) return;
    const pad = BUBBLE_PAD * atlas.zoom;
    ctx.fillStyle = BUBBLE_BG;
    ctx.fillRect(x - pad, y - pad, size + pad * 2, size + pad * 2);
    ctx.strokeStyle = BUBBLE_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - pad + 0.5, y - pad + 0.5, size + pad * 2 - 1, size + pad * 2 - 1);
    atlas.draw(ctx, key, x, y);
  };

  const drawForPose = (pose: CharacterPose): void => {
    const current = view;
    const controller = office;
    if (!current || !controller || !atlas || !ctx) return;
    const visual = controller.visual(pose.agentId);
    if (!visual) return;

    const sitting = pose.seated ? CHARACTER_SITTING_OFFSET_PX : 0;
    const size = ICON_SIZE * atlas.zoom;
    const worldY = pose.y + sitting - BUBBLE_HEAD_OFFSET;
    const baseX = Math.round(current.offsetX + pose.x * current.zoom - size / 2);
    const baseY = Math.round(current.offsetY + worldY * current.zoom - size);
    if (
      baseX + size < 0 ||
      baseY + size < 0 ||
      baseX > current.width ||
      baseY > current.height
    ) {
      return;
    }

    if (effects.mentionTtl(pose.agentId) > 0) {
      drawBubble(baseX, baseY, size, "mention");
      animating = true;
      return;
    }

    const errored = visual.status === "error" || effects.stickyErrors.has(pose.agentId);
    if (visual.working) {
      drawWorking(pose, visual.activity, baseX, baseY, size, errored, visual.attention);
      return;
    }

    if (errored) {
      drawBubble(baseX, baseY, size, "bangRed");
      return;
    }

    if (visual.status === "awaiting_board" || visual.status === "pending_approval") {
      drawBubble(baseX, baseY, size, "bangYellow");
      return;
    }

    if (visual.status === "budget_paused") {
      drawBubble(baseX, baseY, size, "sleep");
      drawBubble(baseX + size + BUBBLE_GAP * atlas.zoom, baseY, size, "coin");
      return;
    }

    if (visual.status === "paused") {
      drawBubble(baseX, baseY, size, "sleep");
      return;
    }

    const activity = visual.activity;
    if (!activity) return;
    if (current.nowMs - activity.updatedAtMs > ACTIVITY_MAX_AGE_MS) return;
    if (activity.icon === "think") {
      const frame = Math.floor(current.nowMs / THINK_FRAME_MS) % 3;
      drawBubble(baseX, baseY, size, frame === 0 ? "think0" : frame === 1 ? "think1" : "think2");
      animating = true;
      return;
    }
    drawBubble(baseX, baseY, size, ACTIVITY_ICON_KEY[activity.icon]);
  };

  const drawWorking = (
    pose: CharacterPose,
    activity: AgentActivity | null,
    baseX: number,
    baseY: number,
    size: number,
    errored: boolean,
    attention: boolean,
  ): void => {
    const current = view;
    const controller = office;
    if (!current || !controller || !atlas) return;
    const fresh = activity !== null && current.nowMs - activity.updatedAtMs <= ACTIVITY_MAX_AGE_MS;
    let icon: IconKey;
    if (!activity || activity.icon === "think") {
      if (fresh) {
        const frame = Math.floor(current.nowMs / THINK_FRAME_MS) % 3;
        icon = frame === 0 ? "think0" : frame === 1 ? "think1" : "think2";
        animating = true;
      } else {
        icon = "think1";
      }
    } else {
      icon = ACTIVITY_ICON_KEY[activity.icon];
    }
    drawBubble(baseX, baseY, size, icon);

    const gap = (BUBBLE_GAP + BUBBLE_PAD * 2) * atlas.zoom;
    let nextX = baseX + size + gap;
    const showText =
      fresh &&
      activity?.message &&
      (atlas.zoom >= PROGRESS_TEXT_DETAIL_ZOOM ||
        pose.agentId === controller.selectedAgentId ||
        pose.agentId === controller.hoveredAgentId);
    if (showText && activity?.message) {
      nextX = drawCaption(nextX, baseY, size, captionFor(pose.agentId, activity.message)) + gap - BUBBLE_PAD * atlas.zoom;
    }
    if (errored) drawBubble(nextX, baseY, size, "bangRed");
    else if (attention) drawBubble(nextX, baseY, size, "bangYellow");
  };

  return {
    update(_dt, controller) {
      let active = effects.mentionCount > 0;
      if (!active) {
        const selected = controller.selectedAgentId;
        active = selected !== null && effects.stickyErrors.has(selected);
      }
      return active || animating;
    },
    draw(target, current, controller) {
      const zoom = Math.max(1, Math.round(current.zoom));
      if (!atlas || atlasZoom !== zoom) {
        atlas = getIconAtlas(zoom);
        atlasZoom = zoom;
      }
      if (!atlas) return;
      if (!glyphs || glyphZoom !== zoom) {
        glyphs = getGlyphAtlas(zoom, PROGRESS_TEXT_COLOR);
        glyphZoom = zoom;
      }
      ctx = target;
      view = current;
      office = controller;
      animating = false;
      controller.forEachPose(drawForPose);
      ctx = null;
      view = null;
    },
  };
}
