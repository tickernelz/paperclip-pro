import { z } from "zod";

export const OMP_PROVIDER_APIS = [
  "openai-responses",
  "openai-completions",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "google-gemini-cli",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "openrouter-decisions",
  "openai-decisions",
  "workers-ai-systemone",
  "typesafe",
] as const;
export type OmpProviderApi = (typeof OMP_PROVIDER_APIS)[number];

export const OMP_DISCOVERY_TYPES = [
  "openai-models-list",
  "proxy",
  "litellm",
  "ollama",
  "llama.cpp",
  "lm-studio",
  "apple-foundation-models",
] as const;
export type OmpDiscoveryType = (typeof OMP_DISCOVERY_TYPES)[number];

export const OMP_PROVIDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
export const OMP_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export const onboardingOmpLoginRequestSchema = z.object({
  provider: z.string().trim().min(1).max(200),
}).strict();
export type OnboardingOmpLoginRequest = z.infer<typeof onboardingOmpLoginRequestSchema>;

export const onboardingOmpLoginInputSchema = z.object({
  value: z.string().trim().min(1).max(8_192).refine((value) => !/[\r\n]/.test(value), "Paste a single line: the address the sign-in page ended on, or the code it shows"),
}).strict();
export type OnboardingOmpLoginInput = z.infer<typeof onboardingOmpLoginInputSchema>;

export type OnboardingOmpLoginState = "waiting" | "succeeded" | "failed" | "cancelled";

export interface OnboardingOmpLoginView {
  id: string;
  provider: string;
  state: OnboardingOmpLoginState;
  url: string | null;
  lines: string[];
  prompt: { label: string; secret: boolean } | null;
  message: string | null;
}

export interface OnboardingOmpLoginProviders {
  providers: string[];
}

