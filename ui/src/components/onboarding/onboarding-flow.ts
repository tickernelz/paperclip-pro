import type { OnboardingOmpStatus, OnboardingRemoteOmpStatus } from "@tickernelz/paperclip-pro-shared";

export type OnboardingStepIndex = 0 | 1 | 2;
export const ONBOARDING_STEP_NAMES = ["Check OMP", "Connect a model", "First task"] as const;
export const FIRST_AGENT_NAME = "Atlas";
export const FIRST_AGENT_ROLE = "general";
export const TASK_TITLE_MAX = 120;

export type CheckView = "install" | "old" | "offline" | "ready";
export type ProviderChoice = "anthropic" | "openai-codex" | "openrouter" | "other";

export const PROVIDER_OPTIONS: ReadonlyArray<{ id: ProviderChoice; name: string; detail: string }> = [
  { id: "anthropic", name: "Anthropic", detail: "Sign in in the browser" },
  { id: "openai-codex", name: "OpenAI", detail: "Sign in in the browser" },
  { id: "openrouter", name: "OpenRouter", detail: "Sign in in the browser" },
  { id: "other", name: "Other", detail: "Any OpenAI-compatible server" },
];

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI",
  openrouter: "OpenRouter",
  google: "Google",
  deepseek: "DeepSeek",
};

export function providerLabel(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return PROVIDER_LABELS[provider] ?? provider;
}

export function checkView(status: OnboardingOmpStatus): CheckView {
  if (status.state === "ready") return "ready";
  if (status.state === "missing") return status.network === "offline" ? "offline" : "install";
  return "old";
}

export function hasModel(status: OnboardingOmpStatus | null | undefined): boolean {
  return (status?.models.length ?? 0) > 0;
}

export function nextStepAfterCheck(status: OnboardingOmpStatus): OnboardingStepIndex | null {
  if (status.state !== "ready") return null;
  return hasModel(status) ? 2 : 1;
}

export function nextStepAfterRemote(remote: OnboardingRemoteOmpStatus): OnboardingStepIndex | null {
  if (!remote.connected || remote.state !== "ready") return null;
  return remote.modelCount > 0 ? 2 : 1;
}

export function olderCopies(status: OnboardingOmpStatus): Array<{ path: string; version: string | null }> {
  return status.copies.slice(1).filter((copy) => copy.version !== status.version);
}

export function taskTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length <= TASK_TITLE_MAX) return firstLine;
  return `${firstLine.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…`;
}

export function companyNameForFolder(folder: string | null | undefined): string {
  const base = folder?.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.trim();
  return base ? base : "My company";
}

export function recommendedModelLabel(status: OnboardingOmpStatus | null | undefined): string | null {
  if (!status?.recommendedModel) return null;
  return status.models.find((model) => model.id === status.recommendedModel)?.label ?? status.recommendedModel;
}

export function signedInProvider(status: OnboardingOmpStatus | null | undefined): string | null {
  if (!status?.recommendedModel) return null;
  const model = status.models.find((entry) => entry.id === status.recommendedModel);
  return providerLabel(model?.provider ?? status.recommendedModel.split("/", 1)[0]);
}
