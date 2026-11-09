import type { Db } from "@tickernelz/wardmote-db";
import { companies, instanceSettings } from "@tickernelz/wardmote-db";

/**
 * A `Db` or an open transaction handle — the subset of query builders the
 * settings writes use. Lets `update` run inside a caller's transaction so
 * it commits atomically with a sibling write.
 */
type InstanceSettingsTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type InstanceSettingsWriteDb = Pick<
  Db | InstanceSettingsTransaction,
  "select" | "insert" | "update"
>;
import {
  DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_ATTACHMENT_RETENTION,
  DEFAULT_LOCAL_RUN_LIMITS_SETTINGS,
  DEFAULT_MESSAGE_DELIVERY,
  SPEECH_TO_TEXT_DEFAULTS,
  instanceGeneralSettingsSchema,
  type InstanceGeneralSettings,
  instanceExperimentalSettingsSchema,
  type InstanceExperimentalSettings,
  type PatchInstanceGeneralSettings,
  type InstanceSettings,
  type PatchInstanceSettings,
  type PatchInstanceExperimentalSettings,
} from "@tickernelz/wardmote-shared";
import {
  INSTANCE_FEATURE_CATALOG,
  NEW_INSTALL_FEATURE_DEFAULTS,
  PERMANENT_FEATURE_KEYS,
  REMOVED_FEATURE_KEYS,
  withDependentsDisabled,
  withRequirementsEnabled,
  withUnmetRequirementsDisabled,
  applyOperatorGeneralDefaults,
  stripOperatorGeneralEchoes,
} from "@tickernelz/wardmote-shared";
import { and, eq, notExists, sql } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { setAttachmentLimitSetting } from "../attachment-types.js";
import { getOperatorSettingDefaults } from "./setting-defaults.js";

const DEFAULT_SINGLETON_KEY = "default";
const instanceGeneralSettingsStorageSchema = instanceGeneralSettingsSchema.strip();
const instanceExperimentalSettingsStorageSchema = instanceExperimentalSettingsSchema.strip();
const TRUTHY_RUNTIME_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FIXED_FEATURE_KEYS: ReadonlySet<string> = new Set([...PERMANENT_FEATURE_KEYS, ...REMOVED_FEATURE_KEYS]);

interface InstanceSettingsServiceOptions {
  runtimeEnv?: Record<string, string | undefined>;
  now?: () => Date;
}

type WorktreeRunExecutionSuppressedReason =
  | "not_worktree_runtime"
  | "flag_disabled"
  | "missing_cutoff"
  | "missing_instance_id"
  | "instance_id_mismatch"
  | "settings_read_error";

export type WorktreeRunExecutionActivationState =
  | {
      armed: true;
      cutoff: string;
      activationInstanceId: string;
      reason: null;
    }
  | {
      armed: false;
      cutoff: null;
      activationInstanceId: string | null;
      reason: WorktreeRunExecutionSuppressedReason;
    };

export function isTruthyRuntimeEnvValue(value: string | undefined) {
  return typeof value === "string" && TRUTHY_RUNTIME_ENV_VALUES.has(value.trim().toLowerCase());
}

function getRuntimeInstanceId(env: Record<string, string | undefined>) {
  const instanceId = env.WARDMOTE_INSTANCE_ID?.trim();
  return instanceId ? instanceId : null;
}

function stripServerManagedExperimentalPatchFields(
  patch: PatchInstanceExperimentalSettings | Record<string, unknown>,
): PatchInstanceExperimentalSettings {
  const {
    worktreeRunExecutionActivatedAt: _ignoredActivatedAt,
    worktreeRunExecutionActivationInstanceId: _ignoredActivationInstanceId,
    ...patchable
  } = patch as Record<string, unknown>;
  return patchable as PatchInstanceExperimentalSettings;
}

