import { describe, expect, it } from "vitest";
import { buildIssueRunAdapterConfig } from "./issue-run-model-override.js";
import {
  modelFallbackAttemptBudget,
  modelFallbackAttemptLimit,
  normalizeAgentFallbackModelsConfig,
  planModelFallbackStep,
  readModelFallbackAttempts,
} from "./model-fallback.js";

const now = new Date("2026-10-11T10:00:00.000Z");

describe("fallback lineage", () => {
  const step = (input: {
    active: string;
    reason?: "rate_limit" | "upstream" | "refusal";
    attempts?: Record<string, number>;
    chain?: string[];
  }) =>
    planModelFallbackStep({
      chain: input.chain ?? ["a/x", "b/y", "c/z"],
      primary: "a/x",
      active: input.active,
      reason: input.reason ?? "upstream",
      attempts: input.attempts ?? {},
      now,
    });

  it("gives the primary one fast retry before the chain moves on", () => {
    const first = step({ active: "a/x" });
    expect(first).toMatchObject({ start: "a/x", fastRetry: true });
    expect(first.attempts).toEqual({ "a/x": 1 });
  });

  it("falls back to the first model that has not failed once the primary is spent", () => {
    const second = step({ active: "a/x", attempts: { "a/x": 1 } });
    expect(second).toMatchObject({ start: "b/y", fastRetry: false });
    expect(second.attempts).toEqual({ "a/x": 2 });
  });

  it("never retries a fallback: one failure advances to the next model", () => {
    expect(step({ active: "b/y", attempts: { "a/x": 2 } })).toMatchObject({ start: "c/z", fastRetry: false });
    expect(step({ active: "c/z", attempts: { "a/x": 2, "b/y": 1 } })).toMatchObject({ start: null, fastRetry: false });
  });

  it("moves straight past a refusal without retrying that model", () => {
    expect(step({ active: "a/x", reason: "refusal" })).toMatchObject({ start: "b/y", fastRetry: false });
  });

  it("budgets one attempt per chain entry plus the primary retry", () => {
    expect(step({ active: "a/x" }).maxAttempts).toBe(4);
    expect(modelFallbackAttemptBudget(["a/x", "b/y"], "a/x")).toBe(3);
    expect(modelFallbackAttemptLimit("a/x", "a/x")).toBe(2);
    expect(modelFallbackAttemptLimit("b/y", "a/x")).toBe(1);
  });

  it("keeps a task override as the primary with the agent chain after it", () => {
    const { config } = buildIssueRunAdapterConfig(
      { model: "a/agent", fallbackModels: ["b/one", "c/override", "d/two"] },
      { adapterConfig: { model: "c/override" } },
    );
    const plan = planModelFallbackStep({
      chain: ["c/override", "b/one", "d/two"],
      primary: String(config.model),
      active: String(config.model),
      reason: "rate_limit",
      attempts: {},
      now,
    });
    expect(plan.chain).toEqual(["c/override", "b/one", "d/two"]);
    expect(plan.start).toBe("c/override");
  });

  it("reads a lineage attempt map leniently", () => {
    expect(readModelFallbackAttempts({ "a/x": 2, "b/y": "1", "": 3, "c/z": -1 })).toEqual({ "a/x": 2 });
  });
});

describe("agent fallback model validation", () => {
  it("accepts up to five distinct non-primary models and drops an empty list", () => {
    expect(normalizeAgentFallbackModelsConfig("omp_local", { model: "a/x", fallbackModels: [" b/y ", "c/z"] })).toEqual({
      model: "a/x",
      fallbackModels: ["b/y", "c/z"],
    });
    expect(normalizeAgentFallbackModelsConfig("omp_local", { model: "a/x", fallbackModels: [] })).toEqual({ model: "a/x" });
  });

  it("rejects duplicates, the primary and a sixth entry", () => {
    expect(() => normalizeAgentFallbackModelsConfig("omp_local", { model: "a/x", fallbackModels: ["b/y", "b/y"] })).toThrow(/twice/);
    expect(() => normalizeAgentFallbackModelsConfig("omp_local", { fallbackModels: ["a/x"] }, { model: "a/x" })).toThrow(/primary/);
    expect(() => normalizeAgentFallbackModelsConfig("omp_local", { model: "a/x", fallbackModels: ["b/1", "b/2", "b/3", "b/4", "b/5", "b/6"] })).toThrow(/at most 5/);
  });

  it("ignores the key on adapters without fallback support", () => {
    const config = { model: "a/x", fallbackModels: ["a/x"] };
    expect(normalizeAgentFallbackModelsConfig("claude_local", config)).toBe(config);
  });

  it("keeps fallback efforts only for models still on the list", () => {
    expect(normalizeAgentFallbackModelsConfig("omp_local", {
      model: "a/x",
      thinking: "high",
      fallbackModels: ["b/y"],
      modelEfforts: { "b/y": "low", "c/z": "max", "a/x": "xhigh" },
    })).toEqual({ model: "a/x", thinking: "high", fallbackModels: ["b/y"], modelEfforts: { "b/y": "low" } });
  });

  it("drops the effort map when its fallback list is emptied", () => {
    expect(normalizeAgentFallbackModelsConfig("omp_local", { model: "a/x", fallbackModels: [], modelEfforts: { "b/y": "low" } }))
      .toEqual({ model: "a/x" });
  });

  it("prunes an effort-only update against the stored fallback list", () => {
    expect(normalizeAgentFallbackModelsConfig(
      "omp_local",
      { modelEfforts: { "b/y": "low", "c/z": "max" } },
      { model: "a/x", fallbackModels: ["c/z"] },
    )).toEqual({ modelEfforts: { "c/z": "max" } });
  });
});
