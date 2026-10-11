import { describe, expect, it } from "vitest";
import {
  describeFallbackModel,
  describeModelFallbackEvent,
  formatModelFallbackLabel,
} from "./model-fallback";

const OPTIONS = [
  { value: "openai/gpt-5", label: "GPT-5 (openai/gpt-5)", group: "OpenAI", name: "GPT-5" },
  { value: "anthropic/opus", label: "anthropic/opus", group: "anthropic" },
];

describe("formatModelFallbackLabel", () => {
  const state = { primaryModel: "anthropic/opus", activeModel: "openai/gpt-5", reason: "rate_limit" as const, switchedAt: "2026-10-11T00:00:00Z" };

  it("uses the catalog display name and provider", () => {
    expect(formatModelFallbackLabel(state, OPTIONS)).toBe("Fallback: GPT-5 · OpenAI (primary: rate limit)");
  });

  it("splits the selector and strips a thinking suffix when the catalog lacks the model", () => {
    expect(formatModelFallbackLabel({ ...state, activeModel: "zai/glm-4.6:high", reason: "upstream" }, [])).toBe(
      "Fallback: glm-4.6 · zai (primary: upstream error)",
    );
    expect(formatModelFallbackLabel({ ...state, activeModel: "local-model", reason: "refusal" }, [])).toBe(
      "Fallback: local-model (primary: refusal)",
    );
  });

  it("matches a catalog entry after stripping the thinking suffix", () => {
    expect(describeFallbackModel("openai/gpt-5:xhigh", OPTIONS)).toEqual({
      name: "GPT-5",
      provider: "OpenAI",
      id: "openai/gpt-5:xhigh",
    });
  });

  it("splits only at the first slash", () => {
    expect(describeFallbackModel("openrouter/meta/llama:max", [])).toEqual({
      name: "meta/llama",
      provider: "openrouter",
      id: "openrouter/meta/llama:max",
    });
  });
});

describe("describeModelFallbackEvent", () => {
  it("describes switch, restore and exhaustion events", () => {
    expect(describeModelFallbackEvent("model.fallback", {
      phase: "in_run", from: "a/one", to: "b/two", primary: "a/one", reason: "rate_limit", retryAfterMs: 1000,
    })).toBe("Fallback: b/two (primary a/one: rate limit)");
    expect(describeModelFallbackEvent("model.fallback_restored", { from: "b/two", to: "a/one" })).toBe(
      "Fallback ended: back on a/one",
    );
    expect(describeModelFallbackEvent("model.fallback_exhausted", {
      primary: "a/one", tried: ["a/one", "b/two"], reason: "refusal",
    })).toBe("Fallback models exhausted (primary a/one; tried a/one, b/two; refusal)");
    expect(describeModelFallbackEvent("run.terminal", {})).toBeNull();
  });
});
