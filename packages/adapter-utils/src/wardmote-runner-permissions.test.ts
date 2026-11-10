import { resolveWardmoteRunnerPiThinkingLevel } from "./wardmote-runner-permissions.js";
import { describe, expect, it } from "vitest";

import {
  WARDMOTE_RUNNER_DEFAULT_MODELS,
  WARDMOTE_RUNNER_ACPX_PROFILES,
  wardmoteRunnerTransitionConfig,
  isWardmoteRunnerProvider,
  resolveWardmoteRunnerModel,
  resolveWardmoteRunnerPermissionMode,
  resolveWardmoteRunnerCursorMode,
} from "./wardmote-runner-permissions.js";

describe("Paperclip Runner permission defaults", () => {
  it("admits Pi with provider credentials while keeping Copilot pending", () => {
    expect(WARDMOTE_RUNNER_ACPX_PROFILES.find(profile => profile.value === "pi"))
      .toMatchObject({ qualified: true, credentialEnvironment: expect.arrayContaining(["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) });
    for (const agent of ["copilot"]) {
      expect(WARDMOTE_RUNNER_ACPX_PROFILES.find(profile => profile.value === agent)?.qualified).toBe(false);
    }
  });
  it("defaults Codex to the only qualified non-interactive mode", () => {
    expect(resolveWardmoteRunnerPermissionMode("codex", undefined)).toBe(
      "never",
    );
    expect(resolveWardmoteRunnerPermissionMode("codex", "on-request")).toBe("never");
    expect(resolveWardmoteRunnerPermissionMode("codex", "untrusted")).toBe("never");
  });

  it("defaults Claude and OpenCode to full auto", () => {
    expect(resolveWardmoteRunnerPermissionMode("opencode", undefined)).toBe(
      "allow",
    );
    expect(resolveWardmoteRunnerPermissionMode("acpx", undefined)).toBe(
      "approve-all",
    );
  });

  it.each(["approve-paperclip", "approve-reads", "deny-all", "approve-all"])("preserves explicit Claude %s settings", (mode) => {
    expect(resolveWardmoteRunnerPermissionMode("acpx", mode)).toBe(mode);
  });

  it.each([
    ["claude_local", "acpxPermissionMode", "approve-all"],
    ["codex_local", "codexPermissionMode", "never"],
    ["opencode_local", "opencodePermissionMode", "allow"],
  ])("uses full auto when converting %s to the new runner", (adapter, key, value) => {
    expect(wardmoteRunnerTransitionConfig(adapter, undefined)).toMatchObject({ [key]: value });
  });

  it("recognizes only exact provider identifiers", () => {
    expect(isWardmoteRunnerProvider("codex")).toBe(true);
    expect(isWardmoteRunnerProvider("opencode")).toBe(true);
    expect(isWardmoteRunnerProvider("claude_managed")).toBe(true);
    expect(isWardmoteRunnerProvider("aws_agentcore")).toBe(true);
    expect(isWardmoteRunnerProvider("acpx")).toBe(true);
    expect(isWardmoteRunnerProvider("toString")).toBe(false);
    expect(isWardmoteRunnerProvider("__proto__")).toBe(false);
  });

  it("keeps managed provider permissions under the qualified profile", () => {
    expect(resolveWardmoteRunnerPermissionMode("claude_managed", "never"))
      .toBe("provider-managed");
    expect(resolveWardmoteRunnerPermissionMode("aws_agentcore", "approve-all"))
      .toBe("provider-managed");
  });

  it("uses the Codex default for missing or blank models", () => {
    expect(resolveWardmoteRunnerModel("codex", undefined)).toBe(
      WARDMOTE_RUNNER_DEFAULT_MODELS.codex,
    );
    expect(resolveWardmoteRunnerModel("codex", "   ")).toBe(
      WARDMOTE_RUNNER_DEFAULT_MODELS.codex,
    );
  });

  it("preserves an explicit Codex model", () => {
    expect(resolveWardmoteRunnerModel("codex", "gpt-5.5")).toBe("gpt-5.5");
    expect(resolveWardmoteRunnerModel("codex", "  gpt-5.5  ")).toBe("gpt-5.5");
  });
});


describe("Cursor session mode admission", () => {
  it.each([undefined, "agent", "plan", "ask"])("retains mode %s with an explicit Cursor default", mode => {
    expect(resolveWardmoteRunnerCursorMode("acpx", "cursor", mode)).toBe(mode ?? "agent");
  });
  it.each([null, "", "auto", "PLAN", true, {}, ["plan"]])("rejects invalid mode %j", mode => {
    expect(() => resolveWardmoteRunnerCursorMode("acpx", "cursor", mode)).toThrow("Cursor session mode");
  });
  it.each([["codex", "cursor"], ["acpx", "copilot"], ["acpx", "pi"], ["acpx", "claude"]])("rejects mode on %s/%s", (provider, agent) => {
    expect(resolveWardmoteRunnerCursorMode(provider, agent, undefined)).toBeUndefined();
    expect(() => resolveWardmoteRunnerCursorMode(provider, agent, "plan")).toThrow("only for Cursor");
  });
});

describe("Pi thinking configuration", () => {
  it.each([undefined, "off", "low", "high", "max"] as const)("persists exact level %s with low as the fresh-config default", value => {
    expect(resolveWardmoteRunnerPiThinkingLevel("acpx", "pi", value)).toBe(value ?? "low");
  });
  it.each(["medium", "minimal", "xhigh", "", null, 1])("rejects unsupported alias %s", value => {
    expect(() => resolveWardmoteRunnerPiThinkingLevel("acpx", "pi", value)).toThrow();
  });
  it("rejects foreign provider settings", () => {
    expect(() => resolveWardmoteRunnerPiThinkingLevel("codex", "pi", "low")).toThrow(/only/);
    expect(() => resolveWardmoteRunnerPiThinkingLevel("acpx", "cursor", "low")).toThrow(/only/);
    expect(resolveWardmoteRunnerPiThinkingLevel("codex", undefined, undefined)).toBeUndefined();
  });
});
