import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, closeRegisteredClients, heartbeatRuns } from "@tickernelz/paperclip-pro-db";
import type { AgentApiKeyScope } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { resolveManagedInstructionsRoot } from "../services/agent-instructions.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
const externalTestDatabaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL?.trim();
let db: ReturnType<typeof createDb>;
let home: string;

beforeAll(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-ceo-owner-")));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "ceo-owner");
  vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
  if (externalTestDatabaseUrl) db = createDb(externalTestDatabaseUrl);
  else {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ceo-owner-db-");
    db = createDb(database.connectionString);
  }
}, 90_000);

afterAll(async () => {
  if (externalTestDatabaseUrl) await closeRegisteredClients(externalTestDatabaseUrl);
  await db?.$client.end();
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

type ActorOptions = { status?: string; keyScope?: AgentApiKeyScope };

async function fixture() {
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const ceoId = randomUUID();
  const engineerId = randomUUID();
  const targetId = randomUUID();
  const userId = randomUUID();
  const entryFile = "AGENTS.md";
  await db.insert(companies).values([
    { id: companyId, name: "CEO owner", issuePrefix: `O${companyId.slice(0, 7)}`, defaultResponsibleUserId: userId },
    { id: otherCompanyId, name: "Other", issuePrefix: `X${otherCompanyId.slice(0, 7)}` },
  ]);
  await db.insert(authUsers).values({ id: userId, name: "Responsible", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "operator", status: "active" });
  const root = resolveManagedInstructionsRoot({ id: targetId, companyId, name: "Target", adapterConfig: {} });
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, entryFile), "# Original target instructions\n");
  await db.insert(agents).values([
    { id: ceoId, companyId, name: "CEO", role: "ceo", adapterType: "codex_local" },
    { id: engineerId, companyId, name: "Engineer", role: "engineer", adapterType: "codex_local" },
    { id: targetId, companyId, name: "Target", role: "engineer", adapterType: "codex_local", adapterConfig: { instructionsBundleMode: "managed", instructionsRootPath: root, instructionsEntryFile: entryFile } },
  ]);
  await db.insert(companyMemberships).values([
    { companyId, principalType: "agent", principalId: ceoId, membershipRole: "member", status: "active" },
    { companyId, principalType: "agent", principalId: engineerId, membershipRole: "member", status: "active" },
  ]);
  const runs = await db.insert(heartbeatRuns).values([
    { companyId, agentId: ceoId, status: "running", responsibleUserId: userId },
    { companyId, agentId: engineerId, status: "running", responsibleUserId: userId },
  ]).returning();
  const runFor = (agentId: string) => runs.find((run) => run.agentId === agentId)!.id;
  const app = (agentId: string, role: string, options: ActorOptions = {}) => {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
      req.actor = {
        type: "agent",
        agentId,
        agentRole: role,
        agentStatus: options.status ?? "idle",
        companyId,
        keyScope: options.keyScope,
        runId: runFor(agentId),
        source: "agent_jwt",
        onBehalfOfUserId: userId,
        onBehalfOfMemberships: [{ companyId, membershipRole: "operator", status: "active" }],
      };
      next();
    });
    instance.use("/api", agentRoutes(db));
    instance.use(errorHandler);
    return instance;
  };
  return {
    companyId,
    otherCompanyId,
    targetId,
    entryFile,
    ceo: (options?: ActorOptions) => app(ceoId, "ceo", options),
    engineer: () => app(engineerId, "engineer"),
  };
}

describe("owner-equivalent CEO agent access", () => {
  it("lets a CEO agent read and write another agent's instruction entry file", async () => {
    const f = await fixture();
    const read = await request(f.ceo()).get(`/api/agents/${f.targetId}/instructions-bundle/file`).query({ path: f.entryFile });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.content).toBe("# Original target instructions\n");
    const write = await request(f.ceo()).put(`/api/agents/${f.targetId}/instructions-bundle/file`).send({
      path: f.entryFile,
      content: "# Edited by the CEO\n",
      baseRevisionId: read.body.revision.id,
    });
    expect(write.status, JSON.stringify(write.body)).toBe(200);
    const reread = await request(f.ceo()).get(`/api/agents/${f.targetId}/instructions-bundle/file`).query({ path: f.entryFile });
    expect(reread.body.content).toBe("# Edited by the CEO\n");
  });

  it("keeps today's 403 for a non-CEO agent on the instruction routes", async () => {
    const f = await fixture();
    const ceoRead = await request(f.ceo()).get(`/api/agents/${f.targetId}/instructions-bundle/file`).query({ path: f.entryFile });
    expect(ceoRead.status, JSON.stringify(ceoRead.body)).toBe(200);
    const read = await request(f.engineer()).get(`/api/agents/${f.targetId}/instructions-bundle/file`).query({ path: f.entryFile });
    expect(read.status, JSON.stringify(read.body)).toBe(403);
    const write = await request(f.engineer()).put(`/api/agents/${f.targetId}/instructions-bundle/file`).send({
      path: f.entryFile,
      content: "# Edited by an engineer\n",
      baseRevisionId: null,
    });
    expect(write.status, JSON.stringify(write.body)).toBe(403);
  });

  it("lets a CEO agent pass assertBoard and assertInstanceAdmin routes", async () => {
    const f = await fixture();
    const traces = await request(f.ceo()).get(`/api/companies/${f.companyId}/provider-traces`);
    expect(traces.status, JSON.stringify(traces.body)).toBe(200);
    expect(traces.body).toEqual([]);
    const retry = await request(f.ceo()).post(`/api/agents/${f.targetId}/lifecycle/retry`).send({});
    expect(retry.status, JSON.stringify(retry.body)).not.toBe(403);
    expect(retry.body.error ?? "").not.toBe("Board access required");
  });

  it("keeps today's 403 for a non-CEO agent on assertBoard and assertInstanceAdmin routes", async () => {
    const f = await fixture();
    expect((await request(f.ceo()).get(`/api/companies/${f.companyId}/provider-traces`)).status).toBe(200);
    const traces = await request(f.engineer()).get(`/api/companies/${f.companyId}/provider-traces`);
    expect(traces.status).toBe(403);
    expect(traces.body.error).toBe("Board access required");
    const retry = await request(f.engineer()).post(`/api/agents/${f.targetId}/lifecycle/retry`).send({});
    expect(retry.status).toBe(403);
    expect(retry.body.error).toBe("Board access required");
  });

  it("denies a CEO agent a resource in another company", async () => {
    const f = await fixture();
    expect((await request(f.ceo()).get(`/api/companies/${f.companyId}/provider-traces`)).status).toBe(200);
    const traces = await request(f.ceo()).get(`/api/companies/${f.otherCompanyId}/provider-traces`);
    expect(traces.status).toBe(403);
    expect(traces.body.error).toBe("Agent key cannot access another company");
  });

  it("keeps task_bridge and skill_test key scopes and paused CEOs at their limits", async () => {
    const f = await fixture();
    expect((await request(f.ceo()).get(`/api/companies/${f.companyId}/provider-traces`)).status).toBe(200);
    for (const options of [
      { keyScope: { kind: "task_bridge" } as AgentApiKeyScope },
      { keyScope: { kind: "skill_test", issueId: randomUUID() } as AgentApiKeyScope },
      { status: "paused" },
    ]) {
      const traces = await request(f.ceo(options)).get(`/api/companies/${f.companyId}/provider-traces`);
      expect(traces.status, JSON.stringify(options)).toBe(403);
      expect(traces.body.error).toBe("Board access required");
    }
  });
});
