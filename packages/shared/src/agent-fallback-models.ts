export const AGENT_FALLBACK_MODELS_KEY = "fallbackModels";
export const AGENT_FALLBACK_MODELS_MAX = 5;
export const AGENT_FALLBACK_MODELS_ADAPTER_TYPES: readonly string[] = ["omp_local"];

/** Whether an adapter type runs the per-agent fallback model chain. */
export function adapterSupportsFallbackModels(adapterType: string): boolean {
  return AGENT_FALLBACK_MODELS_ADAPTER_TYPES.includes(adapterType);
}

/** Reads a stored fallback list leniently: trimmed, non-empty strings only. */
export function readAgentFallbackModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) list.push(trimmed);
  }
  return list;
}

export type AgentFallbackModelsValidation =
  | { ok: true; value: string[] }
  | { ok: false; message: string };

/** Validates a fallback list for one agent: at most 5, distinct, never the primary. */
export function validateAgentFallbackModels(
  value: unknown,
  primary: string | null | undefined,
): AgentFallbackModelsValidation {
  if (value === null || value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: "Fallback models must be a list of model selectors." };
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      return { ok: false, message: "Every fallback model must be a non-empty model selector." };
    }
    const trimmed = entry.trim();
    if (list.includes(trimmed)) return { ok: false, message: `Fallback model "${trimmed}" is listed twice.` };
    if (primary && trimmed === primary.trim()) {
      return { ok: false, message: `Fallback model "${trimmed}" is the primary model.` };
    }
    list.push(trimmed);
  }
  if (list.length > AGENT_FALLBACK_MODELS_MAX) {
    return { ok: false, message: `Pick at most ${AGENT_FALLBACK_MODELS_MAX} fallback models.` };
  }
  return { ok: true, value: list };
}

/** Fits a shared candidate list to one agent, dropping duplicates and that agent's primary. */
export function fitAgentFallbackModels(
  candidates: readonly string[],
  primary: string | null | undefined,
): { list: string[]; dropped: string[] } {
  const list: string[] = [];
  const dropped: string[] = [];
  const primaryValue = primary?.trim() ?? "";
  for (const entry of candidates) {
    const trimmed = entry.trim();
    if (!trimmed || list.includes(trimmed)) continue;
    if (primaryValue && trimmed === primaryValue) {
      dropped.push(trimmed);
      continue;
    }
    list.push(trimmed);
  }
  return { list: list.slice(0, AGENT_FALLBACK_MODELS_MAX), dropped };
}
