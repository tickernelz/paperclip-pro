import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  projects,
} from "@tickernelz/paperclip-pro-db";
import { LOW_TRUST_REVIEW_PRESET } from "@tickernelz/paperclip-pro-shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue refs route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;
type CompanyRow = typeof companies.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as any));
  app.use(errorHandler);
  return app;
}

function boardActor(company: CompanyRow): Express.Request["actor"] {
  return {
    type: "board",
    userId: "board-user",
    companyIds: [company.id],
    memberships: [{ companyId: company.id, membershipRole: "operator", status: "active" }],
    isInstanceAdmin: true,
    source: "local_implicit",
  };
}

function agentActor(company: CompanyRow, agent: AgentRow, runId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId: agent.id,
    companyId: company.id,
    runId,
    source: "agent_jwt",
  };
}

async function seedCompany(db: Db, label = "Refs") {
  const nonce = randomUUID().slice(0, 8);
  const [company] = await db.insert(companies).values({
    name: `${label} ${nonce}`,
    issuePrefix: `RF${nonce.slice(0, 4).toUpperCase()}`,
    defaultResponsibleUserId: "board-user",
  }).returning();
  return company!;
}

async function seedAgent(db: Db, companyId: string) {
  const [agent] = await db.insert(agents).values({
    companyId,
    name: `Agent ${randomUUID().slice(0, 6)}`,
    role: "engineer",
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  }).returning();
  return agent!;
}

async function seedProject(db: Db, companyId: string, name: string) {
  const [project] = await db.insert(projects).values({
    companyId,
    name,
    status: "in_progress",
  }).returning();
  return project!;
}

let issueCounter = 0;

async function seedIssue(
  db: Db,
  company: CompanyRow,
  input: { title: string; status?: string; projectId?: string | null; hiddenAt?: Date | null },
) {
  issueCounter += 1;
  const [issue] = await db.insert(issues).values({
    companyId: company.id,
    projectId: input.projectId ?? null,
    title: input.title,
    status: input.status ?? "todo",
    priority: "medium",
    responsibleUserId: "board-user",
    issueNumber: issueCounter,
    identifier: `${company.issuePrefix}-${issueCounter}`,
    hiddenAt: input.hiddenAt ?? null,
  }).returning();
  return issue!;
}

describeEmbeddedPostgres("GET /companies/:companyId/issues/refs", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-refs-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("resolves a mix of identifiers and uuids to same-company readable issues only", async () => {
    const company = await seedCompany(db);
    const other = await seedCompany(db, "Other");
    const done = await seedIssue(db, company, { title: "Finished work", status: "done" });
    const blocked = await seedIssue(db, company, { title: "Waiting work", status: "blocked" });
    const hidden = await seedIssue(db, company, { title: "Hidden work", hiddenAt: new Date() });
    const foreign = await seedIssue(db, other, { title: "Foreign work", status: "in_progress" });

    const ids = [
      done.identifier!.toLowerCase(),
      blocked.id.toUpperCase(),
      done.id,
      hidden.identifier!,
      foreign.id,
      foreign.identifier!,
      `${company.issuePrefix}-999999`,
      randomUUID(),
      "not a ref",
    ].join(",");
    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/companies/${company.id}/issues/refs`)
      .query({ ids });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sorted = [...res.body].sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title));
    expect(sorted).toEqual([
      { id: done.id, identifier: done.identifier, title: "Finished work", status: "done" },
      { id: blocked.id, identifier: blocked.identifier, title: "Waiting work", status: "blocked" },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(foreign.id);
    expect(JSON.stringify(res.body)).not.toContain(hidden.id);
  });

  it("omits issues outside a restricted agent's authorization boundary", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const allowedProject = await seedProject(db, company.id, "Allowed");
    const hiddenProject = await seedProject(db, company.id, "Restricted");
    const root = await seedIssue(db, company, { title: "Scoped root", projectId: allowedProject.id });
    const visible = await seedIssue(db, company, { title: "Visible sibling", projectId: allowedProject.id, status: "in_progress" });
    const restrictedMarker = `RESTRICTED-${randomUUID()}`;
    const restricted = await seedIssue(db, company, { title: restrictedMarker, projectId: hiddenProject.id, status: "cancelled" });

    const authorizationPolicy = {
      trustBoundary: {
        mode: LOW_TRUST_REVIEW_PRESET,
        companyId: company.id,
        projectIds: [allowedProject.id],
        rootIssueId: root.id,
        issueIds: [root.id, visible.id],
        allowedAgentIds: [],
      },
    };
    await db.update(agents).set({
      permissions: { trustPreset: LOW_TRUST_REVIEW_PRESET, authorizationPolicy },
    }).where(eq(agents.id, agent.id));
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "running",
      contextSnapshot: { issueId: root.id, executionPolicy: { authorizationPolicy } },
    }).returning();
    await db.update(issues).set({
      assigneeAgentId: agent.id,
      checkoutRunId: run!.id,
      executionRunId: run!.id,
      executionPolicy: { authorizationPolicy },
    }).where(eq(issues.id, root.id));

    const res = await request(createApp(db, agentActor(company, agent, run!.id)))
      .get(`/api/companies/${company.id}/issues/refs`)
      .query({ ids: [root.identifier, visible.id, restricted.identifier, restricted.id].join(",") });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.map((ref: { id: string }) => ref.id).sort()).toEqual([root.id, visible.id].sort());
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(restricted.id);
    expect(serialized).not.toContain(restrictedMarker);
  });

  it("rejects more than 100 distinct refs and accepts 100 with duplicates", async () => {
    const company = await seedCompany(db);
    const app = createApp(db, boardActor(company));
    const hundred = Array.from({ length: 100 }, (_, index) => `${company.issuePrefix}-${index + 1}`);

    const accepted = await request(app)
      .get(`/api/companies/${company.id}/issues/refs`)
      .query({ ids: [...hundred, hundred[0]!.toLowerCase(), ` ${hundred[1]} `].join(",") });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    const rejected = await request(app)
      .get(`/api/companies/${company.id}/issues/refs`)
      .query({ ids: [...hundred, `${company.issuePrefix}-101`].join(",") });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain("100");

    const missing = await request(app).get(`/api/companies/${company.id}/issues/refs`);
    expect(missing.status).toBe(400);
  });

  it("rejects agents from another company", async () => {
    const company = await seedCompany(db);
    const other = await seedCompany(db, "Other");
    const otherAgent = await seedAgent(db, other.id);
    const issue = await seedIssue(db, company, { title: "Private" });

    const res = await request(createApp(db, agentActor(other, otherAgent, randomUUID())))
      .get(`/api/companies/${company.id}/issues/refs`)
      .query({ ids: issue.id });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(issue.id);
  });
});
