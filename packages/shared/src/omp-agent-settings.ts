import { AGENT_FALLBACK_MODELS_MAX } from "./agent-fallback-models.js";

export const OMP_SETTINGS_KEY = "ompSettings";
export const OMP_SETTINGS_PATH_PREFIX = `${OMP_SETTINGS_KEY}.`;
export const OMP_STYLE_KEY = "stylePreset";
export const OMP_FALLBACK_MODE_KEY = "fallbackMode";
export const OMP_RUN_GRACE_SEC = 60;

export const OMP_SESSION_NEUTRAL_ADAPTER_CONFIG_KEYS = [OMP_STYLE_KEY, OMP_FALLBACK_MODE_KEY] as const;

export const OMP_SESSION_KEEPING_ADAPTER_CONFIG_KEYS: readonly string[] = [
  "model",
  "fallbackModels",
  "modelEfforts",
  "thinking",
  "thinkingEffort",
  "effort",
  "smolModel",
  "slowModel",
  "planModel",
  `${OMP_SETTINGS_PATH_PREFIX}defaultThinkingLevel`,
  ...OMP_SESSION_NEUTRAL_ADAPTER_CONFIG_KEYS,
];

export type AgentSettingValue = unknown;
export type AgentSettingsPatch = Record<string, AgentSettingValue | undefined>;
export type AgentSettingsValues = Record<string, AgentSettingValue>;

export interface OmpChoiceModel {
  id: string;
  label?: string;
  provider?: string;
  thinking?: string[];
  cost?: { input?: number; output?: number };
}

export const OMP_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const OMP_STYLE_PRESETS = {
  balanced: { label: "Balanced", description: "Good answers at normal cost", thinking: "high", advisor: true, prewalk: false, maxRetries: 3 },
  fast: { label: "Fast", description: "Quick replies, lower cost", thinking: "low", advisor: false, prewalk: true, maxRetries: 3 },
  thorough: { label: "Thorough", description: "Plans first, checks its work", thinking: "xhigh", advisor: true, prewalk: false, maxRetries: 5 },
} as const;
export type OmpStylePreset = keyof typeof OMP_STYLE_PRESETS;

export const OMP_THINKING_CHOICES = {
  quick: { label: "Quick", level: "low" },
  balanced: { label: "Balanced", level: "medium" },
  deep: { label: "Deep", level: "high" },
  max: { label: "Max", level: "xhigh" },
} as const;
export type OmpThinkingChoice = keyof typeof OMP_THINKING_CHOICES;

export const OMP_TOOLS_CHOICES = {
  standard: { label: "Standard", description: "OMP's default tool set" },
  readOnly: { label: "Read only", description: "No shell and no edits" },
  everything: { label: "Everything", description: "Standard plus the browser" },
} as const;
export type OmpToolsChoice = keyof typeof OMP_TOOLS_CHOICES;

export const OMP_LIMIT_CHOICES = {
  m30: { label: "30 min", seconds: 1800 },
  h1: { label: "1 hour", seconds: 3600 },
  h2: { label: "2 hours", seconds: 7200 },
  none: { label: "No limit", seconds: 0 },
} as const;
export type OmpLimitChoice = keyof typeof OMP_LIMIT_CHOICES;

export type OmpBackupChoice = "automatic" | "custom";

export const OMP_READ_ONLY_DENIED_TOOLS = ["edit", "write", "ast_edit", "eval"] as const;

const TOOL_SWITCH_PATHS = ["bash.enabled", "browser.enabled", "web_search.enabled", "github.enabled", "ask.enabled"].map(
  (key) => OMP_SETTINGS_PATH_PREFIX + key,
);
const TOOL_APPROVAL_PATH = `${OMP_SETTINGS_PATH_PREFIX}tools.approval`;

export type OmpControlId = "style" | "model" | "thinking" | "backup" | "tools" | "limit";

