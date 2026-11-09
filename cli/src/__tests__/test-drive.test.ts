import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, Company, InstanceExperimentalSettings } from "@tickernelz/wardmote-shared";
import {
  assertTestDriveDatabaseIsolation,
  bootstrapTestDrive,
  prepareTestDriveEnvironment,
  reconcileTestDriveWorktreeExecution,
  resolveTestDriveBootstrap,
  resolveTestDriveDataDir,
  resolveTestDriveServerPort,
  testDriveCommand,
  type TestDriveApi,
} from "../commands/test-drive.js";
import type { RunOptions, StartedServer } from "../commands/run.js";
import { RETIRED_ENV_PREFIX } from "@tickernelz/wardmote-shared/retired-env-file";
import type { PaperclipConfig } from "../config/schema.js";

const ORIGINAL_ENV = { ...process.env };
const cleanupDirectories: string[] = [];

function company(id = "company-1", name = "Test Company"): Company {
  return { id, name } as Company;
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "CEO",
    role: "ceo",
    adapterType: "claude_local",
    adapterConfig: {},
    ...overrides,
  } as Agent;
}

function settings(overrides: Partial<InstanceExperimentalSettings> = {}): InstanceExperimentalSettings {
  return {
    enableWorktreeRunExecution: false,
    worktreeRunExecutionActivatedAt: null,
    worktreeRunExecutionActivationInstanceId: null,
    ...overrides,
  } as InstanceExperimentalSettings;
}

