export const RETIRED_ADAPTER_TYPES = [
  "acpx_local",
  "claude_local",
  "codex_local",
  "cursor",
  "cursor_cloud",
  "gemini_local",
  "grok_local",
  "hermes_gateway",
  "hermes_local",
  "kimi_local",
  "openclaw_gateway",
  "opencode_local",
  "pi_local",
] as const;

const retiredAdapterTypes = new Set<string>(RETIRED_ADAPTER_TYPES);

export function isRetiredAdapterType(type: string | null | undefined): boolean {
  return typeof type === "string" && retiredAdapterTypes.has(type);
}

export function retiredAdapterMessage(type: string): string {
  return `The ${type} adapter has been removed, so this agent stays disabled until you switch it to OMP (omp_local).`;
}