export const OMP_CONTROL_PATHS: Record<OmpControlId, readonly string[]> = {
  style: [OMP_STYLE_KEY, "thinking", "advisor", "prewalk", `${OMP_SETTINGS_PATH_PREFIX}retry.maxRetries`],
  model: ["model", "smolModel", "slowModel", "planModel"],
  thinking: ["thinking", "modelEfforts", `${OMP_SETTINGS_PATH_PREFIX}defaultThinkingLevel`],
  backup: [OMP_FALLBACK_MODE_KEY, "fallbackModels", `${OMP_SETTINGS_PATH_PREFIX}retry.fallbackOn`],
  tools: ["tools", "approvalMode", "noLsp", ...TOOL_SWITCH_PATHS, TOOL_APPROVAL_PATH],
  limit: ["maxTime", "timeoutSec"],
};

export const OMP_CONTROL_IDS = Object.keys(OMP_CONTROL_PATHS) as OmpControlId[];

export const OMP_ADAPTER_ALIASES: Record<string, { path: string; invert?: boolean }> = {
  "advisor.enabled": { path: "advisor" },
  "prewalk.enabled": { path: "prewalk" },
  "lsp.enabled": { path: "noLsp", invert: true },
  "skills.enabled": { path: "noSkills", invert: true },
  omitThinking: { path: "printThoughts", invert: true },
  "compaction.experimentalContextManagement": { path: "experimentalContextManagement" },
  "tools.approvalMode": { path: "approvalMode" },
};

export const OMP_LOCKED_SETTINGS: Record<string, string> = {
  "task.maxRecursionDepth": "Paperclip keeps this at 0 so a run never starts OMP subagents it cannot track.",
};

export function isBlockedOmpSettingKey(key: string): boolean {
  return /^(auth|secrets)\./.test(key) || /(^|\.)(token|apiKey|api_key|secret|password|credentials?)$/i.test(key);
}

export function ompSettingPath(key: string): string {
  return OMP_ADAPTER_ALIASES[key]?.path ?? OMP_SETTINGS_PATH_PREFIX + key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type OmpSettingType = "boolean" | "number" | "string" | "array" | "record" | "enum";

export interface OmpSettingsCatalogEntry {
  key: string;
  section: string;
  type: OmpSettingType;
  options?: string[];
  description: string;
  value?: boolean | number | string;
}

function typeMatches(entry: OmpSettingsCatalogEntry, value: unknown): boolean {
  switch (entry.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "record":
      return isRecord(value);
    case "enum":
      return typeof value === "string" && (entry.options ?? []).includes(value);
  }
}

export function validateOmpSettingValue(entry: OmpSettingsCatalogEntry, value: unknown): string | null {
  if (typeMatches(entry, value)) return null;
  if (entry.type === "enum") return `${entry.key} must be one of: ${(entry.options ?? []).join(", ")}.`;
  return `${entry.key} must be a${entry.type === "array" ? "n array" : entry.type === "record" ? " map" : ` ${entry.type}`}.`;
}

export function validateOmpSettingsMap(value: unknown, catalog?: readonly OmpSettingsCatalogEntry[]): string[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return [`${OMP_SETTINGS_KEY} must be a map of OMP setting keys to values.`];
  const byKey = catalog ? new Map(catalog.map((entry) => [entry.key, entry])) : null;
  const errors: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(key)) errors.push(`"${key}" is not an OMP setting key.`);
    else if (isBlockedOmpSettingKey(key)) errors.push(`${key} holds credentials and stays in OMP's own store.`);
    else if (OMP_LOCKED_SETTINGS[key]) errors.push(`${key}: ${OMP_LOCKED_SETTINGS[key]}`);
    else if (OMP_ADAPTER_ALIASES[key]) errors.push(`Set ${key} through the agent's ${OMP_ADAPTER_ALIASES[key]!.path} setting.`);
    else if (byKey) {
      const entry = byKey.get(key);
      if (!entry) errors.push(`OMP has no setting named ${key}.`);
      else {
        const problem = validateOmpSettingValue(entry, item);
        if (problem) errors.push(problem);
      }
    }
  }
  return errors;
}

