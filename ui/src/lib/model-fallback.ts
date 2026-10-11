import type { IssueRunModelOverrideOption, RunModelFallbackReason, RunModelFallbackState } from "@tickernelz/paperclip-pro-shared";
import {
  describeModelValue,
  modelValueText,
  type ModelValueDisplay,
} from "@/components/task-chat/model-option-display";

export const MODEL_FALLBACK_REASON_LABELS: Record<RunModelFallbackReason, string> = {
  rate_limit: "rate limit",
  upstream: "upstream error",
  refusal: "refusal",
};

const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max|auto)$/;

/** Display name and provider for an OMP selector, from catalog options or the selector itself. */
export function describeFallbackModel(
  selector: string,
  options: readonly IssueRunModelOverrideOption[],
): ModelValueDisplay {
  const bare = selector.trim().replace(THINKING_SUFFIX, "");
  for (const candidate of [selector.trim(), bare]) {
    const display = describeModelValue(candidate, options);
    if (display.provider) return { ...display, id: selector };
  }
  const slash = bare.indexOf("/");
  if (slash <= 0 || slash === bare.length - 1) return { name: bare, provider: null, id: selector };
  return { name: bare.slice(slash + 1), provider: bare.slice(0, slash), id: selector };
}

/** Human label for a fallback reason, passing unknown reasons through. */
export function modelFallbackReasonLabel(reason: string): string {
  return MODEL_FALLBACK_REASON_LABELS[reason as RunModelFallbackReason] ?? reason.replace(/_/g, " ");
}

/** Live-run badge text such as "Fallback: GPT · openai (primary: rate limit)". */
export function formatModelFallbackLabel(
  state: RunModelFallbackState,
  options: readonly IssueRunModelOverrideOption[],
): string {
  const active = modelValueText(describeFallbackModel(state.activeModel, options));
  return `Fallback: ${active} (primary: ${modelFallbackReasonLabel(state.reason)})`;
}

function payloadText(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Readable line for model.fallback* run events, or null for any other event type. */
export function describeModelFallbackEvent(
  eventType: string,
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (eventType === "model.fallback") {
    const to = payloadText(payload, "to") ?? "next model";
    const primary = payloadText(payload, "primary") ?? payloadText(payload, "from");
    const reason = payloadText(payload, "reason");
    const detail = [primary, reason ? modelFallbackReasonLabel(reason) : null].filter(Boolean).join(": ");
    return detail ? `Fallback: ${to} (primary ${detail})` : `Fallback: ${to}`;
  }
  if (eventType === "model.fallback_restored") {
    const to = payloadText(payload, "to");
    return to ? `Fallback ended: back on ${to}` : "Fallback ended: back on the primary model";
  }
  if (eventType === "model.fallback_exhausted") {
    const primary = payloadText(payload, "primary");
    const tried = Array.isArray(payload?.tried)
      ? payload.tried.filter((entry): entry is string => typeof entry === "string")
      : [];
    const reason = payloadText(payload, "reason");
    const parts = [
      primary ? `primary ${primary}` : null,
      tried.length > 0 ? `tried ${tried.join(", ")}` : null,
      reason ? modelFallbackReasonLabel(reason) : null,
    ].filter(Boolean);
    return parts.length > 0
      ? `Fallback models exhausted (${parts.join("; ")})`
      : "Fallback models exhausted";
  }
  return null;
}
