import { describe, expect, it } from "vitest";
import { buildCodexExecArgs } from "./codex-args.js";

describe("buildCodexExecArgs", () => {
  it.each([null, "existing-session"])("defaults direct and resumed launches to full bypass (%s)", (resumeSessionId) => {
    const { args } = buildCodexExecArgs({}, { resumeSessionId });
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain('sandbox_mode="workspace-write"');
    if (resumeSessionId) expect(args.slice(-3)).toEqual(["resume", resumeSessionId, "-"]);
  });

  it.each([["gpt-6-astra", "ultra"], ["gpt-6-sol", "ultra"], ["gpt-6-luna", "max"], ["gpt-5.6-sol", "ultra"], ["gpt-5.6-terra", "ultra"], ["gpt-5.6-luna", "max"]])("forwards %s, its supported reasoning effort, and fast mode", (model, effort) => {
    const result = buildCodexExecArgs({
      model,
      modelReasoningEffort: effort,
      fastMode: true,
    });

    expect(result.model).toBe(model);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      model,
      "-c",
      `model_reasoning_effort="${effort}"`,
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-",
    ]);
  });

  it("rewrites the legacy bare gpt-5.6 alias to gpt-5.6-sol and applies fast mode", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.6",
      fastMode: true,
    });

    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.args).toContain("gpt-5.6-sol");
    expect(result.args).not.toContain("gpt-5.6");
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
  });

  it("enables Codex fast mode overrides for GPT-5.4", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.4",
      search: true,
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "--search",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.4",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-",
    ]);
  });

  it("enables Codex fast mode overrides for GPT-5.5", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.5",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.5",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-",
    ]);
  });

  it("enables Codex fast mode overrides for manual models", () => {
    const result = buildCodexExecArgs({
      model: "future-codex-model",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "future-codex-model",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-",
    ]);
  });

  it("enables Codex fast mode overrides when model is omitted (CLI default)", () => {
    const result = buildCodexExecArgs({
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-",
    ]);
  });

  it("ignores fast mode for known unsupported models", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(false);
    expect(result.fastModeIgnoredReason).toContain(
      "currently only supported on gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4 or manually configured model IDs",
    );
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5",
      "-",
    ]);
  });

  it("ignores fast mode for gpt-5.4-mini", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.4-mini",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(false);
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.4-mini",
      "-",
    ]);
  });

  it("adds --skip-git-repo-check when requested", () => {
    const result = buildCodexExecArgs(
      {
        model: "gpt-5.5",
      },
      { skipGitRepoCheck: true },
    );

    expect(result.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.5",
      "-",
    ]);
  });

  it("does not add a second --skip-git-repo-check when extraArgs already carry it", () => {
    const result = buildCodexExecArgs(
      {
        model: "gpt-5.5",
        extraArgs: ["--skip-git-repo-check"],
      },
      { skipGitRepoCheck: true },
    );

    expect(result.args.filter((arg) => arg === "--skip-git-repo-check")).toHaveLength(1);
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.5",
      "--skip-git-repo-check",
      "-",
    ]);
  });

  it("does not add a second --skip-git-repo-check when the legacy args field carries it", () => {
    const result = buildCodexExecArgs(
      {
        model: "gpt-5.5",
        args: ["--skip-git-repo-check"],
      },
      { skipGitRepoCheck: true },
    );

    expect(result.args.filter((arg) => arg === "--skip-git-repo-check")).toHaveLength(1);
  });

  it("keeps the operator's --skip-git-repo-check when the sandbox injection is not requested", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.5",
      extraArgs: ["--skip-git-repo-check"],
    });

    expect(result.args.filter((arg) => arg === "--skip-git-repo-check")).toHaveLength(1);
  });
  it.each([null, "existing-session"])("makes legacy settings operable for session %s", (resumeSessionId) => {
    const { args } = buildCodexExecArgs({
      dangerouslyBypassApprovalsAndSandbox: false,
      extraArgs: ["-c", "sandbox_workspace_write.network_access=true"],
    }, { resumeSessionId });
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).toContain("sandbox_workspace_write.network_access=true");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    if (resumeSessionId) expect(args.slice(-3)).toEqual(["resume", resumeSessionId, "-"]);
  });

  it.each([
    ["--sandbox", "read-only"], ["--sandbox=read-only"], ["-s", "read-only"],
    ["-sread-only"], ["-prestricted"], ["-c=sandbox_mode=read-only"],
    ["-c", 'sandbox_mode="read-only"'], ["--config=sandbox_mode=read-only"],
    ["--profile", "restricted"], ["-p", "restricted"], ["--full-auto"],
    ["--dangerously-bypass-approvals-and-sandbox"],
  ])("preserves explicit sandbox/profile arguments %j", (...extraArgs) => {
    const { args } = buildCodexExecArgs({ extraArgs });
    expect(args).not.toContain('sandbox_mode="workspace-write"');
    expect(args).not.toContain("sandbox_workspace_write.network_access=true");
    expect(args).toEqual(["exec", "--json", ...extraArgs, "-"]);
  });

  it("preserves an explicit network denial after defaults", () => {
    const { args } = buildCodexExecArgs({ extraArgs: ["-c", "sandbox_workspace_write.network_access=false"] });
    expect(args.lastIndexOf("sandbox_workspace_write.network_access=false"))
      .toBeGreaterThan(args.indexOf("sandbox_workspace_write.network_access=true"));
  });

  it("honors a disabled execution-target network policy even with an agent override", () => {
    const { args } = buildCodexExecArgs({ extraArgs: ["-c", "sandbox_workspace_write.network_access=true"] }, { networkAccess: false });
    expect(args.slice(-3)).toEqual(["-c", "sandbox_workspace_write.network_access=false", "-"]);
  });

  it("preserves the existing explicit bypass configuration", () => {
    const { args } = buildCodexExecArgs({ dangerouslyBypassApprovalsAndSandbox: true });
    expect(args).toEqual(["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "-"]);
  });

  describe("tool profile", () => {
    const readOnly = ["--sandbox", "read-only", "-c", 'approval_policy="never"'];
    const cases: Array<[Record<string, unknown>, Parameters<typeof buildCodexExecArgs>[1]]> = [
      [{}, {}],
      [{ extraArgs: ["--sandbox", "workspace-write"] }, {}],
      [{ dangerouslyBypassApprovalsAndSandbox: false }, { networkAccess: false }],
      [{ model: "gpt-5.6", search: true }, { resumeSessionId: "s1", skipGitRepoCheck: true }],
    ];

    it.each(cases)("leaves full-profile args unchanged (%j, %j)", (config, options) => {
      expect(buildCodexExecArgs(config, { ...options, toolProfile: "full" }).args).toEqual(
        buildCodexExecArgs(config, options).args,
      );
    });

    it("pins the default full-profile launch to the bypass flag", () => {
      expect(buildCodexExecArgs({}, { toolProfile: "full" }).args).toEqual([
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-",
      ]);
    });

    it("runs a read_only run in the read-only sandbox without approval pauses", () => {
      expect(buildCodexExecArgs({}, { toolProfile: "read_only" }).args).toEqual(["exec", "--json", ...readOnly, "-"]);
    });

    it("keeps resume, model and search flags in a read_only run", () => {
      expect(
        buildCodexExecArgs(
          { model: "gpt-5.6", search: true },
          { resumeSessionId: "s1", skipGitRepoCheck: true, toolProfile: "read_only" },
        ).args,
      ).toEqual([
        "--search",
        "exec",
        "--json",
        ...readOnly,
        "--skip-git-repo-check",
        "--model",
        "gpt-5.6-sol",
        "resume",
        "s1",
        "-",
      ]);
    });

    it("ignores the configured bypass in a read_only run", () => {
      for (const config of [{ dangerouslyBypassApprovalsAndSandbox: true }, { dangerouslyBypassSandbox: true }]) {
        const { args } = buildCodexExecArgs(config, { toolProfile: "read_only" });
        expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
        expect(args).toEqual(["exec", "--json", ...readOnly, "-"]);
      }
    });

    it("drops operator sandbox and approval overrides that would widen a read_only run", () => {
      const { args } = buildCodexExecArgs(
        {
          extraArgs: [
            "--sandbox",
            "danger-full-access",
            "-s",
            "workspace-write",
            "--sandbox=danger-full-access",
            "-sdanger-full-access",
            "--full-auto",
            "--yolo",
            "--dangerously-bypass-approvals-and-sandbox",
            "-c",
            'sandbox_mode="danger-full-access"',
            "--config",
            "approval_policy=on-request",
            '-c=sandbox_mode="workspace-write"',
            '--config=approval_policy="untrusted"',
            "-c",
            "model_verbosity=low",
            "--profile",
            "work",
          ],
        },
        { toolProfile: "read_only" },
      );
      expect(args).toEqual(["exec", "--json", ...readOnly, "-c", "model_verbosity=low", "--profile", "work", "-"]);
    });

    it("does not re-add the workspace network flag in a read_only run without network", () => {
      expect(buildCodexExecArgs({}, { networkAccess: false, toolProfile: "read_only" }).args).toEqual([
        "exec",
        "--json",
        ...readOnly,
        "-",
      ]);
    });
  });

});