export function readAgentSetting(config: Record<string, unknown> | null | undefined, path: string): AgentSettingValue {
  if (!config) return undefined;
  if (path.startsWith(OMP_SETTINGS_PATH_PREFIX)) {
    const settings = config[OMP_SETTINGS_KEY];
    return isRecord(settings) ? settings[path.slice(OMP_SETTINGS_PATH_PREFIX.length)] : undefined;
  }
  return config[path];
}

export function readOmpSetting(config: Record<string, unknown> | null | undefined, key: string): AgentSettingValue {
  const alias = OMP_ADAPTER_ALIASES[key];
  const value = readAgentSetting(config, ompSettingPath(key));
  return alias?.invert && typeof value === "boolean" ? !value : value;
}

export function ompSettingStoredValue(key: string, value: AgentSettingValue): AgentSettingValue {
  return OMP_ADAPTER_ALIASES[key]?.invert && typeof value === "boolean" ? !value : value;
}

export function applyAgentSettingsPatch(
  config: Record<string, unknown> | null | undefined,
  patch: AgentSettingsPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };
  const settings: Record<string, unknown> = isRecord(next[OMP_SETTINGS_KEY]) ? { ...(next[OMP_SETTINGS_KEY] as Record<string, unknown>) } : {};
  let settingsTouched = false;
  for (const [path, value] of Object.entries(patch)) {
    if (path.startsWith(OMP_SETTINGS_PATH_PREFIX)) {
      settingsTouched = true;
      const key = path.slice(OMP_SETTINGS_PATH_PREFIX.length);
      if (value === undefined) delete settings[key];
      else settings[key] = value;
      continue;
    }
    if (value === undefined) delete next[path];
    else next[path] = value;
  }
  if (settingsTouched) {
    if (Object.keys(settings).length > 0) next[OMP_SETTINGS_KEY] = settings;
    else delete next[OMP_SETTINGS_KEY];
  }
  return next;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function sameAgentSettingValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function levelIndex(level: string): number {
  return (OMP_THINKING_LEVELS as readonly string[]).indexOf(level);
}

export function nearestThinkingLevel(wanted: string, supported: readonly string[] | undefined): string {
  const target = levelIndex(wanted);
  const levels = (supported ?? []).filter((level) => levelIndex(level) >= 0);
  if (target < 0 || levels.length === 0) return wanted;
  let best = levels[0]!;
  for (const level of levels) {
    const distance = Math.abs(levelIndex(level) - target);
    const bestDistance = Math.abs(levelIndex(best) - target);
    if (distance < bestDistance || (distance === bestDistance && levelIndex(level) > levelIndex(best))) best = level;
  }
  return best;
}

function providerOf(model: OmpChoiceModel): string {
  if (model.provider) return model.provider;
  const slash = model.id.indexOf("/");
  return slash > 0 ? model.id.slice(0, slash) : "";
}

