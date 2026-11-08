import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: mockLoggerWarn },
}));

import {
  FEATURE_PRESETS,
  INSTANCE_FEATURE_KEYS,
  INSTANCE_FEATURE_PLACEMENT,
  type InstanceExperimentalSettings,
} from "@tickernelz/wardmote-shared";
import {
  applyExperimentalSettingsPatch,
  normalizeExperimentalSettings,
  resolveWorktreeRunExecutionActivationState,
  WORKTREE_RUN_EXECUTION_READ_ERROR_KIND,
} from "../services/instance-settings.js";

describe("instance settings service", () => {
  beforeEach(() => {
    mockLoggerWarn.mockReset();
  });

  it("keeps OpenAI Dot opt-in and turns Assistant connections on with it", () => {
    expect(normalizeExperimentalSettings({}).enableOpenAiDot).toBe(false);
    const enabled = applyExperimentalSettingsPatch({}, { enableOpenAiDot: true });
    expect(normalizeExperimentalSettings(JSON.parse(JSON.stringify(enabled)))).toMatchObject({
      enableOpenAiDot: true, enablePublicMcp: true,
    });
    expect(applyExperimentalSettingsPatch(enabled, { enableOpenAiDot: false })).toMatchObject({
      enableOpenAiDot: false, enablePublicMcp: true,
    });
  });

  it("keeps chat connectors opt-in across legacy storage and patches without disabling Apps", () => {
    for (const stored of [undefined, {}, { enableApps: true }, { enableConferenceRoomChat: true }]) {
      expect(normalizeExperimentalSettings(stored).enableChatConnectors).toBe(false);
    }
    const enabled = applyExperimentalSettingsPatch({}, { enableChatConnectors: true });
    expect(normalizeExperimentalSettings(JSON.parse(JSON.stringify(enabled))).enableChatConnectors).toBe(true);
    const disabled = applyExperimentalSettingsPatch(enabled, { enableChatConnectors: false });
    expect(disabled).toMatchObject({ enableApps: true, enableChatConnectors: false });
  });
  it("keeps GitHub review bots independent across legacy normalization and persistence", () => {
    expect(normalizeExperimentalSettings({ enableChatConnectors: true })).toMatchObject({ enableChatConnectors: true, enableGitHubReviewBots: false });
    const saved = applyExperimentalSettingsPatch({}, { enableGitHubReviewBots: true });
    expect(normalizeExperimentalSettings(JSON.parse(JSON.stringify(saved)))).toMatchObject({ enableChatConnectors: false, enableGitHubReviewBots: true });
  });
  it("ignores retired experimental flags without resetting current settings", () => {
    expect(normalizeExperimentalSettings({
      enableEnvironments: true,
      enableNativeRunner: false,
      enableAiConnectionRouters: false,
      enableManagedSandboxOnly: false,
      enableIsolatedWorkspaces: true,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: true,
      enableBuiltInAgents: true,
      enableGoalsSidebarLink: true,
      enableServerInfoDebugView: true,
      enablePaperclipDeveloperMode: true,
      autoRestartDevServerWhenIdle: true,
      enableWorkspaceBranchReconcileForward: true,
      enableWorkspaceDirtyQuarantineRepair: false,
      enableNewestFirstIssueThread: true,
    })).toEqual({
      enableEnvironments: true,
      enableNativeRunner: false,
      enableAiConnectionRouters: false,
      enableManagedSandboxOnly: false,
      enableIsolatedWorkspaces: true,
      enableIsolatedWorkspacesByDefault: false,
      enableStreamlinedLeftNavigation: true,
      enableStreamlinedUi: true,
      enableApps: true,
    enableMcpAggregators: true,
      enableAgentChat: false,
      enablePublicMcp: false,
      enableOpenAiDot: false,
      enableCombinedInboxTasks: false,
      enableChatConnectors: false,
      enableGitHubReviewBots: false,
      enableMemoryConnectors: false,
      enableConferenceRoomChat: false,
      enableClassicTaskInterface: false,
      enableExternalObjects: false,
      enableSmokeLab: false,
      enablePipelines: false,
      enableCases: false,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: true,
      enableBuiltInAgents: true,
      enableBetaSkills: false,
      enableSummaries: false,
      enableStatusCards: false,
      enableDecisions: false,
      enableFastResponses: false,
      enableGoalsSidebarLink: true,
      enableServerInfoDebugView: true,
      enablePaperclipDeveloperMode: true,
      enableSimplifiedEnglishInteractions: false,
      enableFirstTaskPlanProposal: false,
      enablePixelsOffice: false,
      autoRestartDevServerWhenIdle: true,
      enableWorkspaceBranchReconcileForward: true,
      enableWorkspaceDirtyQuarantineRepair: false,
      enableOwnerInstanceAdmin: false,
      enableSandboxDuplexBridge: false,
      enableRunnerPreviewIngress: false,
      enableWorktreeRunExecution: false,
      worktreeRunExecutionActivatedAt: null,
      worktreeRunExecutionActivationInstanceId: null,
    });
  });

  it("reads the five permanent keys as on, whatever is stored", () => {
    const permanent = [
      "enableApps",
      "enableExperimentalFileViewer",
      "enableMcpAggregators",
      "enableStreamlinedLeftNavigation",
      "enableStreamlinedUi",
    ] as const;
    const storedOff = Object.fromEntries(permanent.map((key) => [key, false]));
    for (const stored of [undefined, {}, storedOff]) {
      const normalized = normalizeExperimentalSettings(stored);
      for (const key of permanent) expect(normalized[key]).toBe(true);
    }
    const patched = applyExperimentalSettingsPatch({}, storedOff);
    for (const key of permanent) expect(patched[key]).toBe(true);
  });

  it("turns on a feature's requirements when a patch turns the feature on", () => {
    const patched = applyExperimentalSettingsPatch({ enableCases: false, enableSummaries: false }, { enablePipelines: true, enableStatusCards: true });
    expect(patched).toMatchObject({ enablePipelines: true, enableCases: true, enableStatusCards: true, enableSummaries: true });
    const conflicting = applyExperimentalSettingsPatch({}, { enablePipelines: true, enableCases: false });
    expect(conflicting).toMatchObject({ enablePipelines: false, enableCases: false });
  });

  it("accepts the three removed keys and reads them as off", () => {
    const removed = ["enableAiConnectionRouters", "enableClassicTaskInterface", "enableRunnerPreviewIngress"] as const;
    const storedOn = Object.fromEntries(removed.map((key) => [key, true]));
    const normalized = normalizeExperimentalSettings(storedOn);
    const patched = applyExperimentalSettingsPatch({}, storedOn);
    for (const key of removed) {
      expect(normalized[key]).toBe(false);
      expect(patched[key]).toBe(false);
    }
  });

  it("migrates the production instance without turning any switch off", () => {
    const zhafronInstance: Record<string, boolean | null> = {
      enableEnvironments: false, enableNativeRunner: true, enableAiConnectionRouters: false,
      enableManagedSandboxOnly: false, enableIsolatedWorkspaces: false, enableIsolatedWorkspacesByDefault: false,
      enableStreamlinedLeftNavigation: true, enableStreamlinedUi: true, enableApps: true,
      enableMcpAggregators: true, enablePublicMcp: false, enableOpenAiDot: false,
      enableChatConnectors: true, enableGitHubReviewBots: false, enableMemoryConnectors: false,
      enablePipelines: false, enableCases: true, enableAgentChat: true,
      enableCombinedInboxTasks: false, enableConferenceRoomChat: false, enableClassicTaskInterface: false,
      enableIssuePlanDecompositions: false, enableExperimentalFileViewer: true, enableExternalObjects: true,
      enableSmokeLab: false, enableBuiltInAgents: false, enableBetaSkills: false,
      enableSummaries: true, enableStatusCards: true, enableDecisions: true,
      enableFastResponses: false, enableGoalsSidebarLink: false, enableServerInfoDebugView: false,
      enablePaperclipDeveloperMode: true, enableSimplifiedEnglishInteractions: false, enableFirstTaskPlanProposal: false,
      enablePixelsOffice: true, autoRestartDevServerWhenIdle: false, enableWorkspaceBranchReconcileForward: true,
      enableWorkspaceDirtyQuarantineRepair: true, enableOwnerInstanceAdmin: false, enableSandboxDuplexBridge: false,
      enableRunnerPreviewIngress: false, enableWorktreeRunExecution: false,
      worktreeRunExecutionActivatedAt: null, worktreeRunExecutionActivationInstanceId: null,
    };
    const flags = INSTANCE_FEATURE_KEYS;
    const on = flags.filter((key) => zhafronInstance[key] === true);
    expect(on).toHaveLength(17);
    expect(flags.length - on.length).toBe(27);

    const migrated = normalizeExperimentalSettings(zhafronInstance);
    const byDestination = (destination: string) =>
      on.filter((key) => INSTANCE_FEATURE_PLACEMENT[key].destination === destination);
    expect(byDestination("features")).toHaveLength(8);
    expect(byDestination("advanced")).toHaveLength(4);
    expect(byDestination("permanent")).toHaveLength(5);
    for (const key of on) expect(migrated[key]).toBe(true);
    for (const key of flags) expect(migrated[key]).toBe(zhafronInstance[key]);
    expect(byDestination("features").sort()).toEqual([...FEATURE_PRESETS.standard].sort());
  });

  it("turns dependents off when a patch turns their requirement off", () => {
    const current = applyExperimentalSettingsPatch({}, { enableCases: true, enablePipelines: true });
    expect(applyExperimentalSettingsPatch(current, { enableCases: false })).toMatchObject({
      enableCases: false,
      enablePipelines: false,
    });
  });

  it("defaults enableConferenceRoomChat to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableConferenceRoomChat).toBe(false);
    expect(normalizeExperimentalSettings({}).enableConferenceRoomChat).toBe(false);
    // Rows persisted before the flag existed (PAP-137) must normalize to off.
    expect(
      normalizeExperimentalSettings({ enableStreamlinedLeftNavigation: true }).enableConferenceRoomChat,
    ).toBe(false);
  });

  it("defaults enableSimplifiedEnglishInteractions to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableSimplifiedEnglishInteractions).toBe(false);
    expect(normalizeExperimentalSettings({}).enableSimplifiedEnglishInteractions).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableStreamlinedLeftNavigation: true })
        .enableSimplifiedEnglishInteractions,
    ).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableSimplifiedEnglishInteractions: true })
        .enableSimplifiedEnglishInteractions,
    ).toBe(true);
  });

  it("defaults enableSmokeLab to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableSmokeLab).toBe(false);
    expect(normalizeExperimentalSettings({}).enableSmokeLab).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableExternalObjects: true }).enableSmokeLab,
    ).toBe(false);
  });

  it("defaults enableServerInfoDebugView to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableServerInfoDebugView).toBe(false);
    expect(normalizeExperimentalSettings({}).enableServerInfoDebugView).toBe(false);
    expect(
      normalizeExperimentalSettings({ autoRestartDevServerWhenIdle: true }).enableServerInfoDebugView,
    ).toBe(false);
  });

  it("defaults enablePaperclipDeveloperMode to false for empty and legacy settings", () => {
    expect(normalizeExperimentalSettings(undefined).enablePaperclipDeveloperMode).toBe(false);
    expect(normalizeExperimentalSettings({}).enablePaperclipDeveloperMode).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableServerInfoDebugView: true })
        .enablePaperclipDeveloperMode,
    ).toBe(false);
  });

  it("defaults enableGoalsSidebarLink to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableGoalsSidebarLink).toBe(false);
    expect(normalizeExperimentalSettings({}).enableGoalsSidebarLink).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableStreamlinedLeftNavigation: true }).enableGoalsSidebarLink,
    ).toBe(false);
  });

  it("defaults enableDecisions to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableDecisions).toBe(false);
    expect(normalizeExperimentalSettings({}).enableDecisions).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableStreamlinedLeftNavigation: true }).enableDecisions,
    ).toBe(false);
  });

  it("defaults workspace branch repair settings to true for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableWorkspaceBranchReconcileForward).toBe(true);
    expect(normalizeExperimentalSettings({}).enableWorkspaceBranchReconcileForward).toBe(true);
    expect(
      normalizeExperimentalSettings({ enableExperimentalFileViewer: true })
        .enableWorkspaceBranchReconcileForward,
    ).toBe(true);
    expect(normalizeExperimentalSettings(undefined).enableWorkspaceDirtyQuarantineRepair).toBe(true);
    expect(normalizeExperimentalSettings({}).enableWorkspaceDirtyQuarantineRepair).toBe(true);
    expect(
      normalizeExperimentalSettings({ enableWorkspaceBranchReconcileForward: false })
        .enableWorkspaceDirtyQuarantineRepair,
    ).toBe(true);
  });

  it("round-trips an enableConferenceRoomChat patch through the update merge", () => {
    // updateExperimental merges `{ ...normalize(current), ...patch }` and
    // re-normalizes; emulate that to prove the flag survives the roundtrip
    // without disturbing other settings.
    const current = normalizeExperimentalSettings({});
    const enabled = normalizeExperimentalSettings({ ...current, enableConferenceRoomChat: true });
    expect(enabled.enableConferenceRoomChat).toBe(true);
    expect(enabled.enableStreamlinedLeftNavigation).toBe(true);

    const disabled = normalizeExperimentalSettings({ ...enabled, enableConferenceRoomChat: false });
    expect(disabled).toEqual(current);
  });

  it("rejects non-boolean enableConferenceRoomChat values back to the default", () => {
    expect(
      normalizeExperimentalSettings({ enableConferenceRoomChat: "yes" }).enableConferenceRoomChat,
    ).toBe(false);
  });

  it("defaults enableBuiltInAgents to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableBuiltInAgents).toBe(false);
    expect(normalizeExperimentalSettings({}).enableBuiltInAgents).toBe(false);
    expect(normalizeExperimentalSettings({ enableExternalObjects: true }).enableBuiltInAgents).toBe(false);
  });

  it("preserves enableBetaSkills and defaults it off for legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableBetaSkills).toBe(false);
    expect(normalizeExperimentalSettings({}).enableBetaSkills).toBe(false);
    expect(normalizeExperimentalSettings({ enableBetaSkills: true }).enableBetaSkills).toBe(true);
  });

  it("sets worktree run execution activation fields on a false to true transition", () => {
    const activatedAt = new Date("2026-07-10T12:00:00.000Z");

    const next = applyExperimentalSettingsPatch(
      { enableWorktreeRunExecution: false },
      { enableWorktreeRunExecution: true },
      {
        now: () => activatedAt,
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      },
    );

    expect(next.enableWorktreeRunExecution).toBe(true);
    expect(next.worktreeRunExecutionActivatedAt).toBe("2026-07-10T12:00:00.000Z");
    expect(next.worktreeRunExecutionActivationInstanceId).toBe("worktree-instance");
  });

  it("clears worktree run execution activation fields on a true to false transition", () => {
    const next = applyExperimentalSettingsPatch(
      {
        enableWorktreeRunExecution: true,
        worktreeRunExecutionActivatedAt: "2026-07-10T12:00:00.000Z",
        worktreeRunExecutionActivationInstanceId: "worktree-instance",
      },
      { enableWorktreeRunExecution: false },
      {
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      },
    );

    expect(next.enableWorktreeRunExecution).toBe(false);
    expect(next.worktreeRunExecutionActivatedAt).toBeNull();
    expect(next.worktreeRunExecutionActivationInstanceId).toBeNull();
  });

  it("refreshes the activation cutoff when worktree run execution is re-toggled", () => {
    const firstActivation = applyExperimentalSettingsPatch(
      { enableWorktreeRunExecution: false },
      { enableWorktreeRunExecution: true },
      {
        now: () => new Date("2026-07-10T12:00:00.000Z"),
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      },
    );
    const disabled = applyExperimentalSettingsPatch(
      firstActivation,
      { enableWorktreeRunExecution: false },
      {
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      },
    );

    const secondActivation = applyExperimentalSettingsPatch(
      disabled,
      { enableWorktreeRunExecution: true },
      {
        now: () => new Date("2026-07-10T12:05:00.000Z"),
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      },
    );

    expect(secondActivation.worktreeRunExecutionActivatedAt).toBe("2026-07-10T12:05:00.000Z");
    expect(secondActivation.worktreeRunExecutionActivatedAt).not.toBe(
      firstActivation.worktreeRunExecutionActivatedAt,
    );
  });

  it("strips client-supplied activation fields before applying experimental patches", () => {
    const next = applyExperimentalSettingsPatch(
      { enableWorktreeRunExecution: false },
      {
        enableWorktreeRunExecution: false,
        worktreeRunExecutionActivatedAt: "2026-07-10T12:00:00.000Z",
        worktreeRunExecutionActivationInstanceId: "copied-instance",
      },
      {
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      },
    );

    expect(next.worktreeRunExecutionActivatedAt).toBeNull();
    expect(next.worktreeRunExecutionActivationInstanceId).toBeNull();
  });

  it("resolves worktree run execution as armed only when the cutoff matches the current instance", async () => {
    const experimental = normalizeExperimentalSettings({
      enableWorktreeRunExecution: true,
      worktreeRunExecutionActivatedAt: "2026-07-10T12:00:00.000Z",
      worktreeRunExecutionActivationInstanceId: "worktree-instance",
    });

    await expect(
      resolveWorktreeRunExecutionActivationState({
        getExperimental: async () => experimental,
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      }),
    ).resolves.toEqual({
      armed: true,
      cutoff: "2026-07-10T12:00:00.000Z",
      activationInstanceId: "worktree-instance",
      reason: null,
    });
  });

  it("fails closed when worktree run execution is missing a cutoff", async () => {
    const experimental = normalizeExperimentalSettings({
      enableWorktreeRunExecution: true,
      worktreeRunExecutionActivationInstanceId: "worktree-instance",
    });

    await expect(
      resolveWorktreeRunExecutionActivationState({
        getExperimental: async () => experimental,
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      }),
    ).resolves.toMatchObject({
      armed: false,
      cutoff: null,
      reason: "missing_cutoff",
    });
  });

  it("fails closed when worktree run execution was activated by another instance", async () => {
    const experimental = normalizeExperimentalSettings({
      enableWorktreeRunExecution: true,
      worktreeRunExecutionActivatedAt: "2026-07-10T12:00:00.000Z",
      worktreeRunExecutionActivationInstanceId: "source-instance",
    });

    await expect(
      resolveWorktreeRunExecutionActivationState({
        getExperimental: async () => experimental,
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "target-instance",
        },
      }),
    ).resolves.toMatchObject({
      armed: false,
      cutoff: null,
      activationInstanceId: "source-instance",
      reason: "instance_id_mismatch",
    });
  });

  it("fails closed on settings read errors and avoids reads outside worktree runtimes", async () => {
    await expect(
      resolveWorktreeRunExecutionActivationState({
        getExperimental: async () => {
          throw new Error("settings unavailable");
        },
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "true",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      }),
    ).resolves.toMatchObject({
      armed: false,
      cutoff: null,
      reason: "settings_read_error",
    });

    const getExperimental = vi.fn<() => Promise<InstanceExperimentalSettings>>();
    await expect(
      resolveWorktreeRunExecutionActivationState({
        getExperimental,
        runtimeEnv: {
          PAPERCLIP_IN_WORKTREE: "false",
          PAPERCLIP_INSTANCE_ID: "worktree-instance",
        },
      }),
    ).resolves.toMatchObject({
      armed: false,
      cutoff: null,
      reason: "not_worktree_runtime",
    });
    expect(getExperimental).not.toHaveBeenCalled();
  });

  it("logs a swallowed settings read failure so the suppression is not silent", async () => {
    await resolveWorktreeRunExecutionActivationState({
      getExperimental: async () => {
        throw new Error("settings unavailable");
      },
      runtimeEnv: {
        PAPERCLIP_IN_WORKTREE: "true",
        PAPERCLIP_INSTANCE_ID: "worktree-instance",
      },
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorKind: WORKTREE_RUN_EXECUTION_READ_ERROR_KIND,
        instanceId: "worktree-instance",
      }),
      "worktree run execution setting read failed; this worktree instance keeps run scheduling suppressed, so parked runs are not explained by the flag alone",
    );
  });

  it("logs nothing when the worktree runtime is not armed by a settings read", async () => {
    await resolveWorktreeRunExecutionActivationState({
      getExperimental: async () => normalizeExperimentalSettings({}),
      runtimeEnv: {
        PAPERCLIP_IN_WORKTREE: "false",
        PAPERCLIP_INSTANCE_ID: "worktree-instance",
      },
    });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

});
