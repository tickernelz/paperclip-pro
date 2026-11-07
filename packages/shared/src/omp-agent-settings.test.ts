import { describe, expect, it } from "vitest";
import {
  OMP_CONTROL_PATHS,
  OMP_ESSENTIAL_SETTINGS,
  agentDiffersFromDefaults,
  applyAgentSettingsPatch,
  deriveOmpBackupModels,
  deriveOmpModelRoles,
  nearestThinkingLevel,
  ompChoicePatch,
  ompSettingPath,
  planAgentDefaultsApply,
  readAgentSetting,
  readOmpChoices,
  readOmpSetting,
  resetToDefaultsPatch,
  type OmpChoiceModel,
} from "./omp-agent-settings.js";

const models: OmpChoiceModel[] = [
  { id: "anthropic/opus", provider: "anthropic", thinking: ["low", "medium", "high", "xhigh", "max"], cost: { input: 15, output: 75 } },
  { id: "anthropic/sonnet", provider: "anthropic", thinking: ["low", "medium", "high"], cost: { input: 3, output: 15 } },
  { id: "anthropic/haiku", provider: "anthropic", cost: { input: 1, output: 5 } },
  { id: "openai/gpt-big", provider: "openai", thinking: ["minimal", "low", "high", "max"], cost: { input: 10, output: 60 } },
  { id: "openai/gpt-mini", provider: "openai", cost: { input: 0.5, output: 2 } },
  { id: "gateway/opus", provider: "gateway", thinking: ["high"], cost: { input: 15, output: 75 } },
];

function apply(config: Record<string, unknown>, control: Parameters<typeof ompChoicePatch>[0], value: string) {
  return applyAgentSettingsPatch(config, ompChoicePatch(control, value, { config, models }));
}