export function applyExperimentalSettingsPatch(
  current: unknown,
  patch: PatchInstanceExperimentalSettings | Record<string, unknown>,
  options: InstanceSettingsServiceOptions = {},
): InstanceExperimentalSettings {
  const previousExperimental = normalizeExperimentalSettings(current);
  const patchable = withDependentsDisabled(
    withRequirementsEnabled(stripServerManagedExperimentalPatchFields(patch)),
  ) as PatchInstanceExperimentalSettings;
  const nextExperimental = normalizeExperimentalSettings({
    ...previousExperimental,
    ...patchable,
  });
  const hasWorktreeRunExecutionPatch = Object.prototype.hasOwnProperty.call(
    patchable,
    "enableWorktreeRunExecution",
  );

  if (!hasWorktreeRunExecutionPatch) {
    return nextExperimental;
  }

  if (nextExperimental.enableWorktreeRunExecution !== true) {
    return {
      ...nextExperimental,
      worktreeRunExecutionActivatedAt: null,
      worktreeRunExecutionActivationInstanceId: null,
    };
  }

  if (previousExperimental.enableWorktreeRunExecution === true) {
    return nextExperimental;
  }

  const runtimeEnv = options.runtimeEnv ?? process.env;
  if (!isTruthyRuntimeEnvValue(runtimeEnv.WARDMOTE_IN_WORKTREE)) {
    return nextExperimental;
  }

  return {
    ...nextExperimental,
    worktreeRunExecutionActivatedAt: (options.now ?? (() => new Date()))().toISOString(),
    worktreeRunExecutionActivationInstanceId: getRuntimeInstanceId(runtimeEnv),
  };
}

function suppressWorktreeRunExecution(
  reason: WorktreeRunExecutionSuppressedReason,
  activationInstanceId: string | null = null,
): WorktreeRunExecutionActivationState {
  return {
    armed: false,
    cutoff: null,
    activationInstanceId,
    reason,
  };
}

export function resolveWorktreeRunExecutionActivation(
  experimental: InstanceExperimentalSettings,
  currentInstanceId: string | null | undefined,
): WorktreeRunExecutionActivationState {
  if (experimental.enableWorktreeRunExecution !== true) {
    return suppressWorktreeRunExecution(
      "flag_disabled",
      experimental.worktreeRunExecutionActivationInstanceId,
    );
  }
  if (!experimental.worktreeRunExecutionActivatedAt) {
    return suppressWorktreeRunExecution(
      "missing_cutoff",
      experimental.worktreeRunExecutionActivationInstanceId,
    );
  }
  if (!currentInstanceId) {
    return suppressWorktreeRunExecution(
      "missing_instance_id",
      experimental.worktreeRunExecutionActivationInstanceId,
    );
  }
  if (experimental.worktreeRunExecutionActivationInstanceId !== currentInstanceId) {
    return suppressWorktreeRunExecution(
      "instance_id_mismatch",
      experimental.worktreeRunExecutionActivationInstanceId,
    );
  }
  return {
    armed: true,
    cutoff: experimental.worktreeRunExecutionActivatedAt,
    activationInstanceId: currentInstanceId,
    reason: null,
  };
}

export const WORKTREE_RUN_EXECUTION_READ_ERROR_KIND = "worktree_run_execution_read_error";

export async function resolveWorktreeRunExecutionActivationState(options: {
  getExperimental: () => Promise<InstanceExperimentalSettings>;
  runtimeEnv?: Record<string, string | undefined>;
}): Promise<WorktreeRunExecutionActivationState> {
  const runtimeEnv = options.runtimeEnv ?? process.env;
  if (!isTruthyRuntimeEnvValue(runtimeEnv.WARDMOTE_IN_WORKTREE)) {
    return suppressWorktreeRunExecution("not_worktree_runtime");
  }
  try {
    return resolveWorktreeRunExecutionActivation(
      await options.getExperimental(),
      getRuntimeInstanceId(runtimeEnv),
    );
  } catch (error) {
    logger.warn(
      {
        errorKind: WORKTREE_RUN_EXECUTION_READ_ERROR_KIND,
        instanceId: getRuntimeInstanceId(runtimeEnv),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "worktree run execution setting read failed; this worktree instance keeps run scheduling suppressed, so parked runs are not explained by the flag alone",
    );
    return suppressWorktreeRunExecution("settings_read_error");
  }
}

function normalizeGeneralSettings(raw: unknown): InstanceGeneralSettings {
  const parsed = instanceGeneralSettingsStorageSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return {
      censorUsernameInLogs: parsed.data.censorUsernameInLogs ?? false,
      feedbackDataSharingPreference:
        parsed.data.feedbackDataSharingPreference ?? DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE,
      backupRetention: parsed.data.backupRetention ?? DEFAULT_BACKUP_RETENTION,
      defaultMessageDelivery: parsed.data.defaultMessageDelivery ?? DEFAULT_MESSAGE_DELIVERY,
      speechToText: parsed.data.speechToText ?? SPEECH_TO_TEXT_DEFAULTS,
      attachmentMaxMegabytes: parsed.data.attachmentMaxMegabytes ?? null,
      attachmentRetention: parsed.data.attachmentRetention ?? DEFAULT_ATTACHMENT_RETENTION,
      localRuns: parsed.data.localRuns ?? DEFAULT_LOCAL_RUN_LIMITS_SETTINGS,
      // Absent => unrestricted; only carry through an explicit policy.
      ...(parsed.data.executionMode ? { executionMode: parsed.data.executionMode } : {}),
    };
  }
  return {
    censorUsernameInLogs: false,
    feedbackDataSharingPreference: DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE,
    backupRetention: DEFAULT_BACKUP_RETENTION,
    defaultMessageDelivery: DEFAULT_MESSAGE_DELIVERY,
    speechToText: SPEECH_TO_TEXT_DEFAULTS,
    attachmentMaxMegabytes: null,
    attachmentRetention: DEFAULT_ATTACHMENT_RETENTION,
    localRuns: DEFAULT_LOCAL_RUN_LIMITS_SETTINGS,
  };
}

