import { describe, expect, it } from "vitest";
import { buildIssueRunAdapterConfig } from "./issue-run-model-override.js";
import {
  nextModelFallbackCandidate,
  normalizeAgentFallbackModelsConfig,
  selectRunModel,
  type ModelCooldown,
} from "./model-fallback.js";

const now = new Date("2026-10-11T10:00:00.000Z");

function cooling(entries: Array<[string, string]>): Map<string, ModelCooldown> {
  return new Map(entries.map(([selector, until]) => [selector, { selector, until: new Date(until), reason: "rate_limit" as const }]));
}

describe("run model selection", () => {
  it("returns nothing when the agent has no fallback models", () => {
    expect(selectRunModel({ primary: "a/x", fallbackModels: [], excluded: [], cooldowns: new Map(), now })).toBeNull();
    expect(selectRunModel({ primary: "a/x", fallbackModels: undefined, excluded: [], cooldowns: new Map(), now })).toBeNull();
  });

  it("uses a task override as the primary with the agent chain after it, minus duplicates", () => {
    const { config } = buildIssueRunAdapterConfig(
      { model: "a/agent", fallbackModels: ["b/one", "c/override", "d/two"] },
      { adapterConfig: { model: "c/override" } },
    );
    const selection = selectRunModel({
      primary: String(config.model),
      fallbackModels: config.fallbackModels,
      excluded: [],
      cooldowns: new Map(),
      now,
    });
    expect(selection).toMatchObject({ primary: "c/override", start: "c/override", chain: ["c/override", "b/one", "d/two"], reason: null });
    expect(selection?.overlayChain).toEqual(["b/one", "d/two"]);
  });

  it("starts on the first non-cooling candidate and keeps cooling ones last for OMP", () => {
    const selection = selectRunModel({
      primary: "a/x",
      fallbackModels: ["b/y", "c/z"],
      excluded: [],
      cooldowns: cooling([["a/x", "2026-10-11T10:05:00.000Z"], ["b/y", "2026-10-11T10:03:00.000Z"]]),
      now,
    });
    expect(selection).toMatchObject({ start: "c/z", overlayChain: ["a/x", "b/y"], reason: "rate_limit" });
    const partlyFree = selectRunModel({
      primary: "a/x",
      fallbackModels: ["b/y", "c/z"],
      excluded: [],
      cooldowns: cooling([["a/x", "2026-10-11T10:05:00.000Z"]]),
      now,
    });
    expect(partlyFree).toMatchObject({ start: "b/y", overlayChain: ["c/z", "a/x"] });
  });

  it("returns to the primary once its cooldown has expired", () => {
    const selection = selectRunModel({
      primary: "a/x",
      fallbackModels: ["b/y"],
      excluded: [],
      cooldowns: cooling([["a/x", "2026-10-11T09:59:00.000Z"]]),
      now,
    });
    expect(selection).toMatchObject({ start: "a/x", reason: null });
  });

  it("skips refused selectors and reports refusal when the primary was refused", () => {
    const selection = selectRunModel({ primary: "a/x", fallbackModels: ["b/y"], excluded: ["a/x"], cooldowns: new Map(), now });
    expect(selection).toMatchObject({ start: "b/y", overlayChain: [], reason: "refusal" });
  });

  it("picks the earliest-expiring candidate when all are cooling", () => {
    const cooldowns = cooling([["a/x", "2026-10-11T10:30:00.000Z"], ["b/y", "2026-10-11T10:10:00.000Z"]]);
    expect(selectRunModel({ primary: "a/x", fallbackModels: ["b/y"], excluded: [], cooldowns, now })?.start).toBe("b/y");
    expect(nextModelFallbackCandidate({ chain: ["a/x", "b/y"], excluded: [], cooldowns, now })).toEqual({
      selector: "b/y",
      cooling: true,
      availableAt: new Date("2026-10-11T10:10:00.000Z"),
    });
    expect(nextModelFallbackCandidate({ chain: ["a/x", "b/y"], excluded: ["a/x", "b/y"], cooldowns, now })).toBeNull();
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