describe("six named choices", () => {
  it("covers 22 Essential keys, moves 4 to other tabs and keeps 10 under the Essential filter", () => {
    const byPlacement = (placement: string) => OMP_ESSENTIAL_SETTINGS.filter((row) => row.placement === placement).map((row) => row.key).sort();
    expect(OMP_ESSENTIAL_SETTINGS).toHaveLength(36);
    expect(byPlacement("choice")).toHaveLength(22);
    expect(byPlacement("elsewhere")).toEqual(["env", "instructionsFilePath", "skills", "systemPrompt"]);
    expect(byPlacement("advanced")).toEqual([
      "compaction.experimentalContextManagement",
      "compaction.thresholdPercent",
      "contextFiles.extra",
      "extensions",
      "hooks",
      "mcp.enableProjectConfig",
      "mcp.startupTimeoutMs",
      "omitThinking",
      "profile",
      "task.maxRecursionDepth",
    ]);
  });

  it.each([
    ["balanced", { thinking: "high", advisor: true, prewalk: false, retries: 3 }],
    ["fast", { thinking: "low", advisor: false, prewalk: true, retries: 3 }],
    ["thorough", { thinking: "xhigh", advisor: true, prewalk: false, retries: 5 }],
  ])("style %s sets thinking, advisor, prewalk and retries", (style, want) => {
    const config = apply({}, "style", style);
    expect(config).toMatchObject({ stylePreset: style, thinking: want.thinking, advisor: want.advisor, prewalk: want.prewalk });
    expect(readOmpSetting(config, "retry.maxRetries")).toBe(want.retries);
    expect(readOmpSetting(config, "advisor.enabled")).toBe(want.advisor);
    expect(readOmpSetting(config, "prewalk.enabled")).toBe(want.prewalk);
    expect(readOmpSetting(config, "defaultThinkingLevel")).toBe(want.thinking);
    expect(readOmpChoices(config).style).toBe(style);
  });

  it("model fills small, slow and plan models from the same provider", () => {
    const config = apply({}, "model", "anthropic/sonnet");
    expect(config).toMatchObject({ model: "anthropic/sonnet", smolModel: "anthropic/haiku", slowModel: "anthropic/opus", planModel: "anthropic/opus" });
    expect(deriveOmpModelRoles("unknown/x", models)).toEqual({ smolModel: "unknown/x", slowModel: "unknown/x", planModel: "unknown/x" });
  });

  it.each([
    ["quick", "low"],
    ["balanced", "medium"],
    ["deep", "high"],
    ["max", "xhigh"],
  ])("thinking %s sets %s and derives each backup's own effort", (choice, level) => {
    const base = { model: "anthropic/opus", fallbackModels: ["openai/gpt-big", "gateway/opus"] };
    const config = apply(base, "thinking", choice);
    expect(config.thinking).toBe(level);
    expect(readOmpSetting(config, "defaultThinkingLevel")).toBe(level);
    expect(config.modelEfforts).toEqual({
      "openai/gpt-big": nearestThinkingLevel(level, ["minimal", "low", "high", "max"]),
      "gateway/opus": "high",
    });
    expect(readOmpChoices(config).thinking).toBe(choice);
  });

  it("picks the nearest supported level and breaks ties toward the deeper one", () => {
    expect(nearestThinkingLevel("medium", ["low", "high"])).toBe("high");
    expect(nearestThinkingLevel("xhigh", ["minimal", "low", "high", "max"])).toBe("max");
    expect(nearestThinkingLevel("low", undefined)).toBe("low");
  });

  it("automatic backups prefer the same model elsewhere, then the closest price, one per provider", () => {
    expect(deriveOmpBackupModels("anthropic/opus", models)).toEqual(["gateway/opus", "openai/gpt-big"]);
    const config = apply({ model: "anthropic/opus", thinking: "high" }, "backup", "automatic");
    expect(config.fallbackModels).toEqual(["gateway/opus", "openai/gpt-big"]);
    expect(config.fallbackMode).toBe("automatic");
    expect(readOmpSetting(config, "retry.fallbackOn")).toBe("any");
    expect(config.modelEfforts).toEqual({ "gateway/opus": "high", "openai/gpt-big": "high" });
  });

  it("automatic backups follow a model change; a custom list drops the primary", () => {
    const automatic = apply(apply({ model: "anthropic/opus" }, "backup", "automatic"), "model", "openai/gpt-big");
    expect(automatic.fallbackModels).toEqual(["anthropic/opus", "gateway/opus"]);
    const custom = applyAgentSettingsPatch({ model: "anthropic/opus" }, ompChoicePatch("backup", "custom", { config: { model: "anthropic/opus" }, models }, { customBackups: ["anthropic/opus", "openai/gpt-mini"] }));
    expect(custom.fallbackModels).toEqual(["openai/gpt-mini"]);
    expect(readOmpChoices(custom).backup).toBe("custom");
  });

  it("tools choices set the shell, browser and approval switches and are detected back", () => {
    const readOnly = apply({ tools: "read,bash" }, "tools", "readOnly");
    expect(readOnly.tools).toBeUndefined();
    expect(readOmpSetting(readOnly, "bash.enabled")).toBe(false);
    expect(readOmpSetting(readOnly, "browser.enabled")).toBe(false);
    expect(readOmpSetting(readOnly, "tools.approval")).toEqual({ edit: "deny", write: "deny", ast_edit: "deny", eval: "deny" });
    expect(readOmpChoices(readOnly).tools).toBe("readOnly");
    const everything = apply(readOnly, "tools", "everything");
    for (const key of ["bash.enabled", "browser.enabled", "web_search.enabled", "github.enabled", "ask.enabled"]) expect(readOmpSetting(everything, key)).toBe(true);
    expect(readOmpSetting(everything, "tools.approval")).toBeUndefined();
    expect(readOmpChoices(everything).tools).toBe("everything");
    const standard = apply(everything, "tools", "standard");
    expect(standard.ompSettings).toBeUndefined();
    expect(readOmpChoices(standard).tools).toBe("standard");
    expect(readOmpSetting(standard, "tools.approvalMode")).toBeUndefined();
    expect(readOmpSetting({ noLsp: true }, "lsp.enabled")).toBe(false);
  });

  it.each([
    ["m30", "1800", 1860],
    ["h1", "3600", 3660],
    ["h2", "7200", 7260],
  ])("stop after %s sets maxTime and timeoutSec from one value", (choice, maxTime, timeoutSec) => {
    const config = apply({}, "limit", choice);
    expect(config).toMatchObject({ maxTime, timeoutSec });
    expect(readOmpChoices(config).limit).toBe(choice);
  });

  it("no limit clears maxTime and turns the process timeout off", () => {
    const config = apply({ maxTime: "1800", timeoutSec: 1860 }, "limit", "none");
    expect(config.maxTime).toBeUndefined();
    expect(config.timeoutSec).toBe(0);
    expect(readOmpChoices(config).limit).toBe("none");
  });

  it("every control writes only its declared paths", () => {
    const controls: Array<[Parameters<typeof ompChoicePatch>[0], string]> = [
      ["style", "fast"], ["model", "anthropic/opus"], ["thinking", "deep"], ["backup", "automatic"], ["tools", "readOnly"], ["limit", "h1"],
    ];
    for (const [control, value] of controls) {
      const patch = ompChoicePatch(control, value, { config: { model: "anthropic/opus", fallbackModels: ["openai/gpt-big"] }, models });
      const allowed = new Set([...OMP_CONTROL_PATHS[control], ...(control === "style" ? OMP_CONTROL_PATHS.thinking : []), ...(control === "model" ? OMP_CONTROL_PATHS.backup.concat("modelEfforts") : []), ...(control === "backup" ? ["modelEfforts"] : [])]);
      for (const path of Object.keys(patch)) expect(allowed.has(path), `${control} writes ${path}`).toBe(true);
    }
  });

  it("stores aliased OMP settings under the adapter key the runtime reads", () => {
    expect(ompSettingPath("tools.approvalMode")).toBe("approvalMode");
    expect(ompSettingPath("lsp.enabled")).toBe("noLsp");
    expect(ompSettingPath("retry.maxRetries")).toBe("ompSettings.retry.maxRetries");
    expect(readAgentSetting({ ompSettings: { "retry.maxRetries": 4 } }, "ompSettings.retry.maxRetries")).toBe(4);
  });
});

