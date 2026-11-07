import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  companySecretBindings,
  companySecretProviderConfigs,
  companySecretVersions,
  companySecrets,
  createDb,
  environments,
  approvals,
  principalPermissionGrants,
  userSecretDeclarations,
  userSecretDefinitions,
} from "@tickernelz/paperclip-pro-db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping agent-hire credential inheritance route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;

function agentActor(companyId: string, agentId: string): Express.Request["actor"] {
  return { type: "agent", agentId, companyId, source: "agent_jwt" };
}

// The local implicit board actor always passes authorization, so it stands in
// for a user actor without needing a seeded company membership.
function userActor(): Express.Request["actor"] {
  return { type: "board", userId: "local-board", source: "local_implicit" };
}

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("hired agent provider credential inheritance", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `paperclip-agent-hire-auth-inheritance-${randomUUID()}`);

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-hire-auth-inheritance-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(approvals);
    await db.delete(activityLog);
    await db.delete(userSecretDeclarations);
    await db.delete(userSecretDefinitions);
    await db.delete(companySecretBindings);
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(companySecretProviderConfigs);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(environments);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (previousKeyFile === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    }
    rmSync(secretsTmpDir, { recursive: true, force: true });
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Auth Inheritance Co ${companyId.slice(0, 8)}`,
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedParentAgent(companyId: string, adapterType: string, env: Record<string, unknown>) {
    const [row] = await db
      .insert(agents)
      .values({
        companyId,
        name: `Parent ${randomUUID().slice(0, 8)}`,
        role: "engineer",
        adapterType,
        adapterConfig: { env },
        runtimeConfig: {},
        permissions: { canCreateAgents: true },
      })
      .returning();
    return row!;
  }

  function secretRef(secretId: string, extra: Record<string, unknown> = {}) {
    return { type: "secret_ref" as const, secretId, ...extra };
  }

  function hire(actor: Express.Request["actor"], companyId: string, payload: Record<string, unknown>) {
    const app = createApp(db, actor);
    return request(app).post(`/api/companies/${companyId}/agent-hires`).send(payload);
  }

  it("rejects native runtime inheritance for a board actor", async () => {
    const companyId = await seedCompany();
    const parent = await seedParentAgent(companyId, "paperclip_runner", {});
    const res = await hire(userActor(), companyId, {
      name: "Board Inheritance Attempt", role: "engineer", adapterType: "paperclip_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(403);
    expect(parent.adapterType).toBe("paperclip_runner");
  });

  it("rejects inheritance from a legacy caller", async () => {
    const companyId = await seedCompany();
    const parent = await seedParentAgent(companyId, "codex_local", {});
    const res = await hire(agentActor(companyId, parent.id), companyId, {
      name: "Legacy Inheritance Attempt", role: "engineer", adapterType: "paperclip_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("paperclip_runner adapter");
  });

  it("rejects native runtime inheritance across companies", async () => {
    const parentCompanyId = await seedCompany();
    const targetCompanyId = await seedCompany();
    const parent = await seedParentAgent(parentCompanyId, "paperclip_runner", { provider: "codex", model: "gpt-5.6-sol" });
    const res = await hire(agentActor(targetCompanyId, parent.id), targetCompanyId, {
      name: "Cross Company Inheritance Attempt", role: "engineer", adapterType: "paperclip_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(403);
    expect(await db.select().from(agents).where(eq(agents.companyId, targetCompanyId))).toHaveLength(0);
  });

  it("records only inherited safe settings in an approval snapshot", async () => {
    const companyId = await seedCompany();
    await db.update(companies).set({ requireBoardApprovalForNewAgents: true }).where(eq(companies.id, companyId));
    const parent = await seedParentAgent(companyId, "paperclip_runner", {});
    await db.update(agents).set({ adapterConfig: {
      provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5", acpxPermissionMode: "approve-all",
      env: { ANTHROPIC_API_KEY: secretRef("parent-secret") }, cwd: "/private/parent",
      invocationLimits: { maxIterations: 3, credentials: "never-copy" },
    } }).where(eq(agents.id, parent.id));
    const res = await hire(agentActor(companyId, parent.id), companyId, {
      name: "Approval Snapshot Child", role: "engineer", adapterType: "paperclip_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status).toBe(201);
    expect(res.body.agent.status).toBe("pending_approval");
    expect(res.body.approval.payload.inheritRuntimeFrom).toBeUndefined();
    expect(res.body.approval.payload.adapterConfig).toMatchObject({ provider: "acpx", acpxAgent: "claude", acpxPermissionMode: "approve-all" });
    expect(res.body.approval.payload.adapterConfig.env).toBeUndefined();
    expect(res.body.approval.payload.adapterConfig.cwd).toBeUndefined();
    expect(res.body.approval.payload.adapterConfig.invocationLimits).toEqual({ maxIterations: 3 });
  });

  it.each([
    ["claude_managed", "managedProfileId", "managedAgentsRetentionAcknowledged", "Managed Agent"],
    ["aws_agentcore", "agentCoreProfileId", "agentCoreRetentionAcknowledged", "Remote Agent"],
  ])("revalidates the inherited %s company profile before creating a hire", async (provider, profileKey, retentionKey, label) => {
    const companyId = await seedCompany();
    const parent = await seedParentAgent(companyId, "paperclip_runner", {});
    await db.update(agents).set({ adapterConfig: {
      provider, [profileKey]: randomUUID(), [retentionKey]: true,
    } }).where(eq(agents.id, parent.id));
    const res = await hire(agentActor(companyId, parent.id), companyId, {
      name: "Missing Profile Child", role: "engineer", adapterType: "paperclip_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe(`${label} profile not found`);
    expect(await db.select().from(agents).where(eq(agents.companyId, companyId))).toHaveLength(1);
  });

  it("validates and preserves an inherited caller default environment", async () => {
    const companyId = await seedCompany();
    const parent = await seedParentAgent(companyId, "paperclip_runner", {});
    const environmentId = randomUUID();
    await db.insert(environments).values({ id: environmentId, name: `Local ${environmentId}`, driver: "local" });
    await db.update(agents).set({ defaultEnvironmentId: environmentId }).where(eq(agents.id, parent.id));
    const res = await hire(agentActor(companyId, parent.id), companyId, {
      name: "Invalid Environment Child", role: "engineer", adapterType: "paperclip_runner", inheritRuntimeFrom: "caller",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.agent.defaultEnvironmentId).toBe(environmentId);
  });

});