export const ompCustomProviderKeySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }).strict(),
  z.object({ kind: z.literal("env"), name: z.string().trim().regex(OMP_ENV_NAME_PATTERN, "Use an environment variable name such as MY_GATEWAY_KEY") }).strict(),
  z.object({ kind: z.literal("literal"), value: z.string().trim().min(1).max(8_192) }).strict(),
  z.object({ kind: z.literal("command"), command: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
export type OmpCustomProviderKeyInput = z.infer<typeof ompCustomProviderKeySchema>;

export const ompCustomProviderHeaderSchema = z.object({
  name: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "Header names use letters, digits and dashes"),
  value: z.string().max(8_192).optional(),
}).strict();

export const ompCustomProviderModelSchema = z.object({
  id: z.string().trim().min(1).max(300),
  name: z.string().trim().max(300).optional(),
  api: z.enum(OMP_PROVIDER_APIS).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoning: z.boolean().optional(),
  images: z.boolean().optional(),
}).strict();
export type OmpCustomProviderModelInput = z.infer<typeof ompCustomProviderModelSchema>;

export const ompCustomProviderDiscoverySchema = z.object({
  type: z.enum(OMP_DISCOVERY_TYPES),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  injectV1: z.boolean().optional(),
}).strict();

export const OMP_CUSTOM_PROVIDER_MODEL_LIMIT = 500;

export const ompCustomProviderInputSchema = z.object({
  baseUrl: z.string().trim().url("Use a full URL such as http://localhost:8000/v1").max(2_000),
  api: z.enum(OMP_PROVIDER_APIS).nullable(),
  apiKey: ompCustomProviderKeySchema,
  authHeader: z.boolean(),
  disableStrictTools: z.boolean(),
  headers: z.array(ompCustomProviderHeaderSchema).max(50),
  discovery: ompCustomProviderDiscoverySchema.nullable(),
  models: z.array(ompCustomProviderModelSchema).max(OMP_CUSTOM_PROVIDER_MODEL_LIMIT),
}).strict().superRefine((value, ctx) => {
  if (!value.discovery && value.models.length === 0) {
    ctx.addIssue({ code: "custom", path: ["models"], message: "Add at least one model, or turn on model discovery" });
  }
  if (!value.api && (value.discovery || value.models.some((model) => !model.api))) {
    ctx.addIssue({ code: "custom", path: ["api"], message: "Pick the wire format (api) for this provider" });
  }
  if (value.discovery?.injectV1 !== undefined && value.discovery.type !== "openai-models-list") {
    ctx.addIssue({ code: "custom", path: ["discovery", "injectV1"], message: "Only openai-models-list discovery uses injectV1" });
  }
  const ids = new Set<string>();
  value.models.forEach((model, index) => {
    if (ids.has(model.id)) ctx.addIssue({ code: "custom", path: ["models", index, "id"], message: `Model ${model.id} is listed twice` });
    ids.add(model.id);
  });
  const headers = new Set<string>();
  value.headers.forEach((header, index) => {
    const key = header.name.toLowerCase();
    if (headers.has(key)) ctx.addIssue({ code: "custom", path: ["headers", index, "name"], message: `Header ${header.name} is listed twice` });
    headers.add(key);
  });
});
export type OmpCustomProviderInput = z.infer<typeof ompCustomProviderInputSchema>;

export const ompCustomProviderProbeSchema = z.object({
  name: z.string().trim().regex(OMP_PROVIDER_NAME_PATTERN).optional(),
  baseUrl: z.string().trim().url().max(2_000),
  apiKey: ompCustomProviderKeySchema,
  authHeader: z.boolean(),
  headers: z.array(ompCustomProviderHeaderSchema).max(50),
  modelId: z.string().trim().min(1).max(300).optional(),
}).strict();
export type OmpCustomProviderProbeInput = z.infer<typeof ompCustomProviderProbeSchema>;

export const ompCustomProviderModelsFetchSchema = z.object({
  name: z.string().trim().regex(OMP_PROVIDER_NAME_PATTERN).optional(),
  baseUrl: z.string().trim().url().max(2_000),
  api: z.enum(OMP_PROVIDER_APIS).nullable(),
  apiKey: ompCustomProviderKeySchema,
  authHeader: z.boolean(),
  headers: z.array(ompCustomProviderHeaderSchema).max(50),
}).strict();
export type OmpCustomProviderModelsFetchInput = z.infer<typeof ompCustomProviderModelsFetchSchema>;

export interface OmpUpstreamModel {
  id: string;
  name?: string;
}

export interface OmpCustomProviderModelsFetchResult {
  url: string;
  status: number | null;
  models: OmpUpstreamModel[];
  truncated: boolean;
  error: string | null;
}

export type OmpCustomProviderKeyView =
  | { kind: "env"; name: string; present: boolean }
  | { kind: "literal" }
  | { kind: "command" }
  | { kind: "none" }
  | { kind: "oauth" }
  | { kind: "missing" };

export interface OmpCustomProviderView {
  name: string;
  baseUrl: string | null;
  api: string | null;
  apiKey: OmpCustomProviderKeyView;
  authHeader: boolean;
  disableStrictTools: boolean;
  headers: Array<{ name: string }>;
  discovery: { type: string; timeoutMs?: number; injectV1?: boolean } | null;
  models: Array<{ id: string; name?: string; api?: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean; images?: boolean }>;
  otherKeys: string[];
}

export interface OmpCustomProviderList {
  modelsPath: string;
  providers: OmpCustomProviderView[];
  parseError: string | null;
}

export interface OmpCustomProviderProbeAttempt {
  api: "openai-responses" | "openai-completions" | "anthropic-messages" | "models-list";
  url: string;
  status: number | null;
  ok: boolean;
  detail: string | null;
}

export interface OmpCustomProviderProbeResult {
  suggestedApi: OmpProviderApi | null;
  models: string[];
  attempts: OmpCustomProviderProbeAttempt[];
  usedModel: string | null;
}

export const SSH_ADDRESS_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/;

export const onboardingRemoteOmpRequestSchema = z.object({
  address: z.string().trim().max(255).regex(SSH_ADDRESS_PATTERN, "Use user@host or user@host:port"),
}).strict();
export type OnboardingRemoteOmpRequest = z.infer<typeof onboardingRemoteOmpRequestSchema>;

export type OnboardingOmpState = "missing" | "too_old" | "unknown_version" | "ready";

export interface OnboardingOmpModel {
  id: string;
  label: string;
  provider: string | null;
}

export interface OnboardingOmpStatus {
  runtime: "local" | "bundled";
  os: { platform: string; label: string };
  minVersion: string;
  state: OnboardingOmpState;
  path: string | null;
  version: string | null;
  copies: Array<{ path: string; version: string | null }>;
  installCommand: string;
  updateCommand: string;
  network: "online" | "offline" | null;
  models: OnboardingOmpModel[];
  recommendedModel: string | null;
  projectFolder: string;
}

export interface OnboardingOmpBrowseEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface OnboardingOmpBrowseResult {
  path: string;
  parent: string | null;
  entries: OnboardingOmpBrowseEntry[];
}

export interface OnboardingRemoteOmpStatus {
  address: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  latencyMs: number | null;
  state: OnboardingOmpState;
  path: string | null;
  version: string | null;
  modelCount: number;
  homeFolder: string | null;
  error: string | null;
}

export function parseSshAddress(address: string): { username: string; host: string; port: number } | null {
  const trimmed = address.trim();
  if (!SSH_ADDRESS_PATTERN.test(trimmed)) return null;
  const at = trimmed.indexOf("@");
  const username = trimmed.slice(0, at);
  const rest = trimmed.slice(at + 1);
  const colon = rest.lastIndexOf(":");
  const host = colon === -1 ? rest : rest.slice(0, colon);
  const port = colon === -1 ? 22 : Number(rest.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { username, host, port };
}
