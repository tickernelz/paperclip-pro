import * as codexAdapter from "../services/ai-providers/codex/codex-auth-cache.js";
import { WORKSPACE_RESTORE_LOCK_TIMEOUT_CODE } from "@tickernelz/wardmote-adapter-utils/workspace-restore-merge";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, companyMemberships, createDb, closeRegisteredClients, heartbeatRuns, issues, principalPermissionGrants, toolConnectionInstalls } from "@tickernelz/wardmote-db";
import { AI_CONNECTION_ROUTER_REMOVED_MESSAGE, type AiConnectionBinding } from "@tickernelz/wardmote-shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { heartbeatService } from "../services/heartbeat.js";
import { getServerAdapter, registerServerAdapter, unregisterServerAdapter } from "../adapters/index.js";
import { prepareManagedAiRuntime } from "../services/ai-connection-runtime.js";
import { secretService } from "../services/secrets.js";
import { waitForPendingRunFailureReports } from "../services/run-failure-report.js";
import { configureAgentLifecycle } from "../services/agent-lifecycle.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const captureRunFailure = vi.hoisted(() => vi.fn());
vi.mock("../sentry.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../sentry.js")>(),
  captureRunFailure,
}));

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
const externalTestDatabaseUrl = process.env.WARDMOTE_TEST_DATABASE_URL?.trim();
let db: ReturnType<typeof createDb>;
let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "paperclip-hire-ai-"));
  vi.stubEnv("WARDMOTE_HOME", home);
  vi.stubEnv("WARDMOTE_INSTANCE_ID", "hire-ai");
  vi.stubEnv("WARDMOTE_IN_WORKTREE", "false");
  if (externalTestDatabaseUrl) db = createDb(externalTestDatabaseUrl);
  else {
    database = await startEmbeddedPostgresTestDatabase("paperclip-hire-ai-db-");
    db = createDb(database.connectionString);
  }
}, 90_000);

afterAll(async () => {
  await waitForPendingRunFailureReports();
  if (externalTestDatabaseUrl) await closeRegisteredClients(externalTestDatabaseUrl);
  await db?.$client.end();
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) await rm(home, { recursive: true, force: true });
});

async function fixture(provider: "anthropic" | "openai", method: "api_key" | "subscription" = "api_key") {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const userId = `owner-${companyId}`;
  const binding = { provider, method, mode: "responsible_user" } as const;
  const adapterType = "wardmote_runner";
  const adapterConfig = runnerConfig(provider);
  await instanceSettingsService(db).updateExperimental({ enableNativeRunner: true });
  await db.insert(companies).values({ id: companyId, name: "Hiring connection test", issuePrefix: `H${companyId.slice(0, 7)}`, defaultResponsibleUserId: userId });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "agents:create" });
  await db.insert(agents).values({ id: agentId, companyId, name: "Manager", role: "ceo", adapterType, adapterConfig, runtimeConfig: { aiConnection: binding } });
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running", responsibleUserId: userId }).returning();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "agent", agentId, companyId, runId: run!.id, source: "agent_jwt", onBehalfOfUserId: userId, onBehalfOfMemberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  const credential = method === "api_key" ? "fixture-api-key" : provider === "anthropic" ? "fixture-subscription-token" : JSON.stringify({ tokens: { access_token: "fixture-access", refresh_token: "fixture-refresh", id_token: "fixture-id", account_id: "fixture-account" } });
  const account = await aiConnectionService(db).save(companyId, userId, {
    provider, method, name: "Manager's connection", ownership: "personal", agentIds: [agentId], allAgents: false,
    ...(method === "api_key" ? { apiKey: credential } : { loginSessionId: "fixture" }),
  }, credential);
  return { app, companyId, agentId, userId, binding, adapterType, adapterConfig, account, runId: run!.id };
}

