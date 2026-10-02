import type { OverlayLayer } from "../../officeModel";
import { TILE_SIZE } from "../../constants";
import {
  CHEER_DURATION_SEC,
  CONFETTI_COLORS,
  type OfficeEffectState,
} from "./effectState";
import { confettiPop, requestEffectSprites, smokeFrame } from "./effectSprites";

const PARTICLE_WORLD_SIZE = 1.5;
const SMOKE_SPRITE_SIZE = 16;
const SMOKE_HEAD_OFFSET = 30;
const POP_SIZE = 32;
const POP_VISIBLE_SEC = 0.4;
const ALARM_BLINK_SEC = 0.45;
const ALARM_COLOR = "rgba(248, 113, 113, 0.55)";
const VISIT_LINE_COLOR = "rgba(129, 212, 250, 0.85)";
const VISIT_DASH = [3, 3];
const VISIT_HEAD_OFFSET = 18;

export function createEffectsLayer(effects: OfficeEffectState): OverlayLayer {
  requestEffectSprites();

  return {
    update(dt) {
      return effects.update(dt);
    },
    draw(ctx, view, office) {
      const zoom = view.zoom;

      const confetti = effects.confetti;
      if (confetti.count > 0) {
        const size = Math.max(1, Math.round(PARTICLE_WORLD_SIZE * zoom));
        for (let i = 0; i < confetti.count; i += 1) {
          ctx.fillStyle = CONFETTI_COLORS[confetti.tint[i]];
          ctx.fillRect(
            Math.round(view.offsetX + confetti.x[i] * zoom),
            Math.round(view.offsetY + confetti.y[i] * zoom),
            size,
            size,
          );
        }
      }

      for (let i = 0; i < effects.cheerCount; i += 1) {
        const cheer = effects.cheers[i];
        if (cheer.ttl < CHEER_DURATION_SEC - POP_VISIBLE_SEC) continue;
        const pop = confettiPop();
        if (!pop) break;
        const pose = office.pose(cheer.agentId);
        if (!pose) continue;
        const size = POP_SIZE * zoom;
        ctx.drawImage(
          pop,
          Math.round(view.offsetX + pose.x * zoom - size / 2),
          Math.round(view.offsetY + (pose.y - SMOKE_HEAD_OFFSET) * zoom - size / 2),
          size,
          size,
        );
      }

      for (let i = 0; i < effects.smokeCount; i += 1) {
        const smoke = effects.smokes[i];
        const pose = office.pose(smoke.agentId);
        if (!pose) continue;
        const sprite = smokeFrame(smoke.frame);
        const size = SMOKE_SPRITE_SIZE * zoom;
        const x = Math.round(view.offsetX + pose.x * zoom - size / 2);
        const y = Math.round(view.offsetY + (pose.y - SMOKE_HEAD_OFFSET) * zoom - size);
        if (sprite) {
          ctx.drawImage(sprite, x, y, size, size);
        } else {
          ctx.fillStyle = "rgba(226, 232, 240, 0.55)";
          ctx.fillRect(x + size / 4, y + size / 4, size / 2, size / 2);
        }
      }

      if (effects.smokeCount > 0) {
        const anchor = office.objectAnchor("alarm");
        if (anchor && Math.floor(effects.alarmPhase / ALARM_BLINK_SEC) % 2 === 0) {
          const size = TILE_SIZE * zoom;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = ALARM_COLOR;
          ctx.fillRect(
            Math.round(view.offsetX + anchor.x * zoom - size / 2),
            Math.round(view.offsetY + anchor.y * zoom - size / 2),
            size,
            size,
          );
          ctx.restore();
        }
      }

      if (effects.visitCount > 0) {
        ctx.save();
        ctx.setLineDash(VISIT_DASH);
        ctx.strokeStyle = VISIT_LINE_COLOR;
        ctx.lineWidth = Math.max(1, Math.round(zoom / 2));
        for (let i = 0; i < effects.visitCount; i += 1) {
          const link = effects.visits[i];
          const from = office.pose(link.fromAgentId);
          const to = office.pose(link.toAgentId);
          if (!from || !to) continue;
          ctx.beginPath();
          ctx.moveTo(
            view.offsetX + from.x * zoom,
            view.offsetY + (from.y - VISIT_HEAD_OFFSET) * zoom,
          );
          ctx.lineTo(view.offsetX + to.x * zoom, view.offsetY + (to.y - VISIT_HEAD_OFFSET) * zoom);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
  };
}
