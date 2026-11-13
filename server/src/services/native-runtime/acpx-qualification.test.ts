import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ACPX_QUALIFICATION_ENV, resolveAcpxQualification } from "./acpx-qualification.js";
import type { NativeExecutionInput } from "../../vendor/wardmote-runner/index.js";
import { resolveWardmoteRunnerProviderProfile, resolveWardmoteRunnerNativeProviderInput } from "./provider-profile.js";

const provider = { kind: "acpx", agent: "copilot", model: "exact-model", permissionMode: "approve-all" } as NativeExecutionInput["provider"];
const authorize = (value: unknown) => ({ [ACPX_QUALIFICATION_ENV]: JSON.stringify(value) });
describe("host ACPX qualification admission", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["copilot"])("admits %s through agent validation and native input only for the exact host pair", (agent) => {
    const config = { provider: "acpx", acpxAgent: agent, model: "exact-model" };
    vi.stubEnv(ACPX_QUALIFICATION_ENV, undefined);
    expect(() => resolveWardmoteRunnerProviderProfile(config)).toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_agent_unavailable" }));
    expect(() => resolveWardmoteRunnerProviderProfile({ ...config, env: authorize([{ agent, model: config.model }]), [ACPX_QUALIFICATION_ENV]: JSON.stringify([{ agent, model: config.model }]) })).toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_agent_unavailable" }));
    vi.stubEnv(ACPX_QUALIFICATION_ENV, JSON.stringify([{ agent, model: config.model }]));
    expect(resolveWardmoteRunnerProviderProfile(config)).toMatchObject({ acpxAgent: agent, model: config.model });
    expect(resolveWardmoteRunnerNativeProviderInput({ backend: "acpx_runtime", adapterConfig: config })).toMatchObject({ acpxAgent: agent, model: config.model });
    expect(() => resolveWardmoteRunnerProviderProfile({ ...config, model: "other-model" })).toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_qualification_invalid" }));
    expect(() => resolveWardmoteRunnerProviderProfile({ ...config, model: "" })).toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_model_required" }));
  });
  it("admits only the exact Pi model without host authorization and preserves permission modes", () => {
    const config = { provider: "acpx", acpxAgent: "pi", model: "openrouter/deepseek/deepseek-v4-flash-0731" };
    for (const authorization of [undefined, "malformed unrelated candidate authorization"]) {
      vi.stubEnv(ACPX_QUALIFICATION_ENV, authorization);
      expect(resolveWardmoteRunnerProviderProfile(config)).toMatchObject(config);
      for (const acpxPermissionMode of [undefined, "approve-all", "approve-wardmote", "approve-reads", "deny-all"]) {
        expect(resolveWardmoteRunnerNativeProviderInput({ backend: "acpx_runtime", adapterConfig: { ...config, acpxPermissionMode } }))
          .toMatchObject({ ...config, acpxPermissionMode: acpxPermissionMode ?? "approve-all" });
      }
      for (const acpxPermissionMode of [["approve", "paperclip"].join("-"), "approve-everything"]) {
        expect(() => resolveWardmoteRunnerProviderProfile({ ...config, acpxPermissionMode }))
          .toThrow(expect.objectContaining({ code: "runner_permission_mode_invalid" }));
      }
      for (const model of [undefined, ""]) {
        expect(() => resolveWardmoteRunnerProviderProfile({ ...config, model }))
          .toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_model_required" }));
      }
    }
  });
  it("keeps normal candidate execution closed and admits only the exact operator pair", () => {
    expect(resolveAcpxQualification(provider, {})).toBeUndefined();
    expect(resolveAcpxQualification(provider, authorize([{ agent: "copilot", model: "exact-model" }]))).toBe("copilot");
    for (const entries of [[{ agent: "pi", model: "exact-model" }], [{ agent: "copilot", model: "other-model" }]]) {
      expect(() => resolveAcpxQualification(provider, authorize(entries))).toThrow("exact model");
    }
  });
  it.each([[], {}, [{ agent: "cursor", model: "" }], [{ agent: "cursor", model: " exact-model" }],
    [{ agent: "cursor", model: "exact-model", allowAll: true }], [{ agent: "claude", model: "exact-model" }],
    [{ agent: "cursor", model: "exact-model" }, { agent: "cursor", model: "exact-model" }],
  ])("rejects malformed or broad authorization %j", entries => {
    expect(() => resolveAcpxQualification(provider, authorize(entries))).toThrow("Invalid ACPX");
  });
  it("admits Cursor through ordinary configuration and ignores unrelated qualification authority", () => {
    const config = { provider: "acpx", acpxAgent: "cursor", model: "exact-cursor-model" };
    vi.stubEnv(ACPX_QUALIFICATION_ENV, JSON.stringify([{ agent: "pi", model: "pi-model" }]));
    expect(resolveWardmoteRunnerProviderProfile(config)).toMatchObject({ acpxAgent: "cursor", model: config.model });
    expect(resolveWardmoteRunnerNativeProviderInput({ backend: "acpx_runtime", adapterConfig: config })).toMatchObject({ acpxAgent: "cursor", model: config.model });
    expect(resolveAcpxQualification({ ...provider, agent: "cursor" } as typeof provider, authorize([]))).toBeUndefined();
    expect(() => resolveWardmoteRunnerProviderProfile({ ...config, model: "" })).toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_model_required" }));
  });
  it("does not alter existing qualified providers", () => {
    expect(resolveAcpxQualification({ ...provider, agent: "codex" } as typeof provider, authorize([]))).toBeUndefined();
  });
  it.each(["claude", "codex", "grok", "cursor", "pi"])("keeps %s model selection open to native verification", (acpxAgent) => {
    const adapterConfig = { provider: "acpx", acpxAgent, model: "explicit-new-model" };
    expect(resolveWardmoteRunnerProviderProfile(adapterConfig))
      .toMatchObject({ acpxAgent, model: "explicit-new-model" });
    expect(resolveWardmoteRunnerNativeProviderInput({ backend: "acpx_runtime", adapterConfig }))
      .toMatchObject({ acpxAgent, model: "explicit-new-model" });
  });
  it("requires an explicit Codex ACP selection", () => {
    for (const model of [undefined, "", " "]) {
      expect(() => resolveWardmoteRunnerProviderProfile({ provider: "acpx", acpxAgent: "codex", model }))
        .toThrow(expect.objectContaining({ code: "wardmote_runner_acpx_model_unqualified" }));
    }
  });
  it("preserves product defaults separately from qualification examples", () => {
    for (const [acpxAgent, model] of [["claude", "claude-sonnet-5"], ["grok", "grok-4.7"]]) {
      expect(resolveWardmoteRunnerProviderProfile({ provider: "acpx", acpxAgent }))
        .toMatchObject({ acpxAgent, model });
    }
  });
  it("binds the executor to host process environment rather than agent configuration", () => {
    const source = readFileSync(new URL("./native-session-executor.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveAcpxQualification(input.execution.provider, process.env)");
    expect(source).not.toContain("resolveAcpxQualification(input.execution.provider, effectiveRunnerEnvironment)");
  });
});

it.each([undefined, "off", "low", "high", "max"] as const)("validates saved Pi thinking %s and projects it explicitly", piThinkingLevel => {
  const adapterConfig = { provider: "acpx", acpxAgent: "pi", model: "openrouter/deepseek/deepseek-v4-flash-0731", piThinkingLevel };
  expect(resolveWardmoteRunnerNativeProviderInput({ backend: "acpx_runtime", adapterConfig })).toMatchObject({ piThinkingLevel: piThinkingLevel ?? "low" });
  for (const alias of ["medium", "minimal", "xhigh"]) expect(() => resolveWardmoteRunnerProviderProfile({ ...adapterConfig, piThinkingLevel: alias })).toThrow(expect.objectContaining({ code: "wardmote_runner_pi_thinking_invalid" }));
});