function runnerConfig(provider: "anthropic" | "openai") {
  return provider === "anthropic"
    ? { provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5", lifecycleMode: "per_turn" }
    : { provider: "codex", model: "gpt-5.6-sol", lifecycleMode: "per_turn" };
}

function hired(response: request.Response) {
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.agent ?? response.body;
}

describe("agent-created hires use managed AI connections", () => {
  for (const endpoint of ["agent-hires", "agents"]) {
    it.each([
      ["anthropic", "api_key"], ["anthropic", "subscription"],
      ["openai", "api_key"], ["openai", "subscription"],
    ] as const)(`${endpoint}: %s hires its own provider using the same %s binding`, async (provider, method) => {
      const f = await fixture(provider, method);
      const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/${endpoint}`).send({ name: "Teammate", role: "engineer", adapterType: f.adapterType, adapterConfig: f.adapterConfig, reportsTo: f.agentId }));
      expect(agent.runtimeConfig.aiConnection).toEqual(f.binding);
      const runtime = await prepareManagedAiRuntime(db, { companyId: f.companyId, agentId: agent.id, responsibleUserId: f.userId, adapterType: agent.adapterType, binding: agent.runtimeConfig.aiConnection, config: agent.adapterConfig });
      try {
        expect(runtime.attribution).toMatchObject({ connectionId: f.account.connectionId, grantId: f.account.grantId, method, responsibleUserId: f.userId });
      } finally { await runtime.cleanup(); }
    });
  }

  for (const endpoint of ["agent-hires", "agents"]) {
  }

  it.each([true, false])("managed bindings do not inherit legacy credentials (managed parent: %s)", async (managedParent) => {
    const f = await fixture("openai");
    const secret = await secretService(db).create(f.companyId, {
      name: "Legacy parent key", provider: "local_encrypted", value: "fixture-legacy-key",
    });
    await db.update(agents).set({
      runtimeConfig: managedParent ? { aiConnection: f.binding } : {},
      adapterConfig: { env: { OPENAI_API_KEY: { type: "secret_ref", secretId: secret.id } } },
    }).where(eq(agents.id, f.agentId));
    const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({
      name: "Managed child", role: "engineer", adapterType: f.adapterType, adapterConfig: f.adapterConfig,
      ...(managedParent ? {} : { runtimeConfig: { aiConnection: f.binding } }),
    }));
    expect(agent.runtimeConfig.aiConnection).toEqual(f.binding);
    expect(agent.adapterConfig.env?.OPENAI_API_KEY).toBeUndefined();
  });

  it("keeps unmanaged parent hires on their existing authentication path", async () => {
    const f = await fixture("openai");
    await db.update(agents).set({ runtimeConfig: {} }).where(eq(agents.id, f.agentId));
    const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({
      name: "Legacy authentication", role: "engineer", adapterType: f.adapterType, adapterConfig: f.adapterConfig,
    }));
    expect(agent.runtimeConfig.aiConnection).toBeUndefined();
  });

  it.each(["anthropic", "openai"] as const)("%s can hire the other provider before that user connects it", async (provider) => {
    const f = await fixture(provider);
    const otherProvider = provider === "anthropic" ? "openai" : "anthropic";
    const adapterType = "wardmote_runner";
    const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({ name: "Other provider", role: "engineer", adapterType, adapterConfig: runnerConfig(otherProvider) }));
    expect(agent.runtimeConfig.aiConnection).toMatchObject({ provider: otherProvider, mode: "responsible_user" });
    await expect(prepareManagedAiRuntime(db, { companyId: f.companyId, agentId: agent.id, responsibleUserId: f.userId, adapterType, binding: agent.runtimeConfig.aiConnection, config: agent.adapterConfig })).rejects.toMatchObject({ details: { code: "ai_connection_default_missing" } });
    expect(agent).toMatchObject({ status: "paused", lifecycleState: "preparing" });
  });

  for (const endpoint of ["agent-hires", "agents"]) {
    it.each([
      ["anthropic", "wardmote_runner", { provider: "codex" }, "ANTHROPIC_API_KEY"],
      ["openai", "wardmote_runner", { provider: "acpx", acpxAgent: "claude" }, "OPENAI_API_KEY"],
    ] as const)(`${endpoint}: ignores the %s auth key for a different provider in %s`, async (provider, adapterType, config, key) => {
      const f = await fixture(provider);
      const response = await request(f.app).post(`/api/companies/${f.companyId}/${endpoint}`).send({
        name: "Cross-provider config", role: "engineer", adapterType,
        adapterConfig: { ...config, env: { [key]: "leftover-parent-setting" } },
      });
      const agent = hired(response);
      expect(agent.runtimeConfig.aiConnection).toMatchObject({ provider: provider === "anthropic" ? "openai" : "anthropic", mode: "responsible_user" });
    });
  }

  it("accepts an explicit personal default before authentication, including approval-gated hires", async () => {
    const f = await fixture("anthropic");
    await db.update(companies).set({ requireBoardApprovalForNewAgents: true }).where(eq(companies.id, f.companyId));
    const binding: AiConnectionBinding = { provider: "openai", method: "subscription", mode: "responsible_user" };
    const response = await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({ name: "Future Codex", role: "engineer", adapterType: "wardmote_runner", adapterConfig: runnerConfig("openai"), runtimeConfig: { aiConnection: binding } });
    const agent = hired(response);
    expect(agent.runtimeConfig.aiConnection).toEqual(binding);
    expect(agent.status).toBe("pending_approval");
    expect(response.body.approval.payload.runtimeConfig.aiConnection).toEqual(binding);
    expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.targetId, agent.id))).toEqual([]);
  });

  it.each(["anthropic", "openai"] as const)("inherits %s when the hire uses the native runner", async (provider) => {
    const f = await fixture(provider, "subscription");
    const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({ name: "Native teammate", role: "engineer", adapterType: "wardmote_runner", adapterConfig: provider === "anthropic" ? { provider: "acpx", acpxAgent: "claude" } : { provider: "codex" } }));
    expect(agent.runtimeConfig.aiConnection).toEqual(f.binding);
    const runtime = await prepareManagedAiRuntime(db, { companyId: f.companyId, agentId: agent.id, responsibleUserId: f.userId, adapterType: agent.adapterType, binding: agent.runtimeConfig.aiConnection, config: agent.adapterConfig });
    try { expect(runtime.attribution.connectionId).toBe(f.account.connectionId); } finally { await runtime.cleanup(); }
  });

  it.each([
    ["codex", { provider: "codex", model: "gpt-5.6-sol", codexPermissionMode: "never", lifecycleMode: "per_turn" }],
    ["claude", { provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5", acpxPermissionMode: "approve-all", lifecycleMode: "per_turn" }],
  ] as const)("caller runtime inheritance preserves safe %s settings only", async (_name, parentConfig) => {
    const f = await fixture("anthropic", "subscription");
    await db.update(agents).set({
      adapterType: "wardmote_runner",
      adapterConfig: {
        ...parentConfig,
        cwd: "/private/parent-workspace",
        env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "parent-secret" } },
        instructionsFilePath: "/private/parent-instructions.md",
        runtimeSessionId: "parent-session",
      },
    }).where(eq(agents.id, f.agentId));
    const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({
      name: "Inherited teammate", role: "engineer", adapterType: "wardmote_runner", inheritRuntimeFrom: "caller",
    }));
    expect(agent.adapterConfig).toMatchObject(parentConfig);
    expect(agent.adapterConfig).not.toHaveProperty("cwd");
    expect(agent.adapterConfig).not.toHaveProperty("env");
    expect(agent.adapterConfig.instructionsFilePath).not.toBe("/private/parent-instructions.md");
    expect(agent.adapterConfig).not.toHaveProperty("runtimeSessionId");
    expect(agent.runtimeConfig.aiConnection).toMatchObject({
      provider: parentConfig.provider === "codex" ? "openai" : "anthropic",
      mode: "responsible_user",
    });
  });

  it("rejects caller inheritance when the request supplies competing runtime settings", async () => {
    const f = await fixture("anthropic", "subscription");
    await db.update(agents).set({ adapterType: "wardmote_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }).where(eq(agents.id, f.agentId));
    const response = await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({
      name: "Conflicting teammate", role: "engineer", adapterType: "wardmote_runner", inheritRuntimeFrom: "caller",
      adapterConfig: { model: "caller.override" },
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("cannot be combined");
  });

  it("still rejects an explicitly incompatible provider without creating a hire", async () => {
    const f = await fixture("anthropic");
    const response = await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({ name: "Wrong provider", role: "engineer", adapterType: "wardmote_runner", adapterConfig: runnerConfig("openai"), runtimeConfig: { aiConnection: f.binding } });
    expect(response.status).toBe(422);
    expect(response.body.details.code).toBe("ai_connection_incompatible");
    expect(await db.select().from(agents).where(eq(agents.companyId, f.companyId))).toHaveLength(1);
  });

  it("rejects a removed connection-pool binding without creating a hire", async () => {
    const f = await fixture("anthropic");
    const response = await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({ name: "Pool teammate", role: "engineer", adapterType: "omp_local", runtimeConfig: { aiConnection: { mode: "router", connectionId: randomUUID() } } });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: AI_CONNECTION_ROUTER_REMOVED_MESSAGE, details: { code: "ai_connection_router_removed" } });
    expect(await db.select().from(agents).where(eq(agents.companyId, f.companyId))).toHaveLength(1);
  });
});

describe("hired agents sharing a subscription", () => {
  async function finishSetup(agentId: string) {
    // These tests cover task credentials after setup; lifecycle tests cover verification.
    const worker = configureAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete", runHost: async () => "complete" });
    try { await worker.process(agentId); } finally { await worker.stop(); }
  }
  it("keeps a credential-lock timeout on automatic retry without blocking the task or starting a provider", async () => {
    const f = await fixture("openai", "subscription");
    const agent = hired(await request(f.app).post(`/api/companies/${f.companyId}/agent-hires`).send({ name: "Waiting teammate", role: "engineer", adapterType: f.adapterType, adapterConfig: f.adapterConfig, reportsTo: f.agentId, adapterConfig: { engine: "cli" }, runtimeConfig: { heartbeat: { enabled: false } } }));
    // Only an operator may set host execution paths after the agent is hired.
    await db.update(agents).set({ adapterConfig: { ...agent.adapterConfig, cwd: home } }).where(eq(agents.id, agent.id));
    await finishSetup(agent.id);
    const [issue] = await db.insert(issues).values({ companyId: f.companyId, title: "Wait for credential rotation", status: "todo", assigneeAgentId: agent.id, responsibleUserId: f.userId, createdByUserId: f.userId }).returning();
    const execute = vi.fn(async () => ({ exitCode: 0, signal: null, timedOut: false, resultJson: {} }));
    registerServerAdapter({ ...getServerAdapter(f.adapterType), execute });
    const lock = vi.spyOn(codexAdapter, "withAccountHomeSecretMutationLock")
      .mockRejectedValueOnce(Object.assign(new Error("quota refresh holds company lock"), { code: WORKSPACE_RESTORE_LOCK_TIMEOUT_CODE }));
    const heartbeat = heartbeatService(db);
    try {
      const run = await heartbeat.invoke(agent.id, "assignment", { issueId: issue.id, wakeReason: "issue_assigned", responsibleUserId: f.userId }, "system");
      expect(run).not.toBeNull();
      await expect.poll(async () => (await heartbeat.getRun(run!.id))?.status, { timeout: 20_000 }).toBe("cancelled");
      await heartbeat.drainActiveRunExecutions();
      const cancelled = await heartbeat.getRun(run!.id);
      expect(cancelled).toMatchObject({ errorCode: "ai_connection_busy", resultJson: {
        executionRecovery: { kind: "ai_connection_wait", providerWorkStarted: false },
        cancellation: {
          source: "control_plane", expected: true, initiator: { type: "system" },
          reason: "Waiting for shared AI credentials",
          recordedAt: cancelled!.finishedAt!.toISOString(),
        },
      } });
      await waitForPendingRunFailureReports();
      expect(captureRunFailure.mock.calls.filter(([report]) => report.runId === run!.id)).toHaveLength(0);
      const retries = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.retryOfRunId, run!.id));
      expect(retries).toHaveLength(1);
      expect(retries[0]).toMatchObject({ status: "scheduled_retry", scheduledRetryReason: "ai_connection_busy" });
      expect(retries[0].resultJson?.cancellation).toBeUndefined();
      const [savedIssue] = await db.select().from(issues).where(eq(issues.id, issue.id));
      expect(savedIssue.status).not.toBe("blocked");
      expect(savedIssue.executionRunId).toBe(retries[0].id);
      expect(execute).not.toHaveBeenCalled();
      expect(await aiConnectionService(db).list(f.companyId, f.userId)).toEqual([expect.objectContaining({ status: "connected" })]);
    } finally {
      lock.mockRestore();
      await heartbeat.drainActiveRunExecutions();
      unregisterServerAdapter(f.adapterType);
    }
  });

  it("stops a run before provider work when the agent still has a removed connection-pool binding", async () => {
    const f = await fixture("anthropic", "subscription");
    const [agent] = await db.insert(agents).values({ companyId: f.companyId, name: "Former pool teammate", role: "engineer", adapterType: "omp_local", adapterConfig: { cwd: home }, runtimeConfig: { heartbeat: { enabled: false }, aiConnection: { mode: "router", connectionId: randomUUID() } } }).returning();
    const [issue] = await db.insert(issues).values({ companyId: f.companyId, title: "Task for a former pool agent", status: "todo", assigneeAgentId: agent.id, responsibleUserId: f.userId, createdByUserId: f.userId }).returning();
    const execute = vi.fn(async () => ({ exitCode: 0, signal: null, timedOut: false, resultJson: {} }));
    registerServerAdapter({ ...getServerAdapter("omp_local"), execute });
    const heartbeat = heartbeatService(db);
    try {
      const run = await heartbeat.invoke(agent.id, "assignment", { issueId: issue.id, wakeReason: "issue_assigned", responsibleUserId: f.userId }, "system");
      expect(run).not.toBeNull();
      await expect.poll(async () => (await heartbeat.getRun(run!.id))?.status, { timeout: 20_000 }).not.toMatch(/^(queued|running)$/);
      await heartbeat.drainActiveRunExecutions();
      const finished = await heartbeat.getRun(run!.id);
      expect(finished?.error).toBe(AI_CONNECTION_ROUTER_REMOVED_MESSAGE);
      expect(execute).not.toHaveBeenCalled();
      const [saved] = await db.select().from(agents).where(eq(agents.id, agent.id));
      expect(saved.runtimeConfig.aiConnection).toMatchObject({ mode: "router" });
    } finally {
      await heartbeat.drainActiveRunExecutions();
      unregisterServerAdapter("omp_local");
    }
  });
});