export function normalizeExperimentalSettings(raw: unknown): InstanceExperimentalSettings {
  const parsed = instanceExperimentalSettingsStorageSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return {
      enableEnvironments: parsed.data.enableEnvironments ?? false,
      enableNativeRunner: parsed.data.enableNativeRunner ?? true,
      enableAiConnectionRouters: false,
      enableManagedSandboxOnly: parsed.data.enableManagedSandboxOnly ?? false,
      enableIsolatedWorkspaces: parsed.data.enableIsolatedWorkspaces ?? false,
      enableIsolatedWorkspacesByDefault: parsed.data.enableIsolatedWorkspacesByDefault ?? false,
      enableStreamlinedLeftNavigation: true,
      enableStreamlinedUi: true,
      // Apps graduated from Experimental. Ignore historical off values while
      // continuing to accept the compatibility key in stored settings.
      enableApps: true,
      enableMcpAggregators: true,
      enablePublicMcp: parsed.data.enablePublicMcp ?? false,
      enableOpenAiDot: parsed.data.enableOpenAiDot ?? false,
      enableChatConnectors: parsed.data.enableChatConnectors ?? false,
      enableGitHubReviewBots: parsed.data.enableGitHubReviewBots ?? false,
      enableMemoryConnectors: parsed.data.enableMemoryConnectors ?? false,
      enablePipelines: parsed.data.enablePipelines ?? false,
      enableCases: parsed.data.enableCases ?? false,
      enableAgentChat: parsed.data.enableAgentChat ?? false,
      enableCombinedInboxTasks: parsed.data.enableCombinedInboxTasks ?? false,
      enableConferenceRoomChat: parsed.data.enableConferenceRoomChat ?? false,
      enableClassicTaskInterface: false,
      enableIssuePlanDecompositions: parsed.data.enableIssuePlanDecompositions ?? false,
      enableExperimentalFileViewer: true,
      enableExternalObjects: parsed.data.enableExternalObjects ?? false,
      enableSmokeLab: parsed.data.enableSmokeLab ?? false,
      enableBuiltInAgents: parsed.data.enableBuiltInAgents ?? false,
      enableBetaSkills: parsed.data.enableBetaSkills ?? false,
      enableSummaries: parsed.data.enableSummaries ?? false,
      enableStatusCards: parsed.data.enableStatusCards ?? false,
      enableDecisions: parsed.data.enableDecisions ?? false,
      enableFastResponses: parsed.data.enableFastResponses ?? false,
      enableGoalsSidebarLink: parsed.data.enableGoalsSidebarLink ?? false,
      enableServerInfoDebugView: parsed.data.enableServerInfoDebugView ?? false,
      enablePaperclipDeveloperMode: parsed.data.enablePaperclipDeveloperMode ?? false,
      enableSimplifiedEnglishInteractions: parsed.data.enableSimplifiedEnglishInteractions ?? false,
      enableFirstTaskPlanProposal: parsed.data.enableFirstTaskPlanProposal ?? false,
      enablePixelsOffice: parsed.data.enablePixelsOffice ?? false,
      autoRestartDevServerWhenIdle: parsed.data.autoRestartDevServerWhenIdle ?? false,
      enableWorkspaceBranchReconcileForward: parsed.data.enableWorkspaceBranchReconcileForward ?? true,
      enableWorkspaceDirtyQuarantineRepair: parsed.data.enableWorkspaceDirtyQuarantineRepair ?? true,
      enableOwnerInstanceAdmin: parsed.data.enableOwnerInstanceAdmin ?? false,
      enableSandboxDuplexBridge: parsed.data.enableSandboxDuplexBridge ?? false,
      enableRunnerPreviewIngress: false,
      enableWorktreeRunExecution: parsed.data.enableWorktreeRunExecution ?? false,
      worktreeRunExecutionActivatedAt: parsed.data.worktreeRunExecutionActivatedAt ?? null,
      worktreeRunExecutionActivationInstanceId:
        parsed.data.worktreeRunExecutionActivationInstanceId ?? null,
    };
  }
  return {
    enableEnvironments: false,
    enableNativeRunner: true,
    enableAiConnectionRouters: false,
    enableManagedSandboxOnly: false,
    enableIsolatedWorkspaces: false,
    enableIsolatedWorkspacesByDefault: false,
    enableStreamlinedLeftNavigation: true,
    enableStreamlinedUi: true,
    enableApps: true,
    enableMcpAggregators: true,
    enablePublicMcp: false,
    enableOpenAiDot: false,
    enableChatConnectors: false,
    enableGitHubReviewBots: false,
    enableMemoryConnectors: false,
    enablePipelines: false,
    enableCases: false,
    enableAgentChat: false,
    enableCombinedInboxTasks: false,
    enableConferenceRoomChat: false,
    enableClassicTaskInterface: false,
    enableIssuePlanDecompositions: false,
    enableExperimentalFileViewer: true,
    enableExternalObjects: false,
    enableSmokeLab: false,
    enableBuiltInAgents: false,
    enableBetaSkills: false,
    enableSummaries: false,
    enableStatusCards: false,
    enableDecisions: false,
    enableFastResponses: false,
    enableGoalsSidebarLink: false,
    enableServerInfoDebugView: false,
    enablePaperclipDeveloperMode: false,
    enableSimplifiedEnglishInteractions: false,
    enableFirstTaskPlanProposal: false,
    enablePixelsOffice: false,
    autoRestartDevServerWhenIdle: false,
    enableWorkspaceBranchReconcileForward: true,
    enableWorkspaceDirtyQuarantineRepair: true,
    enableOwnerInstanceAdmin: false,
    enableSandboxDuplexBridge: false,
    enableRunnerPreviewIngress: false,
    enableWorktreeRunExecution: false,
    worktreeRunExecutionActivatedAt: null,
    worktreeRunExecutionActivationInstanceId: null,
  };
}