function freshBootstrapApi(input?: { failAgent?: boolean }) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: vi.fn(async <T>(requestPath: string) => {
      calls.push({ method: "GET", path: requestPath });
      return [] as T;
    }),
    post: vi.fn(async <T>(requestPath: string, body?: unknown) => {
      calls.push({ method: "POST", path: requestPath, body });
      if (requestPath === "/api/companies") return company() as T;
      if (requestPath.endsWith("/agents")) {
        if (input?.failAgent) throw new Error("agent setup failed");
        const payload = body as { name: string; adapterType: Agent["adapterType"]; adapterConfig: Record<string, unknown> };
        return agent({
          name: payload.name,
          adapterType: payload.adapterType,
          adapterConfig: payload.adapterConfig,
        }) as T;
      }
      return { ok: true } as T;
    }),
    patch: vi.fn(async <T>() => ({ ok: true }) as T),
    delete: vi.fn(async <T>(requestPath: string) => {
      calls.push({ method: "DELETE", path: requestPath });
      return { ok: true } as T;
    }),
  } as TestDriveApi;
  return { api, calls };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  while (cleanupDirectories.length > 0) {
    fs.rmSync(cleanupDirectories.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("test-drive data isolation", () => {
  it.each([false, true])("reuses the saved port, with occupied=%s", async (occupied) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-test-drive-port-"));
    cleanupDirectories.push(root);
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const savedPort = (listener.address() as { port: number }).port;
    const close = () => new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    if (!occupied) await close();
    const configPath = path.join(root, "instances", "default", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      $meta: { version: 1, updatedAt: new Date().toISOString(), source: "onboard" },
      database: {}, logging: { mode: "file" }, telemetry: { enabled: false },
      server: { port: savedPort },
    }));
    try {
      await prepareTestDriveEnvironment({ dataDir: root }, os.tmpdir());
      if (occupied) { expect(Number(process.env.PORT)).not.toBe(savedPort); expect(Number(process.env.PORT)).toBeGreaterThanOrEqual(3100); }
      else expect(Number(process.env.PORT)).toBe(savedPort);
      expect(JSON.parse(fs.readFileSync(configPath, "utf8")).server.port).toBe(savedPort);
      expect(process.env.HOST).toBe("127.0.0.1");
    } finally {
      if (occupied) await close();
    }
  });

  it("creates unique retained OS temporary directories and reports absolute paths", () => {
    const first = resolveTestDriveDataDir();
    const second = resolveTestDriveDataDir();
    cleanupDirectories.push(first, second);

    expect(path.isAbsolute(first)).toBe(true);
    expect(path.dirname(first)).toBe(os.tmpdir());
    expect(first).not.toBe(second);
    expect(fs.existsSync(first)).toBe(true);
    expect(fs.existsSync(second)).toBe(true);
  });

  it("resolves an explicit reusable directory without resetting it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-test-drive-explicit-"));
    cleanupDirectories.push(root);
    const marker = path.join(root, "keep.txt");
    fs.writeFileSync(marker, "keep");

    expect(resolveTestDriveDataDir(root)).toBe(path.resolve(root));
    expect(fs.readFileSync(marker, "utf8")).toBe("keep");
  });

  it("discards inherited Wardmote routing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-test-drive-env-"));
    cleanupDirectories.push(root);
    process.env.WARDMOTE_HOME = "/normal/home";
    process.env.WARDMOTE_CONFIG = "/normal/config.json";
    process.env.WARDMOTE_IN_WORKTREE = "true";
    process.env[`${RETIRED_ENV_PREFIX}HOME`] = "/normal/home";
    process.env[`${RETIRED_ENV_PREFIX}API_KEY`] = "outer-run-token";
    process.env.DATABASE_URL = "postgres://normal-instance";

    const prepared = await prepareTestDriveEnvironment(
      { dataDir: root },
      os.tmpdir(),
    );

    expect(prepared.dataDir).toBe(path.resolve(root));
    expect(prepared.linkedWorktree).toBe(false);
    expect(process.env.WARDMOTE_HOME).toBe(path.resolve(root));
    expect(process.env.WARDMOTE_CONFIG).toBe(
      path.join(path.resolve(root), "instances", "default", "config.json"),
    );
    expect(process.env.WARDMOTE_IN_WORKTREE).toBe("false");
    expect(process.env.WARDMOTE_DISABLE_CWD_ENV_FILE).toBe("true");
    expect(process.env.WARDMOTE_DEPLOYMENT_MODE).toBe("local_trusted");
    expect(process.env.WARDMOTE_DEPLOYMENT_EXPOSURE).toBe("private");
    expect(process.env.WARDMOTE_BIND).toBe("loopback");
    expect(process.env.HOST).toBe("127.0.0.1");
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env[`${RETIRED_ENV_PREFIX}HOME`]).toBeUndefined();
    expect(process.env[`${RETIRED_ENV_PREFIX}API_KEY`]).toBeUndefined();
    expect(Number(process.env.PORT)).toBeGreaterThanOrEqual(3100);
  });

  it.each(["DATABASE_URL", "DATABASE_MIGRATION_URL"])(
    "rejects %s loaded from the isolated directory",
    (variable) => {
      const readConfigFile = vi.fn(() => null);
      expect(() => assertTestDriveDatabaseIsolation(
        undefined,
        { [variable]: "postgres://external-database" },
        readConfigFile,
      )).toThrow(/requires its isolated embedded database/);
      expect(readConfigFile).not.toHaveBeenCalled();
    },
  );

  it("rejects an explicitly reused PostgreSQL configuration", () => {
    const externalConfig = {
      database: { mode: "postgres" },
    } as PaperclipConfig;
    expect(() => assertTestDriveDatabaseIsolation(
      "/tmp/reused/config.json",
      {},
      () => externalConfig,
    )).toThrow(/cannot reuse.*external PostgreSQL database/);
  });

  it("accepts an embedded configuration", () => {
    const embeddedConfig = {
      database: { mode: "embedded-postgres" },
    } as PaperclipConfig;
    expect(() => assertTestDriveDatabaseIsolation(
      "/tmp/reused/config.json",
      {},
      () => embeddedConfig,
    )).not.toThrow();
  });
});

describe("test-drive bootstrap validation", () => {
  it("uses default names and leaves the OMP model optional", () => {
    expect(resolveTestDriveBootstrap({})).toEqual({ companyName: "Test Company", agentName: "CEO" });
    expect(resolveTestDriveBootstrap({ model: "anthropic/claude-sonnet-5" }).model).toBe("anthropic/claude-sonnet-5");
  });

  it("rejects empty names and padded models", () => {
    expect(() => resolveTestDriveBootstrap({ companyName: " " })).toThrow(/--company-name/);
    expect(() => resolveTestDriveBootstrap({ agentName: "" })).toThrow(/--agent-name/);
    expect(() => resolveTestDriveBootstrap({ model: " x" })).toThrow(/--model/);
  });
});

