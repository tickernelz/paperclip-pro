export function extractProviderId(modelId: string): string | null {
  const trimmed = modelId.trim();
  if (!trimmed.includes("/")) return null;
  const provider = trimmed.slice(0, trimmed.indexOf("/")).trim();
  return provider || null;
}

export function extractProviderIdWithFallback(modelId: string, fallback = "other"): string {
  return extractProviderId(modelId) ?? fallback;
}

export function extractModelName(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed.includes("/")) return trimmed;
  return trimmed.slice(trimmed.indexOf("/") + 1).trim();
}

const CURATED_MODEL_ORDER_ADAPTERS: ReadonlySet<string> = new Set(["wardmote_runner"]);

export function adapterCuratesModelOrder(adapterType: string): boolean {
  return CURATED_MODEL_ORDER_ADAPTERS.has(adapterType);
}
