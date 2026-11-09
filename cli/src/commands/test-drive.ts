import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { Option, type Command } from "commander";
import type { Agent, Company, InstanceExperimentalSettings } from "@tickernelz/wardmote-shared";
import { PaperclipApiClient } from "../client/http.js";
import { openUrl } from "../client/board-auth.js";
import {
  expandHomePrefix,
  resolveDefaultConfigPath,
  resolveDefaultContextPath,
} from "../config/home.js";
import { readConfig } from "../config/store.js";
import type { PaperclipConfig } from "../config/schema.js";
import { runCommand, type StartedServer } from "./run.js";
import { isLinkedGitWorktree } from "./git-workspace.js";

export interface TestDriveOptions {
  dataDir?: string;
  companyName?: string;
  agentName?: string;
  model?: string;
  browser?: boolean;
}

export type TestDriveApi = Pick<PaperclipApiClient, "get" | "post" | "patch" | "delete">;

export type ResolvedTestDriveBootstrap = {
  companyName: string;
  agentName: string;
  model?: string;
};

export type TestDriveBootstrapResult = {
  reused: boolean;
  company: Company;
  agent: Agent | null;
};

export interface TestDriveDependencies {
  run: typeof runCommand;
  createApi: (apiBase: string) => TestDriveApi;
  openBrowser: (url: string) => Promise<boolean>;
}

const NON_WARDMOTE_ISOLATED_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "HOST",
  "PORT",
  "SERVE_UI",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_BASE_URL",
] as const;

