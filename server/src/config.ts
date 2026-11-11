import { readConfigFile, resolveDeploymentMode } from "./config-file.js";
import { parseChatWebhookPublicBaseUrl } from "./chat-webhook-public-url.js";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { resolveWardmoteEnvPath } from "./paths.js";
import { maybeRepairLegacyWorktreeConfigAndEnvFiles } from "./worktree-config.js";
import { shouldLoadWorkingDirectoryEnv } from "./env-file-policy.js";
import { applyEmptyWorktreeSigningSecrets } from "./dev-runner-worktree.js";
import {
  AUTH_BASE_URL_MODES,
  BIND_MODES,
  DEPLOYMENT_EXPOSURES,
  SECRET_PROVIDERS,
  STORAGE_PROVIDERS,
  runLogRetentionConfigSchema,
  type RunLogRetentionConfig,
  type BindMode,
  type AuthBaseUrlMode,
  type DeploymentExposure,
  type DeploymentMode,
  type SecretProvider,
  type StorageProvider,
  inferBindModeFromHost,
  resolveRuntimeBind,
  validateConfiguredBindMode,
} from "@tickernelz/wardmote-shared";
import {
  resolveDefaultBackupDir,
  resolveDefaultEmbeddedPostgresDir,
  resolveDefaultSecretsKeyFilePath,
  resolveDefaultStorageDir,
  resolveHomeAwarePath,
} from "./home-paths.js";

const WARDMOTE_ENV_FILE_PATH = resolveWardmoteEnvPath();
if (existsSync(WARDMOTE_ENV_FILE_PATH)) {
  loadDotenv({ path: WARDMOTE_ENV_FILE_PATH, override: false, quiet: true });
}

const CWD_ENV_PATH = resolve(process.cwd(), ".env");
const cwdEnvExists = existsSync(CWD_ENV_PATH);
const isSameFile = cwdEnvExists && existsSync(WARDMOTE_ENV_FILE_PATH)
  ? realpathSync(CWD_ENV_PATH) === realpathSync(WARDMOTE_ENV_FILE_PATH)
  : CWD_ENV_PATH === WARDMOTE_ENV_FILE_PATH;
if (shouldLoadWorkingDirectoryEnv({
  cwdEnvExists,
  isWardmoteEnvFile: isSameFile,
})) {
  loadDotenv({ path: CWD_ENV_PATH, override: false, quiet: true });
}

if (basename(dirname(WARDMOTE_ENV_FILE_PATH)) === ".wardmote") {
  applyEmptyWorktreeSigningSecrets(dirname(dirname(WARDMOTE_ENV_FILE_PATH)));
}
maybeRepairLegacyWorktreeConfigAndEnvFiles();

const TAILSCALE_DETECT_TIMEOUT_MS = 3000;

type DatabaseMode = "embedded-postgres" | "postgres";

export interface Config {
  deploymentMode: DeploymentMode;
  deploymentExposure: DeploymentExposure;
  bind: BindMode;
  customBindHost: string | undefined;
  host: string;
  port: number;
  allowedHostnames: string[];
  authBaseUrlMode: AuthBaseUrlMode;
  authPublicBaseUrl: string | undefined;
  chatWebhookPublicBaseUrl: string | undefined;
  authDisableSignUp: boolean;
  databaseMode: DatabaseMode;
  databaseUrl: string | undefined;
  databaseMigrationUrl: string | undefined;
  embeddedPostgresDataDir: string;
  embeddedPostgresPort: number;
  databaseBackupEnabled: boolean;
  databaseBackupIntervalMinutes: number;
  databaseBackupRetentionDays: number;
  databaseBackupDir: string;
  workspaceReaperCooldownDays: number;
  runLogRetention: RunLogRetentionConfig;
  serveUi: boolean;
  uiDevMiddleware: boolean;
  secretsProvider: SecretProvider;
  secretsStrictMode: boolean;
  secretsMasterKeyFilePath: string;
  storageProvider: StorageProvider;
  storageLocalDiskBaseDir: string;
  storageS3Bucket: string;
  storageS3Region: string;
  storageS3Endpoint: string | undefined;
  storageS3Prefix: string;
  storageS3ForcePathStyle: boolean;
  feedbackExportBackendUrl: string | undefined;
  feedbackExportBackendToken: string | undefined;
  heartbeatSchedulerEnabled: boolean;
  heartbeatSchedulerIntervalMs: number;
  companyDeletionEnabled: boolean;
  telemetryEnabled: boolean;
  announcementsEnabled: boolean;
  announcementsFeedUrl: string | undefined;
}

