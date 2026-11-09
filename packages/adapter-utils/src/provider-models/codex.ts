import { WARDMOTE_RUNNER_DEFAULT_MODELS } from "../wardmote-runner-permissions.js";

export const SANDBOX_INSTALL_COMMAND = "npm install -g @openai/codex";

// Use the concrete `gpt-5.6-sol` slug (Codex's own default for the 5.6 family) rather than the
// bare `gpt-5.6` alias: OpenAI ships no model metadata for the bare slug, so passing it makes the
// Codex CLI warn ("Model metadata for `gpt-5.6` not found") and fall back to generic context limits.
export const DEFAULT_CODEX_LOCAL_MODEL = WARDMOTE_RUNNER_DEFAULT_MODELS.codex;
export const DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX = true;
export const CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS = [
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
] as const;

function normalizeModelId(model: string | null | undefined): string {
  return typeof model === "string" ? model.trim() : "";
}

// Legacy model aliases with no OpenAI-published metadata are rewritten to the concrete slug the
// Codex CLI actually knows. Without this, agents still configured with the bare `gpt-5.6` alias
// (the old default) keep triggering "Model metadata for `gpt-5.6` not found" warnings and Codex
// falls back to generic context-window limits, even on a Codex build that ships the 5.6 family.
const CODEX_LOCAL_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "gpt-5.6": "gpt-5.6-sol",
};

const CODEX_LOCAL_DEFAULT_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

const CODEX_LOCAL_MAX_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const CODEX_LOCAL_ULTRA_REASONING_EFFORTS = [
  ...CODEX_LOCAL_MAX_REASONING_EFFORTS,
  "ultra",
] as const;

export type CodexLocalReasoningEffort =
  | (typeof CODEX_LOCAL_DEFAULT_REASONING_EFFORTS)[number]
  | (typeof CODEX_LOCAL_ULTRA_REASONING_EFFORTS)[number];

export function normalizeCodexModel(model: string | null | undefined): string {
  const normalizedModel = normalizeModelId(model);
  return CODEX_LOCAL_MODEL_ALIASES[normalizedModel] ?? normalizedModel;
}

export function codexLocalReasoningEffortsForModel(
  model: string | null | undefined,
): readonly CodexLocalReasoningEffort[] {
  const normalizedModel = normalizeCodexModel(model);
  switch (normalizedModel) {
    case "gpt-6-astra":
    case "gpt-6.1-sol":
    case "gpt-6-sol":
    case "gpt-5.6-sol":
    case "gpt-5.6-terra":
      return CODEX_LOCAL_ULTRA_REASONING_EFFORTS;
    case "gpt-6-luna":
    case "gpt-5.6-luna":
      return CODEX_LOCAL_MAX_REASONING_EFFORTS;
    default:
      return CODEX_LOCAL_DEFAULT_REASONING_EFFORTS;
  }
}

// The Codex backend accepts a model for ChatGPT sign-in only from a client that identifies as a
// recent enough CLI (the request carries the CLI version). An older `codex` fails every turn with
// "The '<model>' model is not supported when using Codex with a ChatGPT account.", which reads
// like an account problem when it is really a stale install, typically a sandbox image baked
// before the catalog gained the model. Record the oldest stable release verified to work so the
// Test and the remote runner can name the actual gap. Omit models with no verified floor; the
// install pin in the runner and images is always at or above every floor listed here.
const CODEX_LOCAL_MODEL_MINIMUM_CLI_VERSIONS: Readonly<Record<string, string>> = {
  // 0.156.1 and older are rejected (openai/codex#49396); 0.159.0 and 0.159.2 are accepted
  // (openai/codex#49464). No stable release between those was verified either way.
  "gpt-6.1-sol": "0.159.0",
  // Codex 0.157.0 release notes: "Add GPT-6 Sol and Luna to the model catalog".
  "gpt-6-sol": "0.157.0",
  "gpt-6-luna": "0.157.0",
};

export function minimumCodexCliVersionForModel(model: string | null | undefined): string | null {
  return CODEX_LOCAL_MODEL_MINIMUM_CLI_VERSIONS[normalizeCodexModel(model)] ?? null;
}

const STABLE_CODEX_CLI_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function stableCodexCliVersionParts(version: string): number[] | null {
  const match = STABLE_CODEX_CLI_VERSION.exec(version.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

/** Read the version from `codex --version` output; prerelease or ambiguous output yields null. */
export function parseCodexCliVersionOutput(output: string): string | null {
  const versions = output
    .split(/\r?\n/)
    .map((line) => /^codex-cli (\S+)$/.exec(line.trim())?.[1])
    .filter((version): version is string => version !== undefined);
  if (versions.length !== 1 || !stableCodexCliVersionParts(versions[0]!)) return null;
  return versions[0]!;
}

export function codexCliVersionAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = stableCodexCliVersionParts(version);
  const parsedMinimum = stableCodexCliVersionParts(minimum);
  if (!parsedVersion || !parsedMinimum) return false;
  for (let index = 0; index < parsedMinimum.length; index += 1) {
    if (parsedVersion[index] !== parsedMinimum[index]) {
      return parsedVersion[index]! > parsedMinimum[index]!;
    }
  }
  return true;
}

export const CODEX_CHATGPT_MODEL_REJECTION_RE =
  /The '([^']+)' model is not supported when using Codex with a ChatGPT account\./;

export function isCodexLocalKnownModel(model: string | null | undefined): boolean {
  const normalizedModel = normalizeModelId(model);
  if (!normalizedModel) return false;
  return models.some((entry) => entry.id === normalizedModel);
}

export function isCodexLocalManualModel(model: string | null | undefined): boolean {
  const normalizedModel = normalizeModelId(model);
  return Boolean(normalizedModel) && !isCodexLocalKnownModel(normalizedModel);
}

export function isCodexLocalFastModeSupported(model: string | null | undefined): boolean {
  if (isCodexLocalManualModel(model)) return true;
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  // Empty means we're omitting --model so the Codex CLI picks its own default.
  // Manual model IDs are also treated as supported: pass the fast-mode overrides
  // through and let the CLI reject them if the chosen model can't use them.
  if (!normalizedModel) return true;
  return CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS.includes(
    normalizedModel as (typeof CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS)[number],
  );
}

// Ordered the way the ChatGPT app orders Codex models (#14878): newest model version first,
// then by decreasing capability inside each version, older models at the end. The server
// returns this list as written and the model dropdown keeps its order.
export const models = [
  { id: "gpt-6.1-sol", label: "gpt-6.1-sol" },
  { id: "gpt-6-astra", label: "gpt-6-astra" },
  { id: "gpt-6-sol", label: "gpt-6-sol" },
  { id: "gpt-6-luna", label: "gpt-6-luna" },
  // DEFAULT_CODEX_LOCAL_MODEL is gpt-5.6-sol, the first 5.6 entry.
  { id: DEFAULT_CODEX_LOCAL_MODEL, label: DEFAULT_CODEX_LOCAL_MODEL },
  { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
  { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.4", label: "gpt-5.4" },
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { id: "gpt-5", label: "gpt-5" },
  { id: "gpt-5-mini", label: "gpt-5-mini" },
  { id: "gpt-5-nano", label: "gpt-5-nano" },
  { id: "o3", label: "o3" },
  { id: "o4-mini", label: "o4-mini" },
  { id: "o3-mini", label: "o3-mini" },
  { id: "codex-mini-latest", label: "Codex Mini" },
];