function bareId(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

function price(model: OmpChoiceModel): number | null {
  const output = model.cost?.output;
  const input = model.cost?.input;
  if (typeof output === "number" && output > 0) return output;
  if (typeof input === "number" && input > 0) return input * 4;
  return null;
}

export function deriveOmpModelRoles(modelId: string, models: readonly OmpChoiceModel[]): { smolModel: string; slowModel: string; planModel: string } {
  const picked = models.find((model) => model.id === modelId);
  const provider = picked ? providerOf(picked) : modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "";
  const family = models.filter((model) => providerOf(model) === provider && price(model) !== null);
  if (family.length === 0) return { smolModel: modelId, slowModel: modelId, planModel: modelId };
  const sorted = [...family].sort((a, b) => price(a)! - price(b)! || a.id.localeCompare(b.id));
  const smol = sorted[0]!.id;
  const slow = sorted[sorted.length - 1]!.id;
  return { smolModel: smol, slowModel: slow, planModel: slow };
}

export function deriveOmpBackupModels(modelId: string, models: readonly OmpChoiceModel[], limit = 2): string[] {
  const picked = models.find((model) => model.id === modelId);
  if (!picked) return [];
  const provider = providerOf(picked);
  const target = price(picked);
  const others = models.filter((model) => providerOf(model) !== provider && model.id !== modelId);
  const score = (model: OmpChoiceModel): number => {
    if (bareId(model.id) === bareId(modelId)) return -1;
    const own = price(model);
    if (target === null || own === null) return Number.POSITIVE_INFINITY;
    return Math.abs(Math.log(own) - Math.log(target));
  };
  const ranked = others
    .map((model) => ({ model, score: score(model) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id));
  const picks: string[] = [];
  const usedProviders = new Set<string>();
  for (const { model } of ranked) {
    const owner = providerOf(model);
    if (usedProviders.has(owner)) continue;
    usedProviders.add(owner);
    picks.push(model.id);
    if (picks.length >= Math.min(limit, AGENT_FALLBACK_MODELS_MAX)) break;
  }
  return picks;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function effortsFor(fallbacks: readonly string[], level: string | undefined, models: readonly OmpChoiceModel[]): Record<string, string> | undefined {
  if (!level || fallbacks.length === 0) return undefined;
  const efforts: Record<string, string> = {};
  for (const selector of fallbacks) {
    efforts[selector] = nearestThinkingLevel(level, models.find((model) => model.id === selector)?.thinking);
  }
  return efforts;
}

export interface OmpChoiceContext {
  config: Record<string, unknown>;
  models: readonly OmpChoiceModel[];
}

function thinkingPatch(level: string, config: Record<string, unknown>, models: readonly OmpChoiceModel[]): AgentSettingsPatch {
  return {
    thinking: level,
    [`${OMP_SETTINGS_PATH_PREFIX}defaultThinkingLevel`]: level,
    modelEfforts: effortsFor(stringList(config.fallbackModels), level, models),
  };
}

function backupPatch(choice: OmpBackupChoice, config: Record<string, unknown>, models: readonly OmpChoiceModel[], custom?: readonly string[]): AgentSettingsPatch {
  const model = typeof config.model === "string" ? config.model : "";
  const list = choice === "automatic" ? deriveOmpBackupModels(model, models) : [...(custom ?? [])].filter((entry) => entry && entry !== model).slice(0, AGENT_FALLBACK_MODELS_MAX);
  const level = typeof config.thinking === "string" ? config.thinking : undefined;
  return {
    [OMP_FALLBACK_MODE_KEY]: choice,
    fallbackModels: list.length > 0 ? list : undefined,
    modelEfforts: effortsFor(list, level, models),
    [`${OMP_SETTINGS_PATH_PREFIX}retry.fallbackOn`]: list.length > 0 ? "any" : undefined,
  };
}

export function ompChoicePatch(
  control: OmpControlId,
  value: string,
  context: OmpChoiceContext,
  options: { customBackups?: readonly string[] } = {},
): AgentSettingsPatch {
  const { config, models } = context;
  switch (control) {
    case "style": {
      const preset = OMP_STYLE_PRESETS[value as OmpStylePreset];
      if (!preset) throw new Error(`Unknown style "${value}".`);
      return {
        [OMP_STYLE_KEY]: value,
        advisor: preset.advisor,
        prewalk: preset.prewalk,
        [`${OMP_SETTINGS_PATH_PREFIX}retry.maxRetries`]: preset.maxRetries,
        ...thinkingPatch(preset.thinking, config, models),
      };
    }
    case "thinking": {
      const choice = OMP_THINKING_CHOICES[value as OmpThinkingChoice];
      if (!choice) throw new Error(`Unknown thinking choice "${value}".`);
      return thinkingPatch(choice.level, config, models);
    }
    case "model": {
      if (!value) throw new Error("Pick a model.");
      const roles = deriveOmpModelRoles(value, models);
      const next = applyAgentSettingsPatch(config, { model: value, ...roles });
      const patch: AgentSettingsPatch = { model: value, ...roles };
      if (config[OMP_FALLBACK_MODE_KEY] === "automatic") Object.assign(patch, backupPatch("automatic", next, models));
      return patch;
    }
    case "backup": {
      if (value !== "automatic" && value !== "custom") throw new Error(`Unknown backup choice "${value}".`);
      return backupPatch(value, config, models, options.customBackups);
    }
    case "tools": {
      if (!(value in OMP_TOOLS_CHOICES)) throw new Error(`Unknown tools choice "${value}".`);
      const cleared: AgentSettingsPatch = { tools: undefined, approvalMode: undefined, noLsp: undefined, [TOOL_APPROVAL_PATH]: undefined };
      for (const path of TOOL_SWITCH_PATHS) cleared[path] = undefined;
      if (value === "readOnly") {
        return {
          ...cleared,
          [`${OMP_SETTINGS_PATH_PREFIX}bash.enabled`]: false,
          [`${OMP_SETTINGS_PATH_PREFIX}browser.enabled`]: false,
          [TOOL_APPROVAL_PATH]: Object.fromEntries(OMP_READ_ONLY_DENIED_TOOLS.map((tool) => [tool, "deny"])),
        };
      }
      if (value === "everything") {
        const everything = { ...cleared };
        for (const path of TOOL_SWITCH_PATHS) everything[path] = true;
        return everything;
      }
      return cleared;
    }
    case "limit": {
      const choice = OMP_LIMIT_CHOICES[value as OmpLimitChoice];
      if (!choice) throw new Error(`Unknown limit "${value}".`);
      if (choice.seconds === 0) return { maxTime: undefined, timeoutSec: 0 };
      return { maxTime: String(choice.seconds), timeoutSec: choice.seconds + OMP_RUN_GRACE_SEC };
    }
  }
}

export function readOmpChoices(config: Record<string, unknown> | null | undefined): Record<OmpControlId, string | null> {
  const source = config ?? {};
  const style = typeof source[OMP_STYLE_KEY] === "string" && source[OMP_STYLE_KEY] as string in OMP_STYLE_PRESETS ? source[OMP_STYLE_KEY] as string : null;
  const thinking = (Object.entries(OMP_THINKING_CHOICES).find(([, choice]) => choice.level === source.thinking)?.[0]) ?? null;
  const model = typeof source.model === "string" && source.model ? source.model : null;
  const mode = source[OMP_FALLBACK_MODE_KEY];
  const backup = mode === "automatic" || mode === "custom" ? mode : stringList(source.fallbackModels).length > 0 ? "custom" : null;
  let tools: string | null = null;
  for (const choice of Object.keys(OMP_TOOLS_CHOICES)) {
    const patch = ompChoicePatch("tools", choice, { config: source, models: [] });
    if (Object.entries(patch).every(([path, value]) => sameAgentSettingValue(readAgentSetting(source, path), value))) {
      tools = choice;
      break;
    }
  }
  let limit: string | null = null;
  for (const choice of Object.keys(OMP_LIMIT_CHOICES)) {
    const patch = ompChoicePatch("limit", choice, { config: source, models: [] });
    if (Object.entries(patch).every(([path, value]) => sameAgentSettingValue(readAgentSetting(source, path), value))) {
      limit = choice;
      break;
    }
  }
  return { style, model, thinking, backup, tools, limit };
}

export function agentDiffersFromDefaults(
  config: Record<string, unknown> | null | undefined,
  defaults: AgentSettingsValues,
  paths: readonly string[],
): boolean {
  return paths.some((path) => !sameAgentSettingValue(readAgentSetting(config, path), defaults[path]));
}

export function resetToDefaultsPatch(defaults: AgentSettingsValues, paths: readonly string[]): AgentSettingsPatch {
  return Object.fromEntries(paths.map((path) => [path, defaults[path]]));
}

export function applyDefaultsPatch(defaults: AgentSettingsValues, patch: AgentSettingsPatch): AgentSettingsValues {
  const next: AgentSettingsValues = { ...defaults };
  for (const [path, value] of Object.entries(patch)) {
    if (value === undefined) delete next[path];
    else next[path] = value;
  }
  return next;
}

export function defaultsAsConfig(defaults: AgentSettingsValues): Record<string, unknown> {
  return applyAgentSettingsPatch({}, defaults);
}

export interface AgentDefaultsApplyAgent {
  id: string;
  name: string;
  adapterConfig: Record<string, unknown> | null;
}

export interface AgentDefaultsApplyEntry {
  agentId: string;
  name: string;
  adapterConfig: Record<string, unknown>;
  appliedPaths: string[];
  keptPaths: string[];
}

export function planAgentDefaultsApply(
  agents: readonly AgentDefaultsApplyAgent[],
  previous: AgentSettingsValues,
  next: AgentSettingsValues,
): { changedPaths: string[]; entries: AgentDefaultsApplyEntry[]; following: number; ownValues: number; sessionKept: boolean } {
  const changedPaths = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((path) => !sameAgentSettingValue(previous[path], next[path]))
    .sort();
  const entries: AgentDefaultsApplyEntry[] = [];
  let following = 0;
  let ownValues = 0;
  for (const agent of agents) {
    const appliedPaths: string[] = [];
    const keptPaths: string[] = [];
    const patch: AgentSettingsPatch = {};
    for (const path of changedPaths) {
      if (sameAgentSettingValue(readAgentSetting(agent.adapterConfig, path), previous[path])) {
        appliedPaths.push(path);
        patch[path] = next[path];
      } else {
        keptPaths.push(path);
      }
    }
    if (appliedPaths.length > 0) following += 1;
    if (keptPaths.length > 0) ownValues += 1;
    entries.push({ agentId: agent.id, name: agent.name, adapterConfig: applyAgentSettingsPatch(agent.adapterConfig, patch), appliedPaths, keptPaths });
  }
  const sessionKept = changedPaths.every((path) => OMP_SESSION_KEEPING_ADAPTER_CONFIG_KEYS.includes(path));
  return { changedPaths, entries, following, ownValues, sessionKept };
}

export function agentSettingsKeepSession(paths: readonly string[]): boolean {
  return paths.every((path) => OMP_SESSION_KEEPING_ADAPTER_CONFIG_KEYS.includes(path));
}

export type OmpEssentialPlacement = "choice" | "elsewhere" | "advanced";

export interface OmpEssentialSetting {
  key: string;
  label: string;
  path: string;
  placement: OmpEssentialPlacement;
  where?: string;
}

const ESSENTIAL: Array<[label: string, key: string, path: string]> = [
  ["Model", "model", "model"],
  ["Thinking level", "thinking", "thinking"],
  ["Effort per model", "modelEfforts", "modelEfforts"],
  ["Fallback chain", "fallbackModels", "fallbackModels"],
  ["Small model", "smolModel", "smolModel"],
  ["Slow model", "slowModel", "slowModel"],
  ["Plan model", "planModel", "planModel"],
  ["Default thinking level", "defaultThinkingLevel", ompSettingPath("defaultThinkingLevel")],
  ["Advisor", "advisor.enabled", ompSettingPath("advisor.enabled")],
  ["Prewalk to small model", "prewalk.enabled", ompSettingPath("prewalk.enabled")],
  ["Retries", "retry.maxRetries", ompSettingPath("retry.maxRetries")],
  ["Fall back on", "retry.fallbackOn", ompSettingPath("retry.fallbackOn")],
  ["Hide thinking from log", "omitThinking", ompSettingPath("omitThinking")],
  ["Tool allowlist", "tools", "tools"],
  ["Approval mode", "tools.approvalMode", ompSettingPath("tools.approvalMode")],
  ["Shell", "bash.enabled", ompSettingPath("bash.enabled")],
  ["Browser", "browser.enabled", ompSettingPath("browser.enabled")],
  ["Web search", "web_search.enabled", ompSettingPath("web_search.enabled")],
  ["GitHub tool", "github.enabled", ompSettingPath("github.enabled")],
  ["Ask tool", "ask.enabled", ompSettingPath("ask.enabled")],
  ["LSP", "lsp.enabled", ompSettingPath("lsp.enabled")],
  ["Skills", "skills", "skills"],
  ["MCP startup timeout", "mcp.startupTimeoutMs", ompSettingPath("mcp.startupTimeoutMs")],
  ["MCP project config", "mcp.enableProjectConfig", ompSettingPath("mcp.enableProjectConfig")],
  ["Extensions", "extensions", "extensions"],
  ["Hooks", "hooks", "hooks"],
  ["Context notes", "compaction.experimentalContextManagement", ompSettingPath("compaction.experimentalContextManagement")],
  ["Compaction threshold", "compaction.thresholdPercent", ompSettingPath("compaction.thresholdPercent")],
  ["Extra context files", "contextFiles.extra", ompSettingPath("contextFiles.extra")],
  ["Subagent depth", "task.maxRecursionDepth", ompSettingPath("task.maxRecursionDepth")],
  ["Max run time", "maxTime", "maxTime"],
  ["Timeout", "timeoutSec", "timeoutSec"],
  ["Instructions file", "instructionsFilePath", "instructionsFilePath"],
  ["System prompt", "systemPrompt", "systemPrompt"],
  ["Environment variables", "env", "env"],
  ["OMP profile", "profile", "profile"],
];

const ELSEWHERE: Record<string, string> = {
  skills: "Skills tab",
  instructionsFilePath: "Instructions tab",
  systemPrompt: "Instructions tab",
  env: "Secrets and environment",
};

const CHOICE_PATHS = new Set(Object.values(OMP_CONTROL_PATHS).flat());

export const OMP_ESSENTIAL_SETTINGS: readonly OmpEssentialSetting[] = ESSENTIAL.map(([label, key, path]) => ({
  key,
  label,
  path,
  placement: ELSEWHERE[key] ? "elsewhere" : CHOICE_PATHS.has(path) ? "choice" : "advanced",
  ...(ELSEWHERE[key] ? { where: ELSEWHERE[key] } : {}),
}));

export const OMP_ADAPTER_SETTINGS: ReadonlyArray<{ key: string; label: string; type: "string" | "number" | "array" | "record"; description: string }> = [
  { key: "model", label: "Model", type: "string", description: "Model selector passed to OMP --model." },
  { key: "thinking", label: "Thinking level", type: "string", description: "Thinking level passed to OMP --thinking." },
  { key: "modelEfforts", label: "Effort per model", type: "record", description: "Thinking level per fallback model." },
  { key: "fallbackModels", label: "Fallback chain", type: "array", description: "Models used, in order, when the primary model is rate limited or down." },
  { key: "smolModel", label: "Small model", type: "string", description: "Model passed to OMP --smol." },
  { key: "slowModel", label: "Slow model", type: "string", description: "Model passed to OMP --slow." },
  { key: "planModel", label: "Plan model", type: "string", description: "Model passed to OMP --plan." },
  { key: "tools", label: "Tool allowlist", type: "string", description: "Comma-separated OMP tool names. Empty keeps OMP's default tool set." },
  { key: "skills", label: "Skills", type: "string", description: "Comma-separated OMP skill names." },
  { key: "extensions", label: "Extensions", type: "array", description: "OMP extension paths." },
  { key: "hooks", label: "Hooks", type: "array", description: "OMP hook paths." },
  { key: "maxTime", label: "Max run time", type: "string", description: "Seconds passed to OMP --max-time." },
  { key: "timeoutSec", label: "Timeout", type: "number", description: "Seconds before Paperclip stops the OMP process; 0 means no limit." },
  { key: "instructionsFilePath", label: "Instructions file", type: "string", description: "Set in the Instructions tab." },
  { key: "systemPrompt", label: "System prompt", type: "string", description: "Set in the Instructions tab." },
  { key: "env", label: "Environment variables", type: "record", description: "Set in Secrets and environment." },
  { key: "profile", label: "OMP profile", type: "string", description: "Isolated OMP profile for auth, sessions and settings." },
];