describe("test-drive API bootstrap", () => {
  it("creates exactly one company and one OMP CEO", async () => {
    const { api, calls } = freshBootstrapApi();
    const result = await bootstrapTestDrive({
      api,
      options: { model: "anthropic/claude-sonnet-5" },
      linkedWorktree: false,
      instanceId: "default",
    });

    expect(result.reused).toBe(false);
    expect(result.agent?.role).toBe("ceo");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/companies",
      "POST /api/companies",
      "POST /api/companies/company-1/agents",
    ]);
    const agentCall = calls.find((call) => call.path.endsWith("/agents"));
    expect(agentCall?.body).toEqual({
      name: "CEO",
      role: "ceo",
      adapterType: "omp_local",
      adapterConfig: { model: "anthropic/claude-sonnet-5" },
    });
    expect(calls.some((call) => /issues|projects|goals|tasks|heartbeat/.test(call.path))).toBe(false);
  });


  it("preserves seeded data and ignores every bootstrap flag", async () => {
    const get = vi.fn(async <T>(requestPath: string) => {
      if (requestPath === "/api/companies") return [company("existing", "Existing Company")] as T;
      throw new Error(`Unexpected GET ${requestPath}`);
    });
    const api = {
      get,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as TestDriveApi;

    const result = await bootstrapTestDrive({
      api,
      options: { companyName: "Ignored" },
      linkedWorktree: false,
      instanceId: "default",
    });

    expect(result).toMatchObject({ reused: true, company: { id: "existing" }, agent: null });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("deletes only the newly-created company when fresh bootstrap fails", async () => {
    const { api, calls } = freshBootstrapApi({ failAgent: true });
    await expect(bootstrapTestDrive({
      api,
      options: {},
      linkedWorktree: false,
      instanceId: "default",
    })).rejects.toThrow("agent setup failed");
    expect(calls.at(-1)).toEqual({ method: "DELETE", path: "/api/companies/company-1" });
  });
});

describe("test-drive worktree setting reconciliation", () => {
  function worktreeApi(initial: InstanceExperimentalSettings, instanceId = "test-instance") {
    let current = initial;
    const patchBodies: unknown[] = [];
    const api = {
      get: vi.fn(async <T>() => current as T),
      patch: vi.fn(async <T>(_path: string, body?: unknown) => {
        patchBodies.push(body);
        const enabled = (body as { enableWorktreeRunExecution: boolean }).enableWorktreeRunExecution;
        current = settings({
          ...current,
          enableWorktreeRunExecution: enabled,
          worktreeRunExecutionActivatedAt: enabled ? "2026-09-05T12:00:00.000Z" : null,
          worktreeRunExecutionActivationInstanceId: enabled ? instanceId : null,
        });
        return current as T;
      }),
      post: vi.fn(),
      delete: vi.fn(),
    } as unknown as TestDriveApi;
    return { api, patchBodies };
  }

  it("enables a disabled setting", async () => {
    const { api, patchBodies } = worktreeApi(settings());
    await reconcileTestDriveWorktreeExecution(api, "test-instance");
    expect(patchBodies).toEqual([{ enableWorktreeRunExecution: true }]);
  });

  it("leaves a correctly armed setting unchanged", async () => {
    const { api, patchBodies } = worktreeApi(settings({
      enableWorktreeRunExecution: true,
      worktreeRunExecutionActivatedAt: "2026-09-05T11:00:00.000Z",
      worktreeRunExecutionActivationInstanceId: "test-instance",
    }));
    await reconcileTestDriveWorktreeExecution(api, "test-instance");
    expect(patchBodies).toEqual([]);
  });

  it.each([
    settings({ enableWorktreeRunExecution: true }),
    settings({
      enableWorktreeRunExecution: true,
      worktreeRunExecutionActivatedAt: "2026-09-05T11:00:00.000Z",
      worktreeRunExecutionActivationInstanceId: "another-instance",
    }),
  ])("rearms missing or mismatched activation metadata", async (initial) => {
    const { api, patchBodies } = worktreeApi(initial);
    await reconcileTestDriveWorktreeExecution(api, "test-instance");
    expect(patchBodies).toEqual([
      { enableWorktreeRunExecution: false },
      { enableWorktreeRunExecution: true },
    ]);
  });

  it("fails when the setting cannot be armed for this instance", async () => {
    const api = {
      get: vi.fn(async <T>() => settings() as T),
      patch: vi.fn(async <T>() => settings() as T),
      post: vi.fn(),
      delete: vi.fn(),
    } as unknown as TestDriveApi;
    await expect(reconcileTestDriveWorktreeExecution(api, "test-instance"))
      .rejects.toThrow(/Could not arm/);
  });
});

describe("test-drive foreground lifecycle", () => {
  const server: StartedServer = {
    apiUrl: "http://127.0.0.1:3100/api",
    databaseUrl: "postgres://embedded",
    host: "127.0.0.1",
    listenPort: 3100,
  };

  it("skips service-manager integration for an auto-created directory and opens after initialization", async () => {
    process.env.WARDMOTE_HOME = "/tmp/test-drive-lifecycle";
    process.env.WARDMOTE_INSTANCE_ID = "default";
    process.env.WARDMOTE_IN_WORKTREE = "false";
    const events: string[] = [];
    let runOptions: RunOptions | undefined;
    const api = {
      get: vi.fn(async <T>() => {
        events.push("initialized");
        return [company("existing", "Existing")] as T;
      }),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as TestDriveApi;

    await testDriveCommand({}, {
      run: async (options) => {
        runOptions = options;
        events.push("listening");
        await options.afterStart?.(server);
      },
      createApi: () => api,
      openBrowser: async () => {
        events.push("browser");
        return true;
      },
    });

    expect(runOptions).toMatchObject({
      yes: true,
      bind: "loopback",
      installService: false,
      skipServiceManagerCheck: true,
      introLabel: "wardmote test-drive",
    });
    expect(events).toEqual(["listening", "initialized", "browser"]);
  });

  it("retains the managed-instance collision guard for an explicitly reused directory", async () => {
    process.env.WARDMOTE_HOME = "/tmp/test-drive-reused";
    process.env.WARDMOTE_INSTANCE_ID = "default";
    process.env.WARDMOTE_IN_WORKTREE = "false";
    let runOptions: RunOptions | undefined;
    const api = {
      get: vi.fn(async <T>() => [company("existing", "Existing")] as T),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as TestDriveApi;

    await testDriveCommand({ dataDir: "/tmp/test-drive-reused", browser: false }, {
      run: async (options) => {
        runOptions = options;
        await options.afterStart?.(server);
      },
      createApi: () => api,
      openBrowser: vi.fn(async () => true),
    });

    expect(runOptions?.skipServiceManagerCheck).toBe(false);
  });

  it("honors --no-browser after successful initialization", async () => {
    process.env.WARDMOTE_HOME = "/tmp/test-drive-no-browser";
    process.env.WARDMOTE_INSTANCE_ID = "default";
    process.env.WARDMOTE_IN_WORKTREE = "false";
    const api = {
      get: vi.fn(async <T>() => [company("existing", "Existing")] as T),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as TestDriveApi;
    const openBrowser = vi.fn(async () => true);

    await testDriveCommand({ browser: false }, {
      run: async (options) => options.afterStart?.(server),
      createApi: () => api,
      openBrowser,
    });

    expect(openBrowser).not.toHaveBeenCalled();
  });
});

describe("test drive port recovery", () => {
  it("falls back from an occupied saved port at the top of the range", async () => {
    const available = vi.fn(async (port: number) => port === 3101);
    await expect(resolveTestDriveServerPort(65535, available)).resolves.toBe(3101);
    expect(available.mock.calls.map(([port]) => port)).toEqual([65535, 3100, 3101]);
  });
  it("preserves a free saved port before searching the default range", async () => {
    const available = vi.fn(async () => true);
    await expect(resolveTestDriveServerPort(3110, available)).resolves.toBe(3110);
    expect(available).toHaveBeenCalledTimes(1);
  });
});
