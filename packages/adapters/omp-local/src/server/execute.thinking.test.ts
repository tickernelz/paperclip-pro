import { describe, expect, it } from "vitest";
import { buildOmpArgs } from "./execute.js";

describe("buildOmpArgs thinking level", () => {
  const base = { context: {}, systemPrompt: "", userPrompt: "", sessionDir: "/tmp/s", resumeSessionId: null, omitProfile: true, effectiveProfile: null, settingsOverlayPath: null, mcpExtensionPath: null, toolGuardExtensionPath: null, rpc: false };
  const thinkingOf = (config: Record<string, unknown>) => {
    const args = buildOmpArgs({ ...base, config });
    const at = args.indexOf("--thinking");
    return at < 0 ? null : args[at + 1];
  };

  it("runs the main model at the agent's thinking level", () => {
    expect(thinkingOf({ model: "a/x", thinking: "high", modelEfforts: { "b/y": "low" } })).toBe("high");
  });

  it("uses a fallback's own effort when the run starts on that fallback", () => {
    expect(thinkingOf({ model: "b/y", thinking: "high", modelEfforts: { "b/y": "xhigh" } })).toBe("xhigh");
  });

  it("keeps the thinking level for a fallback with no effort of its own", () => {
    expect(thinkingOf({ model: "c/z", thinking: "high", modelEfforts: { "b/y": "xhigh" } })).toBe("high");
  });

  it("omits --thinking when nothing sets a level", () => {
    expect(thinkingOf({ model: "a/x" })).toBeNull();
  });
});
