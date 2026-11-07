import { z } from "zod";

export const ONBOARDING_OMP_LOGIN_PROVIDERS = ["anthropic", "openai-codex", "openrouter"] as const;
export type OnboardingOmpLoginProvider = (typeof ONBOARDING_OMP_LOGIN_PROVIDERS)[number];

export const onboardingOmpLoginRequestSchema = z.object({
  provider: z.enum(ONBOARDING_OMP_LOGIN_PROVIDERS),
}).strict();
export type OnboardingOmpLoginRequest = z.infer<typeof onboardingOmpLoginRequestSchema>;

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

export interface OnboardingOmpLoginResult {
  provider: OnboardingOmpLoginProvider;
  url: string;
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
