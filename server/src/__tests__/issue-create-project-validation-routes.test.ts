import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, companies, createDb, issues, projects } from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("issue create project validation routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-create-project-validation-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedProject(companyId: string) {
    const [project] = await db.insert(projects).values({ companyId, name: "DCM Odoo 19" }).returning();
    return project;
  }

  async function seedParent(companyId: string) {
    const [parent] = await db.insert(issues).values({
      companyId,
      title: "Parent issue",
      status: "todo",
      priority: "medium",
    }).returning();
    return parent;
  }

  it("rejects an unknown project on company create with 422", async () => {
    const companyId = await seedCompany();
    const missing = randomUUID();
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Task", projectId: missing });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("project_not_found");
    expect(res.body.error).toBe(
      `Project ${missing} was not found in this company. Use paperclipListProjects to get the exact id.`,
    );
  });

  it("rejects an unknown project on children create with 422", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const res = await request(createApp())
      .post(`/api/issues/${parent.id}/children`)
      .send({ title: "Child", projectId: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("project_not_found");
  });

  it("rejects a project from another company with 422", async () => {
    const companyId = await seedCompany();
    const otherProject = await seedProject(await seedCompany());
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Task", projectId: otherProject.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("project_not_found");
  });

  it("creates the issue when the project belongs to the company", async () => {
    const companyId = await seedCompany();
    const project = await seedProject(companyId);
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Task", projectId: project.id });
    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(project.id);
  });
});
