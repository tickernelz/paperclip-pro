import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, agentConfigRevisions, agents, companies, companyMemberships, createDb, closeRegisteredClients, heartbeatRuns, principalPermissionGrants } from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
const externalTestDatabaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL?.trim();
let db: ReturnType<typeof createDb>;
let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "paperclip-concurrency-cap-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "concurrency-cap");
  vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
  if (externalTestDatabaseUrl) db = createDb(externalTestDatabaseUrl);
  else {
    database = await startEmbeddedPostgresTestDatabase("paperclip-concurrency-cap-db-");
    db = createDb(database.connectionString);
  }
}, 90_000);

afterAll(async () => {
  if (externalTestDatabaseUrl) await closeRegisteredClients(externalTestDatabaseUrl);
  await db?.$client.end();
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) await rm(home, { recursive: true, force: true });
});

async function fixture() {
  const companyId = randomUUID();
  const managerId = randomUUID();
  const workerId = randomUUID();
  const userId = `owner-${companyId}`;
  await db.insert(companies).values({ id: companyId, name: "Concurrency cap test", issuePrefix: `C${companyId.slice(0, 7)}`, defaultResponsibleUserId: userId });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values([
    { companyId, principalType: "user", principalId: userId, permissionKey: "agents:create" },
    { companyId, principalType: "user", principalId: userId, permissionKey: "agents:configure" },
    { companyId, principalType: "agent", principalId: managerId, permissionKey: "agents:configure" },
  ]);
  await db.insert(agents).values({ id: managerId, companyId, name: "Manager", role: "ceo", adapterType: "codex_local" });
  await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: managerId, membershipRole: "member", status: "active" });
  await db.insert(agents).values({ id: workerId, companyId, name: "Worker", role: "engineer", adapterType: "codex_local", reportsTo: managerId, runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 20 } } });
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: managerId, status: "running", responsibleUserId: userId }).returning();
  const app = (actor: "agent" | "board") => {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
      req.actor = actor === "agent"
        ? { type: "agent", agentId: managerId, companyId, runId: run!.id, source: "agent_jwt", onBehalfOfUserId: userId, onBehalfOfMemberships: [{ companyId, membershipRole: "owner", status: "active" }] }
        : { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
      next();
    });
    instance.use("/api", agentRoutes(db));
    instance.use(errorHandler);
    return instance;
  };
  const stored = async () => (await db.select().from(agents).where(eq(agents.id, workerId)))[0]!.runtimeConfig;
  const revisions = () => db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, workerId));
  const rejections = () => db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "agent.max_concurrent_runs_change_rejected")));
  return { companyId, managerId, workerId, userId, app, stored, revisions, rejections };
}

describe("agent-authored heartbeat concurrency cap changes", () => {
  it("rejects an agent patch that lowers a peer's maxConcurrentRuns and writes nothing", async () => {
    const f = await fixture();
    const response = await request(f.app("agent")).patch(`/api/agents/${f.workerId}`).send({ runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 2 } } });
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.code).toBe("agent_max_concurrent_runs_change_forbidden");
    expect(await f.stored()).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 20 } });
    expect(await f.revisions()).toEqual([]);
    const [rejection] = await f.rejections();
    expect(rejection).toMatchObject({ actorType: "agent", actorId: f.managerId, entityType: "agent", entityId: f.workerId });
    expect(rejection!.details).toMatchObject({ surface: "agent.patch", field: "runtimeConfig.heartbeat.maxConcurrentRuns", currentValue: 20, requestedValue: 2 });
  });

  it("rejects an agent patch whose runtimeConfig drops a non-default maxConcurrentRuns", async () => {
    const f = await fixture();
    await db.update(agents).set({ runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 10 } } }).where(eq(agents.id, f.workerId));
    const response = await request(f.app("agent")).patch(`/api/agents/${f.workerId}`).send({ runtimeConfig: { heartbeat: { enabled: true } } });
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.code).toBe("agent_max_concurrent_runs_change_forbidden");
    expect(await f.stored()).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 10 } });
  });

  it("lets a board user change maxConcurrentRuns", async () => {
    const f = await fixture();
    const response = await request(f.app("board")).patch(`/api/agents/${f.workerId}`).send({ runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 2 } } });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await f.stored()).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 2 } });
    expect(await f.revisions()).toHaveLength(1);
    expect(await f.rejections()).toEqual([]);
  });

  it("lets an agent patch other keys and resend the unchanged maxConcurrentRuns", async () => {
    const f = await fixture();
    const titled = await request(f.app("agent")).patch(`/api/agents/${f.workerId}`).send({ title: "Senior worker" });
    expect(titled.status, JSON.stringify(titled.body)).toBe(200);
    const resent = await request(f.app("agent")).patch(`/api/agents/${f.workerId}`).send({ runtimeConfig: { heartbeat: { enabled: true, intervalSec: 600, maxConcurrentRuns: "20" } } });
    expect(resent.status, JSON.stringify(resent.body)).toBe(200);
    expect(await f.stored()).toEqual({ heartbeat: { enabled: true, intervalSec: 600, maxConcurrentRuns: "20" } });
    expect(await f.rejections()).toEqual([]);
  });

  it("rejects an agent rollback that restores a different maxConcurrentRuns", async () => {
    const f = await fixture();
    expect((await request(f.app("board")).patch(`/api/agents/${f.workerId}`).send({ runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 2 } } })).status).toBe(200);
    const [lowered] = await f.revisions();
    expect((await request(f.app("board")).patch(`/api/agents/${f.workerId}`).send({ runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 20 } } })).status).toBe(200);
    const response = await request(f.app("agent")).post(`/api/agents/${f.workerId}/config-revisions/${lowered!.id}/rollback`).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.code).toBe("agent_max_concurrent_runs_change_forbidden");
    expect(await f.stored()).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 20 } });
    expect(await f.revisions()).toHaveLength(2);
    const [rejection] = await f.rejections();
    expect(rejection!.details).toMatchObject({ surface: "agent.config_rollback", currentValue: 20, requestedValue: 2 });
  });
});
