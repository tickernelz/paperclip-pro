import { describe, expect, it } from "vitest";
import { buildOmpArgs } from "./execute.js";

describe("buildOmpArgs per-model thinking", () => {
  const base = { context: {}, systemPrompt: "", userPrompt: "", sessionDir: "/tmp/s", resumeSessionId: null, omitProfile: true, effectiveProfile: null, settingsOverlayPath: null, mcpExtensionPath: null, toolGuardExtensionPath: null, rpc: false };

  it("keeps the agent-wide level when no per-model override matches", () => {
    const args = buildOmpArgs({ ...base, config: { thinking: "high", modelEfforts: { "other/model": "low" } } });
    const at = args.indexOf("--thinking");
    expect(args[at + 1]).toBe("high");
  });

  it("uses the active model's own effort over the agent-wide level", () => {
    const args = buildOmpArgs({ ...base, config: { model: "a/x", thinking: "high", modelEfforts: { "a/x": "low", "b/y": "xhigh" } } });
    const at = args.indexOf("--thinking");
    expect(args[at + 1]).toBe("low");
  });

  it("does not inherit another model's override", () => {
    const args = buildOmpArgs({ ...base, config: { model: "a/x", thinking: "high", modelEfforts: { "b/y": "xhigh" } } });
    const at = args.indexOf("--thinking");
    expect(args[at + 1]).toBe("high");
  });

  it("passes a bare model with no thinking entry untouched", () => {
    const args = buildOmpArgs({ ...base, config: { model: "a/x" } });
    expect(args).not.toContain("--thinking");
  });
});