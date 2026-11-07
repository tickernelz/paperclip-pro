import { describe, expect, it } from "vitest";
import {
  applyAgentSettingsPatch,
  ompChoicePatch,
  type OmpChoiceModel,
  type OmpControlId,
} from "@tickernelz/paperclip-pro-shared";
import { buildOmpArgs } from "./execute.js";
import { buildOmpSettingsOverlay } from "./settings-overlay.js";

const models: OmpChoiceModel[] = [
  { id: "anthropic/opus", provider: "anthropic", thinking: ["low", "high", "xhigh"], cost: { output: 75 } },
  { id: "anthropic/haiku", provider: "anthropic", cost: { output: 5 } },
  { id: "openai/gpt-big", provider: "openai", thinking: ["low", "high", "max"], cost: { output: 60 } },
];
const base = { context: {}, systemPrompt: "", userPrompt: "go", sessionDir: "/tmp/s", resumeSessionId: null, omitProfile: true, effectiveProfile: null, mcpExtensionPath: null, toolGuardExtensionPath: null, rpc: false };

function choose(steps: Array<[OmpControlId, string]>): Record<string, unknown> {
  return steps.reduce<Record<string, unknown>>((config, [control, value]) => applyAgentSettingsPatch(config, ompChoicePatch(control, value, { config, models })), {});
}

function flag(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  return at < 0 ? null : args[at + 1] ?? null;
}

function get(tree: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);
}

function effective(config: Record<string, unknown>) {
  const args = buildOmpArgs({ ...base, config, settingsOverlayPath: "/run/overlay.yml" });
  const overlay = buildOmpSettingsOverlay(config);
  return { args, overlay, setting: (key: string) => get(overlay, key) };
}

describe("named choices reach the OMP run", () => {
  it("Fast style runs with low thinking, prewalk on, advisor off and 3 retries", () => {
    const run = effective(choose([["model", "anthropic/opus"], ["style", "fast"]]));
    expect(flag(run.args, "--thinking")).toBe("low");
    expect(run.args).toContain("--prewalk");
    expect(run.args).not.toContain("--advisor");
    expect(run.setting("advisor.enabled")).toBe(false);
    expect(run.setting("prewalk.enabled")).toBe(true);
    expect(run.setting("retry.maxRetries")).toBe(3);
    expect(run.setting("defaultThinkingLevel")).toBe("low");
  });

  it("Thorough style runs with xhigh thinking, the advisor and 5 retries", () => {
    const run = effective(choose([["style", "thorough"]]));
    expect(flag(run.args, "--thinking")).toBe("xhigh");
    expect(run.args).toContain("--advisor");
    expect(run.setting("advisor.enabled")).toBe(true);
    expect(run.setting("prewalk.enabled")).toBe(false);
    expect(run.setting("retry.maxRetries")).toBe(5);
  });

  it("one model pick sets --model, --smol, --slow and --plan", () => {
    const run = effective(choose([["model", "anthropic/opus"]]));
    expect([flag(run.args, "--model"), flag(run.args, "--smol"), flag(run.args, "--slow"), flag(run.args, "--plan")]).toEqual([
      "anthropic/opus", "anthropic/haiku", "anthropic/opus", "anthropic/opus",
    ]);
  });

  it("automatic backups become the run's fallback chain with each model's own effort", () => {
    const run = effective(choose([["model", "anthropic/opus"], ["thinking", "max"], ["backup", "automatic"]]));
    expect(run.setting("retry.fallbackChains")).toEqual({ "anthropic/opus": ["openai/gpt-big:max"] });
    expect(run.setting("retry.fallbackOn")).toBe("any");
    expect(flag(run.args, "--thinking")).toBe("xhigh");
  });

  it("Read only disables the shell and denies edits even in yolo approval mode", () => {
    const run = effective(choose([["tools", "readOnly"]]));
    expect(flag(run.args, "--approval-mode")).toBe("yolo");
    expect(run.setting("bash.enabled")).toBe(false);
    expect(run.setting("browser.enabled")).toBe(false);
    expect(run.setting("tools.approval")).toEqual({ edit: "deny", write: "deny", ast_edit: "deny", eval: "deny" });
    expect(run.setting("lsp.enabled")).toBe(true);
  });

  it("Everything turns the browser on; Standard leaves OMP's defaults untouched", () => {
    expect(effective(choose([["tools", "everything"]])).setting("browser.enabled")).toBe(true);
    const standard = effective(choose([["tools", "everything"], ["tools", "standard"]]));
    expect(standard.setting("browser.enabled")).toBeUndefined();
    expect(standard.setting("bash.enabled")).toBeUndefined();
    expect(flag(standard.args, "--tools")).toBeNull();
  });

  it("stop after 1 hour sets --max-time and leaves a grace minute on the process timeout", () => {
    const config = choose([["limit", "h1"]]);
    expect(flag(effective(config).args, "--max-time")).toBe("3600");
    expect(config.timeoutSec).toBe(3660);
  });
});

describe("agent OMP settings in the overlay", () => {
  it("adds nothing when an agent pins no OMP settings", () => {
    expect(buildOmpSettingsOverlay({ ompSettings: {} })).toEqual(buildOmpSettingsOverlay({}));
  });

  it("merges pinned settings into the overlay without dropping the adapter's own keys", () => {
    const overlay = buildOmpSettingsOverlay({ model: "a/x", fallbackModels: ["b/y"], ompSettings: { "retry.maxRetries": 4, "compaction.thresholdPercent": 70 } });
    expect(get(overlay, "retry.maxRetries")).toBe(4);
    expect(get(overlay, "retry.fallbackChains")).toEqual({ "a/x": ["b/y"] });
    expect(get(overlay, "compaction.thresholdPercent")).toBe(70);
    expect(get(overlay, "compaction.experimentalContextManagement")).toBe(true);
  });

  it("ignores credentials, adapter-owned keys and the subagent gate", () => {
    const overlay = buildOmpSettingsOverlay({
      advisor: true,
      ompSettings: { "auth.broker.token": "x", "secrets.enabled": true, "advisor.enabled": false, "task.maxRecursionDepth": 3, "providers.foo.apiKey": "k", "bad key": 1 },
    });
    expect(get(overlay, "auth")).toBeUndefined();
    expect(get(overlay, "secrets")).toBeUndefined();
    expect(get(overlay, "advisor.enabled")).toBe(true);
    expect(get(overlay, "task.maxRecursionDepth")).toBe(0);
    expect(get(overlay, "providers")).toBeUndefined();
  });

  it("keeps the overlay below every configured config file, so overlay precedence is unchanged", () => {
    const args = buildOmpArgs({ ...base, config: { configFiles: ["/a.yml", "/b.yml"], ompSettings: { "retry.maxRetries": 4 } }, settingsOverlayPath: "/run/overlay.yml" });
    const configs = args.flatMap((arg, index) => (arg === "--config" ? [args[index + 1]] : []));
    expect(configs).toEqual(["/run/overlay.yml", "/a.yml", "/b.yml"]);
  });
});
