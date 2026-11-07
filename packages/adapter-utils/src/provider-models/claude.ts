export const DEFAULT_CLAUDE_LOCAL_MODEL = "claude-opus-5";

/** Resolve Paperclip's default without replacing an explicit provider model. */
export function resolveClaudeModel(
  model: unknown,
  env: Record<string, unknown> = {},
): string {
  const configured = typeof model === "string" ? model.trim() : "";
  if (configured) return configured;
  const environmentModel = typeof env.ANTHROPIC_MODEL === "string" ? env.ANTHROPIC_MODEL.trim() : "";
  if (environmentModel) return environmentModel;
  // These providers use their own model IDs and region-specific defaults.
  const providerFlag = (value: unknown) => value === "1" || value === "true";
  if (
    providerFlag(env.CLAUDE_CODE_USE_BEDROCK)
    || providerFlag(env.CLAUDE_CODE_USE_VERTEX)
    || (typeof env.ANTHROPIC_BEDROCK_BASE_URL === "string" && env.ANTHROPIC_BEDROCK_BASE_URL.trim())
  ) {
    return "";
  }
  return DEFAULT_CLAUDE_LOCAL_MODEL;
}

export function claudeLocalReasoningEffortsForModel(model: string): readonly string[] {
  const id = model.trim().replace(/\[1m\]$/, "").replace(/^(?:(?:us|eu|apac|global)\.)?anthropic\./, "");
  if (/^claude-haiku-/.test(id)) return [];
  if (/^claude-(?:opus-5(?:-5)?|opus-4-[78]|sonnet-5(?:-5)?|fable-5(?:-1)?)$/.test(id)) {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  if (/^claude-(?:opus|sonnet)-4-6(?:-v1)?$/.test(id)) return ["low", "medium", "high", "max"];
  return ["low", "medium", "high"];
}

export const SANDBOX_INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code";

// Ordered the way the Claude app orders models (#14877): the newest release of each family
// first, by decreasing capability, then older releases grouped by family. The server applies the
// same order to discovered models (server/model-order.ts); the picker keeps it.
export const models = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-mythos-5", label: "Claude Mythos 5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-fable-5", label: "Claude Fable 5" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
];