describe("agent defaults and per-agent overrides", () => {
  const previous = { model: "anthropic/opus", thinking: "high" };
  const agents = [
    { id: "a", name: "Follows", adapterConfig: { model: "anthropic/opus", thinking: "high", cwd: "/a" } },
    { id: "b", name: "Own model", adapterConfig: { model: "openai/gpt-big", thinking: "high" } },
    { id: "c", name: "Unset", adapterConfig: {} },
  ];

  it("an agent's own value beats a changed default; followers take the new value", () => {
    const plan = planAgentDefaultsApply(agents, previous, { model: "anthropic/sonnet", thinking: "high" });
    expect(plan.changedPaths).toEqual(["model"]);
    expect(plan.following).toBe(1);
    expect(plan.ownValues).toBe(2);
    expect(plan.sessionKept).toBe(true);
    const byId = Object.fromEntries(plan.entries.map((entry) => [entry.agentId, entry]));
    expect(byId.a!.adapterConfig).toEqual({ model: "anthropic/sonnet", thinking: "high", cwd: "/a" });
    expect(byId.b!.adapterConfig).toEqual(agents[1]!.adapterConfig);
    expect(byId.c!.adapterConfig).toEqual({});
  });

  it("agents with nothing set follow defaults that were unset before", () => {
    const plan = planAgentDefaultsApply(agents, {}, { "ompSettings.retry.maxRetries": 3 });
    expect(plan.following).toBe(3);
    expect(plan.sessionKept).toBe(false);
    expect(plan.entries.every((entry) => readAgentSetting(entry.adapterConfig, "ompSettings.retry.maxRetries") === 3)).toBe(true);
  });

  it("marks a changed control and resets it to the default", () => {
    const own = agents[1]!.adapterConfig;
    expect(agentDiffersFromDefaults(own, previous, ["model"])).toBe(true);
    const reset = applyAgentSettingsPatch(own, resetToDefaultsPatch(previous, ["model"]));
    expect(agentDiffersFromDefaults(reset, previous, ["model"])).toBe(false);
  });
});
