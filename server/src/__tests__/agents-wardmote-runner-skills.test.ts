import { describe, expect, it } from "vitest";
import {
  normalizeWardmoteOperationalSkillPreference,
  normalizeWardmoteRunnerAdapterConfig,
  WARDMOTE_OPERATIONAL_SKILL_KEY,
  resolveLegacyWardmoteDesiredSkillNames,
} from "@tickernelz/wardmote-adapter-utils/server-utils";

const legacyConfig = {
  wardmoteSkillSync: {
    desiredSkills: [WARDMOTE_OPERATIONAL_SKILL_KEY],
  },
};

describe("wardmote_runner operational skill normalization", () => {
  it("applies full-auto native runner defaults at persistence boundaries", () => {
    expect(normalizeWardmoteRunnerAdapterConfig("wardmote_runner", {})).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      codexPermissionMode: "never",
      lifecycleMode: "per_turn",
    });
  });

  it("repairs an existing blank model without replacing an explicit model", () => {
    expect(normalizeWardmoteRunnerAdapterConfig("wardmote_runner", { model: "" }))
      .toMatchObject({ model: "gpt-5.6-sol" });
    expect(normalizeWardmoteRunnerAdapterConfig("wardmote_runner", { model: "gpt-5.5" }))
      .toMatchObject({ model: "gpt-5.5" });
  });

  it("does not replace a non-Codex provider model with the Codex default", () => {
    expect(normalizeWardmoteRunnerAdapterConfig("wardmote_runner", {
      provider: "claude_managed",
      model: "claude-sonnet-5",
    })).toMatchObject({
      provider: "claude_managed",
      model: "claude-sonnet-5",
    });
  });

  it("removes the legacy operational skill while preserving optional skills", () => {
    const normalized = normalizeWardmoteOperationalSkillPreference("wardmote_runner", {
      wardmoteSkillSync: {
        desiredSkills: [WARDMOTE_OPERATIONAL_SKILL_KEY, "company-1/reviewer"],
      },
    });

    expect(normalized).toEqual({
      wardmoteSkillSync: { desiredSkills: ["company-1/reviewer"] },
    });
  });

  it("restores the required operational skill through the legacy resolver after switching back", () => {
    const normalized = normalizeWardmoteOperationalSkillPreference("wardmote_runner", legacyConfig);
    expect(resolveLegacyWardmoteDesiredSkillNames(normalized, [{
      key: WARDMOTE_OPERATIONAL_SKILL_KEY,
      runtimeName: "wardmote",
    }])).toEqual([WARDMOTE_OPERATIONAL_SKILL_KEY]);
  });

  it("does not change direct adapter preferences", () => {
    expect(normalizeWardmoteOperationalSkillPreference("codex_local", legacyConfig)).toBe(legacyConfig);
  });
});
