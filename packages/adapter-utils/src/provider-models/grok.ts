export const DEFAULT_GROK_LOCAL_MODEL = "grok-build";

export const models = [
  { id: DEFAULT_GROK_LOCAL_MODEL, label: DEFAULT_GROK_LOCAL_MODEL },
  { id: "grok-4.7", label: "Grok 4.7" },
  { id: "grok-4.6", label: "Grok 4.6" },
  { id: "grok-4.5", label: "Grok 4.5" },
];

export function grokLocalReasoningEffortsForModel(model: string): readonly string[] {
  return model.trim() === "grok-4.7" || model.trim() === "grok-4.6"
    ? ["low", "medium", "high", "xhigh"]
    : ["low", "medium", "high"];
}
