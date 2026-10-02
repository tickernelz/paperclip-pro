import type { OfficeController, OverlayLayer } from "../../officeModel";
import { OfficeEffectState } from "./effectState";
import { createAmbienceLayer } from "./ambience";
import { createEffectsLayer } from "./effects";
import { createBubblesLayer } from "./bubbles";
import { createLabelsLayer } from "./labels";

const byOffice = new WeakMap<OfficeController, OverlayLayer[]>();

export function createOfficeOverlays(office: OfficeController): OverlayLayer[] {
  const existing = byOffice.get(office);
  if (existing) return existing;
  const effects = new OfficeEffectState(office);
  const layers = [
    createAmbienceLayer(),
    createEffectsLayer(effects),
    createBubblesLayer(effects),
    createLabelsLayer(),
  ];
  byOffice.set(office, layers);
  return layers;
}

export { tintForHour, type Tint } from "./ambience";
export { OfficeEffectState } from "./effectState";