function requiredApiResult<T>(value: T | null, action: string): T {
  if (value === null) {
    throw new Error(`Wardmote returned no result while ${action}.`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function resolveTestDriveDataDir(dataDir?: string): string {
  const explicit = dataDir?.trim();
  if (explicit) {
    return path.resolve(expandHomePrefix(explicit));
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-test-drive-"));
}

async function loopbackPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveTestDriveServerPort(preferredPort = 3100, available = loopbackPortAvailable): Promise<number> {
  if (await available(preferredPort)) return preferredPort;
  // A saved high port can be occupied. Search the ordinary range instead of
  // trapping the restarted test drive at the top of the TCP port space.
  for (let port = 3100; port <= 65_535; port += 1) {
    if (port !== preferredPort && await available(port)) return port;
  }
  throw new Error("No available loopback port found at or above 3100.");
}

/**
 * Establish isolation before the CLI's normal config and .env loading hook.
 */
export async function prepareTestDriveEnvironment(
  options: Pick<TestDriveOptions, "dataDir">,
  cwd = process.cwd(),
): Promise<{ dataDir: string; linkedWorktree: boolean }> {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("WARDMOTE_")) {
      delete process.env[key];
    }
  }
  for (const key of NON_WARDMOTE_ISOLATED_ENV_KEYS) {
    delete process.env[key];
  }

  const dataDir = resolveTestDriveDataDir(options.dataDir);
  const linkedWorktree = isLinkedGitWorktree(cwd);
  process.env.WARDMOTE_HOME = dataDir;
  process.env.WARDMOTE_INSTANCE_ID = "default";
  process.env.WARDMOTE_CONFIG = resolveDefaultConfigPath("default");
  process.env.WARDMOTE_CONTEXT = resolveDefaultContextPath();
  process.env.WARDMOTE_IN_WORKTREE = linkedWorktree ? "true" : "false";
  process.env.WARDMOTE_OPEN_ON_LISTEN = "false";
  process.env.WARDMOTE_DISABLE_CWD_ENV_FILE = "true";
  process.env.WARDMOTE_DEPLOYMENT_MODE = "local_trusted";
  process.env.WARDMOTE_DEPLOYMENT_EXPOSURE = "private";
  process.env.WARDMOTE_BIND = "loopback";
  process.env.HOST = "127.0.0.1";
  let preferredPort = 3100;
  try {
    preferredPort = readConfig(process.env.WARDMOTE_CONFIG)?.server.port ?? preferredPort;
  } catch {
    // The normal startup doctor owns invalid-config diagnostics and repair.
  }
  // Reusing a test drive must preserve callback and enrollment origins when
  // its saved port is available. Only move forward if that port is occupied.
  process.env.PORT = String(await resolveTestDriveServerPort(preferredPort));

  return { dataDir, linkedWorktree };
}

export function assertTestDriveDatabaseIsolation(
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env,
  readConfigFile: (path?: string) => PaperclipConfig | null = readConfig,
): void {
  if (env.DATABASE_URL?.trim() || env.DATABASE_MIGRATION_URL?.trim()) {
    throw new Error(
      "test-drive requires its isolated embedded database. Remove DATABASE_URL and " +
        "DATABASE_MIGRATION_URL from the selected data directory's .env, or choose a fresh --data-dir.",
    );
  }

  const config = readConfigFile(configPath);
  if (config?.database.mode === "postgres") {
    throw new Error(
      "test-drive cannot reuse a data directory configured for an external PostgreSQL database. " +
        "Choose a fresh data directory or change database.mode to embedded-postgres.",
    );
  }
}

export function resolveTestDriveBootstrap(options: TestDriveOptions): ResolvedTestDriveBootstrap {
  const companyName = (options.companyName ?? "Test Company").trim();
  const agentName = (options.agentName ?? "CEO").trim();
  if (!companyName) throw new Error("--company-name cannot be empty.");
  if (!agentName) throw new Error("--agent-name cannot be empty.");

  const model = options.model;
  if (model !== undefined && (!model || model.trim() !== model)) {
    throw new Error("--model cannot be empty or have surrounding whitespace.");
  }

  return { companyName, agentName, ...(model ? { model } : {}) };
}

function worktreeExecutionArmed(
  settings: InstanceExperimentalSettings,
  instanceId: string,
): boolean {
  return settings.enableWorktreeRunExecution === true
    && Boolean(settings.worktreeRunExecutionActivatedAt)
    && settings.worktreeRunExecutionActivationInstanceId === instanceId;
}

export async function reconcileTestDriveWorktreeExecution(
  api: TestDriveApi,
  instanceId: string,
): Promise<void> {
  const current = requiredApiResult(
    await api.get<InstanceExperimentalSettings>("/api/instance/settings/experimental"),
    "reading experimental settings",
  );

  if (!current.enableWorktreeRunExecution) {
    await api.patch<InstanceExperimentalSettings>("/api/instance/settings/experimental", {
      enableWorktreeRunExecution: true,
    });
  } else if (!worktreeExecutionArmed(current, instanceId)) {
    await api.patch<InstanceExperimentalSettings>("/api/instance/settings/experimental", {
      enableWorktreeRunExecution: false,
    });
    await api.patch<InstanceExperimentalSettings>("/api/instance/settings/experimental", {
      enableWorktreeRunExecution: true,
    });
  }

  const verified = requiredApiResult(
    await api.get<InstanceExperimentalSettings>("/api/instance/settings/experimental"),
    "verifying experimental settings",
  );
  if (!worktreeExecutionArmed(verified, instanceId)) {
    throw new Error(
      `Could not arm “Run tasks in this worktree” for Wardmote instance ${instanceId}. ` +
        "Check that WARDMOTE_IN_WORKTREE=true and retry the command.",
    );
  }
}

export async function bootstrapTestDrive(input: {
  api: TestDriveApi;
  options: TestDriveOptions;
  linkedWorktree: boolean;
  instanceId: string;
}): Promise<TestDriveBootstrapResult> {
  const companies = requiredApiResult(
    await input.api.get<Company[]>("/api/companies"),
    "reading companies",
  );
  const existingCompany = companies[0];
  if (existingCompany) {
    if (input.linkedWorktree) {
      await reconcileTestDriveWorktreeExecution(input.api, input.instanceId);
    }
    return { reused: true, company: existingCompany, agent: null };
  }

  const resolved = resolveTestDriveBootstrap(input.options);
  let company: Company | null = null;
  try {
    company = requiredApiResult(
      await input.api.post<Company>("/api/companies", { name: resolved.companyName }),
      "creating the test company",
    );
    const adapterConfig: Record<string, unknown> = resolved.model ? { model: resolved.model } : {};

    const agent = requiredApiResult(
      await input.api.post<Agent>(`/api/companies/${company.id}/agents`, {
        name: resolved.agentName,
        role: "ceo",
        adapterType: "omp_local",
        adapterConfig,
      }),
      "creating the CEO agent",
    );

    if (input.linkedWorktree) {
      await reconcileTestDriveWorktreeExecution(input.api, input.instanceId);
    }
    return { reused: false, company, agent };
  } catch (error) {
    if (company) {
      try {
        await input.api.delete(`/api/companies/${company.id}`);
      } catch (cleanupError) {
        throw new Error(
          `${errorMessage(error)} Cleanup also failed for newly-created company ${company.id}: ${errorMessage(cleanupError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

function dashboardUrl(server: StartedServer): string {
  return server.apiUrl.replace(/\/api\/?$/, "");
}

export async function testDriveCommand(
  options: TestDriveOptions,
  dependencies: TestDriveDependencies = {
    run: runCommand,
    createApi: (apiBase) => new PaperclipApiClient({ apiBase }),
    openBrowser: openUrl,
  },
): Promise<void> {
  const dataDir = path.resolve(process.env.WARDMOTE_HOME ?? resolveTestDriveDataDir(options.dataDir));
  const linkedWorktree = process.env.WARDMOTE_IN_WORKTREE === "true";
  const instanceId = process.env.WARDMOTE_INSTANCE_ID ?? "default";

  p.log.message(pc.dim(`Data directory: ${dataDir}`));
  p.log.message(pc.dim("The data directory is retained when Wardmote exits."));

  await dependencies.run({
    repair: true,
    yes: true,
    bind: "loopback",
    installService: false,
    skipServiceManagerCheck: !options.dataDir?.trim(),
    introLabel: "wardmote test-drive",
    afterStart: async (server) => {
      const api = dependencies.createApi(server.apiUrl);
      const result = await bootstrapTestDrive({
        api,
        options,
        linkedWorktree,
        instanceId,
      });
      if (result.reused) {
        p.log.message(
          `Using existing data for ${pc.cyan(result.company.name)}; bootstrap flags were ignored.`,
        );
      } else {
        p.log.success(
          `Created ${pc.cyan(result.company.name)} with agent ${pc.cyan(result.agent?.name ?? "CEO")}.`,
        );
      }
      if (linkedWorktree) {
        p.log.success("Run tasks in this worktree is enabled for this instance.");
      }

      const url = dashboardUrl(server);
      if (options.browser === false) {
        p.log.success(`Wardmote is ready at ${pc.cyan(url)}.`);
        return;
      }
      const opened = await dependencies.openBrowser(url);
      if (opened) {
        p.log.success(`Wardmote is ready and opened at ${pc.cyan(url)}.`);
      } else {
        p.log.warn(`Wardmote is ready, but the browser could not be opened. Visit ${url}.`);
      }
    },
  });
}

export function registerTestDriveCommand(program: Command): void {
  program
    .command("test-drive")
    .description("Start an isolated, initialized Wardmote instance for manual testing")
    .option("-d, --data-dir <path>", "Wardmote data directory to create or reuse")
    .option("--company-name <name>", "Initial company name", "Test Company")
    .option("--agent-name <name>", "Initial CEO agent name", "CEO")
    .option("--model <model-id>", "Initial agent model")
    .option("--no-browser", "Do not open the initialized instance in a browser")
    .action(async (options: TestDriveOptions) => {
      await testDriveCommand(options);
    });
}
