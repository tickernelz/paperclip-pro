import type {
  AgentVisualStatus,
  CharacterPose,
  OfficeController,
  OverlayLayer,
} from "../../officeModel";
import {
  PIXEL_FONT_HEIGHT,
  declutterLabelBoxes,
  getGlyphAtlas,
  measureLabelWidth,
  type GlyphAtlas,
  type LabelBox,
} from "../agentLabels";

const LABEL_TEXT_COLOR = "#f3f4f6";
const LABEL_PILL_COLOR = "rgba(12, 14, 20, 0.72)";
const LABEL_DOT_SIZE = 3;
const LABEL_PAD_X = 2;
const LABEL_PAD_Y = 1;
const LABEL_DOT_GAP = 2;
const LABEL_FOOT_OFFSET = 3;
const LABEL_STACK_GAP = 1;
const LABEL_DETAIL_ZOOM = 2;

const STATUS_DOT_COLOR: Record<AgentVisualStatus, string> = {
  running: "#4ade80",
  queued: "#facc15",
  idle: "#9ca3af",
  paused: "#60a5fa",
  error: "#f87171",
  pending_approval: "#c084fc",
  awaiting_board: "#facc15",
  budget_paused: "#60a5fa",
};

const STATUS_CODE: Record<AgentVisualStatus, number> = {
  running: 1,
  queued: 2,
  idle: 3,
  paused: 4,
  error: 5,
  pending_approval: 6,
  awaiting_board: 7,
  budget_paused: 8,
};

interface LabelEntry extends LabelBox {
  text: string;
  dot: string;
  anchorX: number;
  anchorY: number;
}

export function createLabelsLayer(): OverlayLayer {
  const pool: LabelEntry[] = [];
  const visible: LabelEntry[] = [];
  let office: OfficeController | null = null;
  let dirty = true;
  let builtForZoom = 0;
  let atlas: GlyphAtlas | null = null;
  let atlasZoom = 0;
  let detail = true;
  let poolCount = 0;
  let signature = 0;
  let builtSignature = -1;
  let builtSelected: string | null = null;
  let builtHovered: string | null = null;

  const scan = (pose: CharacterPose): void => {
    const controller = office;
    if (!controller) return;
    const visual = controller.visual(pose.agentId);
    signature = (signature * 31 + (pose.x | 0)) | 0;
    signature = (signature * 31 + (pose.y | 0)) | 0;
    if (!visual) return;
    signature = (signature * 31 + STATUS_CODE[visual.status]) | 0;
    const name = visual.shortName;
    for (let i = 0; i < name.length; i += 1) {
      signature = (signature * 31 + name.charCodeAt(i)) | 0;
    }
  };

  const collect = (pose: CharacterPose): void => {
    const controller = office;
    if (!controller) return;
    const visual = controller.visual(pose.agentId);
    if (!visual) return;
    const hovered = controller.hoveredAgentId;
    if (
      !detail &&
      !visual.working &&
      pose.agentId !== controller.selectedAgentId &&
      pose.agentId !== hovered
    ) {
      return;
    }
    let entry = pool[poolCount];
    if (!entry) {
      entry = {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        text: "",
        dot: "",
        anchorX: 0,
        anchorY: 0,
      };
      pool[poolCount] = entry;
    }
    poolCount += 1;
    entry.text = visual.shortName;
    entry.dot = STATUS_DOT_COLOR[visual.status];
    entry.w =
      LABEL_PAD_X * 2 + LABEL_DOT_SIZE + LABEL_DOT_GAP + measureLabelWidth(visual.shortName);
    entry.h = PIXEL_FONT_HEIGHT + LABEL_PAD_Y * 2;
    entry.anchorX = Math.round(pose.x - entry.w / 2);
    entry.anchorY = Math.round(pose.y + LABEL_FOOT_OFFSET);
    entry.x = entry.anchorX;
    entry.y = entry.anchorY;
  };

  return {
    update(_dt, controller) {
      office = controller;
      signature = 0;
      controller.forEachPose(scan);
      const hovered = controller.hoveredAgentId;
      if (
        signature !== builtSignature ||
        controller.selectedAgentId !== builtSelected ||
        hovered !== builtHovered
      ) {
        dirty = true;
      }
      return dirty;
    },
    draw(ctx, view, controller) {
      office = controller;
      const zoom = Math.max(1, Math.round(view.zoom));
      const nextDetail = zoom >= LABEL_DETAIL_ZOOM;
      if (dirty || zoom !== builtForZoom || nextDetail !== detail) {
        detail = nextDetail;
        poolCount = 0;
        controller.forEachPose(collect);
        visible.length = poolCount;
        for (let i = 0; i < poolCount; i += 1) visible[i] = pool[i];
        declutterLabelBoxes(visible, LABEL_STACK_GAP);
        builtForZoom = zoom;
        builtSignature = signature;
        builtSelected = controller.selectedAgentId;
        builtHovered = controller.hoveredAgentId;
        dirty = false;
      }
      if (visible.length === 0) return;
      if (!atlas || atlasZoom !== zoom) {
        atlas = getGlyphAtlas(zoom, LABEL_TEXT_COLOR);
        atlasZoom = zoom;
      }
      const dot = LABEL_DOT_SIZE * zoom;
      for (let i = 0; i < visible.length; i += 1) {
        const entry = visible[i];
        const sx = Math.round(view.offsetX + entry.x * view.zoom);
        const sy = Math.round(view.offsetY + entry.y * view.zoom);
        const w = entry.w * zoom;
        const h = entry.h * zoom;
        if (sx + w < 0 || sy + h < 0 || sx > view.width || sy > view.height) continue;
        ctx.fillStyle = LABEL_PILL_COLOR;
        ctx.fillRect(sx, sy, w, h);
        ctx.fillStyle = entry.dot;
        ctx.fillRect(sx + LABEL_PAD_X * zoom, sy + LABEL_PAD_Y * zoom + zoom, dot, dot);
        if (atlas) {
          atlas.drawText(
            ctx,
            entry.text,
            sx + (LABEL_PAD_X + LABEL_DOT_SIZE + LABEL_DOT_GAP) * zoom,
            sy + LABEL_PAD_Y * zoom,
          );
        }
      }
    },
  };
}
