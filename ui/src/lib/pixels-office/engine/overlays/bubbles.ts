import type {
  ActivityIcon,
  CharacterPose,
  OfficeController,
  OfficeView,
  OverlayLayer,
} from "../../officeModel";
import { CHARACTER_SITTING_OFFSET_PX } from "../../constants";
import { getIconAtlas, ICON_SIZE, type IconAtlas, type IconKey } from "./iconAtlas";
import type { OfficeEffectState } from "./effectState";

const BUBBLE_PAD = 1;
const BUBBLE_HEAD_OFFSET = 34;
const BUBBLE_GAP = 2;
const BUBBLE_BG = "rgba(12, 14, 20, 0.8)";
const BUBBLE_BORDER = "rgba(148, 163, 184, 0.45)";
const ACTIVITY_MAX_AGE_MS = 10_000;
const THINK_FRAME_MS = 320;

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

    if (visual.status === "error" || effects.stickyErrors.has(pose.agentId)) {
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