export function instanceSettingsService(db: Db, options: InstanceSettingsServiceOptions = {}) {
  // Same posture for WARDMOTE_SETTING_DEFAULTS: parsed once, applied per
  // read, never persisted (see applyOperatorGeneralDefaults) — including on
  // the write path, where a full-GET echo of the overlaid value is stripped
  // back to the schema default (see stripOperatorGeneralEchoes).
  const operatorDefaults = getOperatorSettingDefaults(options.runtimeEnv ?? process.env);

  function toGeneralView(raw: unknown): InstanceGeneralSettings {
    const general = applyOperatorGeneralDefaults(normalizeGeneralSettings(raw), operatorDefaults);
    setAttachmentLimitSetting(general.attachmentMaxMegabytes);
    return general;
  }

  function toExperimentalView(raw: unknown): InstanceExperimentalSettings {
    return normalizeExperimentalSettings(raw);
  }

  function toInstanceSettings(row: typeof instanceSettings.$inferSelect): InstanceSettings {
    return {
      id: row.id,
      defaultEnvironmentId: row.defaultEnvironmentId ?? null,
      general: toGeneralView(row.general),
      experimental: toExperimentalView(row.experimental),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } as InstanceSettings;
  }
  async function getOrCreateRow(runner: InstanceSettingsWriteDb = db) {
    const existing = await runner
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, DEFAULT_SINGLETON_KEY))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;

    const now = new Date();
    const [created] = await runner
      .insert(instanceSettings)
      .values({
        singletonKey: DEFAULT_SINGLETON_KEY,
        general: {},
        experimental: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [instanceSettings.singletonKey],
        set: {
          updatedAt: now,
        },
      })
      .returning();

    if (created) return created;

    const raced = await runner
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, DEFAULT_SINGLETON_KEY))
      .then((rows) => rows[0] ?? null);
    if (raced) return raced;

    throw new Error("Failed to initialize instance settings row");
  }

  return {
    get: async (): Promise<InstanceSettings> => toInstanceSettings(await getOrCreateRow()),

    update: async (
      patch: PatchInstanceSettings,
      writeOptions?: { db?: InstanceSettingsWriteDb },
    ): Promise<InstanceSettings> => {
      // The write may run inside a caller-supplied transaction so it commits
      // atomically with a sibling write (e.g. clearing the managed-default
      // stamp on the environment row alongside a defaultEnvironmentId
      // change). Reads use the same runner so the row is visible to the tx.
      const runner = writeOptions?.db ?? db;
      const current = await getOrCreateRow(runner);
      const now = new Date();
      const [updated] = await runner
        .update(instanceSettings)
        .set({
          ...(Object.prototype.hasOwnProperty.call(patch, "defaultEnvironmentId")
            ? { defaultEnvironmentId: patch.defaultEnvironmentId ?? null }
            : {}),
          updatedAt: now,
        })
        .where(eq(instanceSettings.id, current.id))
        .returning();
      return toInstanceSettings(updated ?? current);
    },

    getGeneral: async (
      readOptions?: { db?: InstanceSettingsWriteDb },
    ): Promise<InstanceGeneralSettings> => {
      const row = await getOrCreateRow(readOptions?.db);
      return toGeneralView(row.general);
    },

    getExperimental: async (): Promise<InstanceExperimentalSettings> => {
      const row = await getOrCreateRow();
      return toExperimentalView(row.experimental);
    },

    updateGeneral: async (patch: PatchInstanceGeneralSettings): Promise<InstanceSettings> => {
      const current = await getOrCreateRow();
      const storedGeneral = normalizeGeneralSettings(current.general);
      // A full-GET echo carries the overlaid operator value for a field the
      // user never chose; stripping it keeps the overlay strictly read-time,
      // so changing or unsetting the variable later still takes effect.
      const nextGeneral = stripOperatorGeneralEchoes(
        storedGeneral,
        normalizeGeneralSettings({ ...storedGeneral, ...patch }),
        operatorDefaults,
      );
      const now = new Date();
      const [updated] = await db
        .update(instanceSettings)
        .set({
          general: { ...nextGeneral },
          updatedAt: now,
        })
        .where(eq(instanceSettings.id, current.id))
        .returning();
      return toInstanceSettings(updated ?? current);
    },

    updateExperimental: async (patch: PatchInstanceExperimentalSettings): Promise<InstanceSettings> => {
      const current = await getOrCreateRow();
      const nextExperimental = applyExperimentalSettingsPatch(current.experimental, patch, options);
      const now = new Date();
      const [updated] = await db
        .update(instanceSettings)
        .set({
          experimental: { ...nextExperimental },
          updatedAt: now,
        })
        .where(eq(instanceSettings.id, current.id))
        .returning();
      return toInstanceSettings(updated ?? current);
    },

    seedNewInstallFeatureDefaults: async (): Promise<boolean> => {
      await getOrCreateRow();
      const seeded = await db
        .update(instanceSettings)
        .set({ experimental: { ...NEW_INSTALL_FEATURE_DEFAULTS }, updatedAt: new Date() })
        .where(
          and(
            eq(instanceSettings.singletonKey, DEFAULT_SINGLETON_KEY),
            sql`${instanceSettings.experimental} = '{}'::jsonb`,
            notExists(db.select({ id: companies.id }).from(companies)),
          ),
        )
        .returning({ id: instanceSettings.id });
      return seeded.length > 0;
    },

    listCompanyIds: async (): Promise<string[]> =>
      db
        .select({ id: companies.id })
        .from(companies)
        .then((rows) => rows.map((row) => row.id)),
  };
}
