import type { AdapterRuntimeEvent } from "@tickernelz/paperclip-pro-adapter-utils";
import { classifyFallbackReason, retryDelayMsFromText, type OmpFallbackReason } from "./failure.js";

const THINKING_SUFFIX_RE = /:(?:auto|off|minimal|low|medium|high|xhigh|max)$/i;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const FALLBACK_REASON_LABELS: Record<OmpFallbackReason, string> = {
  rate_limit: "rate limit",
  upstream: "upstream error",
  refusal: "refusal",
};

type JsonObject = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

/** Drops an OMP thinking-level suffix so selectors compare by provider/model. */
export function stripOmpThinkingSuffix(selector: string): string {
  return selector.trim().replace(THINKING_SUFFIX_RE, "");
}

/** The ordered fallback chain for the run's model, or null when the agent has none. */
export function ompFallbackChain(config: Record<string, unknown>): { key: string; chain: string[] } | null {
  const key = text(config.model);
  if (!key || !Array.isArray(config.fallbackModels)) return null;
  const chain: string[] = [];
  for (const entry of config.fallbackModels) {
    const selector = text(entry);
    if (!selector || selector === key || chain.includes(selector)) continue;
    chain.push(selector);
  }
  return chain.length > 0 ? { key, chain } : null;
}

export interface OmpModelFallbackSwitch {
  from: string;
  to: string;
  reason: OmpFallbackReason;
  retryAfterMs: number;
  at: string;
}

export interface OmpModelFallbackTracker {
  ingest(event: JsonObject | null): Promise<void>;
  snapshot(): { primary: string; start: string; active: string; switches: OmpModelFallbackSwitch[] };
}

/** Follows OMP's in-run model switches and reports each one as a Paperclip run event. */
export function createOmpModelFallbackTracker(input: {
  primary: string;
  start: string;
  emit: ((event: AdapterRuntimeEvent) => Promise<void>) | undefined;
}): OmpModelFallbackTracker {
  let active = input.start;
  let lastRetryError = "";
  const switches: OmpModelFallbackSwitch[] = [];
  const emit = async (event: AdapterRuntimeEvent) => {
    if (!input.emit) return;
    try {
      await input.emit(event);
    } catch {
    }
  };
  return {
    async ingest(event) {
      if (!event) return;
      const type = text(event.type);
      if (type === "auto_retry_start") {
        lastRetryError = text(event.errorMessage);
        return;
      }
      if (type === "retry_fallback_applied") {
        const from = stripOmpThinkingSuffix(text(event.from));
        const to = stripOmpThinkingSuffix(text(event.to));
        if (!from || !to || from === to || from !== active) return;
        const reason = classifyFallbackReason(lastRetryError);
        const retryAfterMs = retryDelayMsFromText(lastRetryError) ?? DEFAULT_COOLDOWN_MS;
        active = to;
        switches.push({ from, to, reason, retryAfterMs, at: new Date().toISOString() });
        await emit({
          eventType: "model.fallback",
          stream: "system",
          level: "warn",
          message: `Fallback: ${to} (primary ${input.primary}: ${FALLBACK_REASON_LABELS[reason]})`,
          payload: { phase: "in_run", from, to, primary: input.primary, reason, retryAfterMs },
        });
        return;
      }
      if (type !== "message_end" && type !== "turn_end") return;
      if (active === input.primary) return;
      const message = object(event.message);
      if (!message || text(message.role) !== "assistant") return;
      const provider = text(message.provider);
      const model = text(message.model);
      if (!provider || !model || `${provider}/${model}` !== stripOmpThinkingSuffix(input.primary)) return;
      const from = active;
      active = input.primary;
      await emit({
        eventType: "model.fallback_restored",
        stream: "system",
        level: "info",
        message: `Back on primary model ${input.primary}`,
        payload: { from, to: input.primary },
      });
    },
    snapshot() {
      return { primary: input.primary, start: input.start, active, switches: [...switches] };
    },
  };
}