function detectTailnetBindHost(): string | undefined {
  const explicit = process.env.WARDMOTE_TAILNET_BIND_HOST?.trim();
  if (explicit) return explicit;

  try {
    const stdout = execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: TAILSCALE_DETECT_TIMEOUT_MS,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

export function loadConfig(): Config {
  const fileConfig = readConfigFile();
  const fileDatabaseMode =
    (fileConfig?.database.mode === "postgres" ? "postgres" : "embedded-postgres") as DatabaseMode;

  const fileDbUrl =
    fileDatabaseMode === "postgres"
      ? fileConfig?.database.connectionString
      : undefined;
  const fileDatabaseBackup = fileConfig?.database.backup;
  const fileRunLogRetention = runLogRetentionConfigSchema.parse(fileConfig?.runLogs?.retention ?? {});
  const runLogRetention: RunLogRetentionConfig = {
    ...fileRunLogRetention,
    enabled:
      process.env.WARDMOTE_RUN_LOG_RETENTION_ENABLED !== undefined
        ? process.env.WARDMOTE_RUN_LOG_RETENTION_ENABLED === "true"
        : fileRunLogRetention.enabled,
    dryRun:
      process.env.WARDMOTE_RUN_LOG_RETENTION_DRY_RUN !== undefined
        ? process.env.WARDMOTE_RUN_LOG_RETENTION_DRY_RUN === "true"
        : fileRunLogRetention.dryRun,
  };
  const fileSecrets = fileConfig?.secrets;
  const fileStorage = fileConfig?.storage;

  const providerFromEnvRaw = process.env.WARDMOTE_SECRETS_PROVIDER;
  const providerFromEnv =
    providerFromEnvRaw && SECRET_PROVIDERS.includes(providerFromEnvRaw as SecretProvider)
      ? (providerFromEnvRaw as SecretProvider)
      : null;
  const providerFromFile = fileSecrets?.provider;
  const secretsProvider: SecretProvider = providerFromEnv ?? providerFromFile ?? "local_encrypted";

  const storageProviderFromEnvRaw = process.env.WARDMOTE_STORAGE_PROVIDER;
  const storageProviderFromEnv =
    storageProviderFromEnvRaw && STORAGE_PROVIDERS.includes(storageProviderFromEnvRaw as StorageProvider)
      ? (storageProviderFromEnvRaw as StorageProvider)
      : null;
  const storageProvider: StorageProvider = storageProviderFromEnv ?? fileStorage?.provider ?? "local_disk";
  const storageLocalDiskBaseDir = resolveHomeAwarePath(
    process.env.WARDMOTE_STORAGE_LOCAL_DIR ??
      fileStorage?.localDisk?.baseDir ??
      resolveDefaultStorageDir(),
  );
  const storageS3Bucket = process.env.WARDMOTE_STORAGE_S3_BUCKET ?? fileStorage?.s3?.bucket ?? "paperclip";
  const storageS3Region = process.env.WARDMOTE_STORAGE_S3_REGION ?? fileStorage?.s3?.region ?? "us-east-1";
  const storageS3Endpoint = process.env.WARDMOTE_STORAGE_S3_ENDPOINT ?? fileStorage?.s3?.endpoint ?? undefined;
  const storageS3Prefix = process.env.WARDMOTE_STORAGE_S3_PREFIX ?? fileStorage?.s3?.prefix ?? "";
  const storageS3ForcePathStyle =
    process.env.WARDMOTE_STORAGE_S3_FORCE_PATH_STYLE !== undefined
      ? process.env.WARDMOTE_STORAGE_S3_FORCE_PATH_STYLE === "true"
      : (fileStorage?.s3?.forcePathStyle ?? false);
  const feedbackExportBackendUrl =
    process.env.WARDMOTE_FEEDBACK_EXPORT_BACKEND_URL?.trim() ||
    process.env.WARDMOTE_TELEMETRY_BACKEND_URL?.trim() ||
    undefined;
  const feedbackExportBackendToken =
    process.env.WARDMOTE_FEEDBACK_EXPORT_BACKEND_TOKEN?.trim() ||
    process.env.WARDMOTE_TELEMETRY_BACKEND_TOKEN?.trim() ||
    undefined;

  const deploymentMode = resolveDeploymentMode(fileConfig);
  const strictModeFromEnv = process.env.WARDMOTE_SECRETS_STRICT_MODE;
  const secretsStrictMode =
    strictModeFromEnv !== undefined
      ? strictModeFromEnv === "true"
      : (fileSecrets?.strictMode ?? deploymentMode === "authenticated");
  const deploymentExposureFromEnvRaw = process.env.WARDMOTE_DEPLOYMENT_EXPOSURE;
  const deploymentExposureFromEnv =
    deploymentExposureFromEnvRaw &&
    DEPLOYMENT_EXPOSURES.includes(deploymentExposureFromEnvRaw as DeploymentExposure)
      ? (deploymentExposureFromEnvRaw as DeploymentExposure)
      : null;
  const deploymentExposure: DeploymentExposure =
    deploymentMode === "local_trusted"
      ? "private"
      : (deploymentExposureFromEnv ?? fileConfig?.server.exposure ?? "private");
  const bindFromEnvRaw = process.env.WARDMOTE_BIND;
  const bindFromEnv =
    bindFromEnvRaw && BIND_MODES.includes(bindFromEnvRaw as BindMode)
      ? (bindFromEnvRaw as BindMode)
      : null;
  const configuredHost = process.env.HOST ?? fileConfig?.server.host ?? "127.0.0.1";
  const tailnetBindHost = detectTailnetBindHost();
  const bind =
    bindFromEnv ??
    fileConfig?.server.bind ??
    inferBindModeFromHost(configuredHost, { tailnetBindHost });
  const customBindHost = process.env.WARDMOTE_BIND_HOST ?? fileConfig?.server.customBindHost;
  const authBaseUrlModeFromEnvRaw = process.env.WARDMOTE_AUTH_BASE_URL_MODE;
  const authBaseUrlModeFromEnv =
    authBaseUrlModeFromEnvRaw &&
    AUTH_BASE_URL_MODES.includes(authBaseUrlModeFromEnvRaw as AuthBaseUrlMode)
      ? (authBaseUrlModeFromEnvRaw as AuthBaseUrlMode)
      : null;
  const publicUrlFromEnv = process.env.WARDMOTE_PUBLIC_URL;
  const configuredAuthPublicBaseUrlRaw = [
    process.env.WARDMOTE_AUTH_PUBLIC_BASE_URL,
    process.env.BETTER_AUTH_URL,
    process.env.BETTER_AUTH_BASE_URL,
    publicUrlFromEnv,
    fileConfig?.auth?.publicBaseUrl,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const managedRuntimePublicUrl = process.env.WARDMOTE_MANAGED_RUNTIME_PUBLIC_URL?.trim() || undefined;
  const authPublicBaseUrlRaw = configuredAuthPublicBaseUrlRaw ?? managedRuntimePublicUrl;
  const authPublicBaseUrl = authPublicBaseUrlRaw?.trim() || undefined;
  const authBaseUrlMode: AuthBaseUrlMode =
    authBaseUrlModeFromEnv ??
    (configuredAuthPublicBaseUrlRaw === undefined && managedRuntimePublicUrl
      ? "explicit"
      : fileConfig?.auth?.baseUrlMode ?? (authPublicBaseUrl ? "explicit" : "auto"));
  const disableSignUpFromEnv = process.env.WARDMOTE_AUTH_DISABLE_SIGN_UP;
  const authDisableSignUp: boolean =
    disableSignUpFromEnv !== undefined
      ? disableSignUpFromEnv === "true"
      : (fileConfig?.auth?.disableSignUp ?? false);
  const allowedHostnamesFromEnvRaw = process.env.WARDMOTE_ALLOWED_HOSTNAMES;
  const allowedHostnamesFromEnv = allowedHostnamesFromEnvRaw
    ? allowedHostnamesFromEnvRaw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
    : null;
  const publicUrlHostname = authPublicBaseUrl
    ? (() => {
      try {
        return new URL(authPublicBaseUrl).hostname.trim().toLowerCase();
      } catch {
        return null;
      }
    })()
    : null;
  const allowedHostnames = Array.from(
    new Set(
      [
        ...(allowedHostnamesFromEnv ?? fileConfig?.server.allowedHostnames ?? []),
        ...(publicUrlHostname ? [publicUrlHostname] : []),
      ]
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const companyDeletionEnvRaw = process.env.WARDMOTE_ENABLE_COMPANY_DELETION;
  const companyDeletionEnabled =
    companyDeletionEnvRaw !== undefined
      ? companyDeletionEnvRaw === "true"
      : deploymentMode === "local_trusted";
  const databaseBackupEnabled =
    process.env.WARDMOTE_DB_BACKUP_ENABLED !== undefined
      ? process.env.WARDMOTE_DB_BACKUP_ENABLED === "true"
      : (fileDatabaseBackup?.enabled ?? true);
  const databaseBackupIntervalMinutes = Math.max(
    1,
    Number(process.env.WARDMOTE_DB_BACKUP_INTERVAL_MINUTES) ||
      fileDatabaseBackup?.intervalMinutes ||
      60,
  );
  const databaseBackupRetentionDays = Math.max(
    1,
    Number(process.env.WARDMOTE_DB_BACKUP_RETENTION_DAYS) ||
      fileDatabaseBackup?.retentionDays ||
      7,
  );
  const databaseBackupDir = resolveHomeAwarePath(
    process.env.WARDMOTE_DB_BACKUP_DIR ??
      fileDatabaseBackup?.dir ??
      resolveDefaultBackupDir(),
  );
  // The terminal-workspace reaper waits this many days after an issue tree
  // becomes terminal before it archives the workspace. A person can reopen the
  // work inside this window. A value of 0 disables the cooldown and restores
  // immediate reaping. A negative or non-numeric value falls back to the
  // default. The day granularity and the default of 7 obey the
  // WARDMOTE_DB_BACKUP_RETENTION_DAYS precedent above.
  const workspaceReaperCooldownDaysEnv =
    process.env.WARDMOTE_WORKSPACE_REAPER_COOLDOWN_DAYS?.trim();
  const workspaceReaperCooldownDaysRaw = Number(workspaceReaperCooldownDaysEnv);
  const workspaceReaperCooldownDays =
    workspaceReaperCooldownDaysEnv
      && Number.isFinite(workspaceReaperCooldownDaysRaw)
      && workspaceReaperCooldownDaysRaw >= 0
      ? workspaceReaperCooldownDaysRaw
      : 7;
  const bindValidationErrors = validateConfiguredBindMode({
    deploymentMode,
    deploymentExposure,
    bind,
    host: configuredHost,
    customBindHost,
  });
  if (bindValidationErrors.length > 0) {
    throw new Error(bindValidationErrors[0]);
  }
  const resolvedBind = resolveRuntimeBind({
    bind,
    host: configuredHost,
    customBindHost,
    tailnetBindHost,
  });
  if (resolvedBind.errors.length > 0) {
    throw new Error(resolvedBind.errors[0]);
  }

  return {
    deploymentMode,
    deploymentExposure,
    bind: resolvedBind.bind,
    customBindHost: resolvedBind.customBindHost,
    host: resolvedBind.host,
    port: Number(process.env.PORT) || fileConfig?.server.port || 3100,
    allowedHostnames,
    authBaseUrlMode,
    authPublicBaseUrl,
    chatWebhookPublicBaseUrl: parseChatWebhookPublicBaseUrl(
      process.env.WARDMOTE_CHAT_WEBHOOK_PUBLIC_URL,
    ),
    authDisableSignUp,
    databaseMode: fileDatabaseMode,
    databaseUrl: process.env.DATABASE_URL ?? fileDbUrl,
    databaseMigrationUrl: process.env.DATABASE_MIGRATION_URL,
    embeddedPostgresDataDir: resolveHomeAwarePath(
      fileConfig?.database.embeddedPostgresDataDir ?? resolveDefaultEmbeddedPostgresDir(),
    ),
    embeddedPostgresPort: fileConfig?.database.embeddedPostgresPort ?? 54329,
    databaseBackupEnabled,
    databaseBackupIntervalMinutes,
    databaseBackupRetentionDays,
    databaseBackupDir,
    workspaceReaperCooldownDays,
    runLogRetention,
    serveUi:
      process.env.SERVE_UI !== undefined
        ? process.env.SERVE_UI === "true"
        : fileConfig?.server.serveUi ?? true,
    uiDevMiddleware: process.env.WARDMOTE_UI_DEV_MIDDLEWARE === "true",
    secretsProvider,
    secretsStrictMode,
    secretsMasterKeyFilePath:
      resolveHomeAwarePath(
        process.env.WARDMOTE_SECRETS_MASTER_KEY_FILE ??
          fileSecrets?.localEncrypted.keyFilePath ??
          resolveDefaultSecretsKeyFilePath(),
      ),
    storageProvider,
    storageLocalDiskBaseDir,
    storageS3Bucket,
    storageS3Region,
    storageS3Endpoint,
    storageS3Prefix,
    storageS3ForcePathStyle,
    feedbackExportBackendUrl,
    feedbackExportBackendToken,
    heartbeatSchedulerEnabled: process.env.HEARTBEAT_SCHEDULER_ENABLED !== "false",
    heartbeatSchedulerIntervalMs: Math.max(10000, Number(process.env.HEARTBEAT_SCHEDULER_INTERVAL_MS) || 30000),
    companyDeletionEnabled,
    telemetryEnabled: fileConfig?.telemetry?.enabled ?? true,
    announcementsEnabled: process.env.WARDMOTE_ANNOUNCEMENTS_ENABLED !== "false",
    announcementsFeedUrl: process.env.WARDMOTE_ANNOUNCEMENTS_FEED_URL?.trim() || undefined,
  };
}
