import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  instanceSettings,
  issues,
  pixelsOfficeSeats,
} from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { pixelsOfficeRoutes } from "../routes/pixels-office.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;

function localBoardActor(): Express.Request["actor"] {
  return { type: "board", userId: "board-user", source: "local_implicit", isInstanceAdmin: true };
}

function agentActor(companyId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId: randomUUID(),
    companyId,
    source: "agent_key",
  } as Express.Request["actor"];
}

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", pixelsOfficeRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("pixels office routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-pixels-office-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(pixelsOfficeSeats);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(instanceSettings);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    return db
      .insert(companies)
      .values({ name: "Pixels Co", issuePrefix: `PX${randomUUID().slice(0, 6).toUpperCase()}` })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function enablePixelsOffice() {
    await instanceSettingsService(db).updateExperimental({ enablePixelsOffice: true });
  }

  async function seedAgent(companyId: string, name: string, maxConcurrentRuns?: number) {
    return db
      .insert(agents)
      .values({
        companyId,
        name,
        role: "engineer",
        status: "idle",
        runtimeConfig: maxConcurrentRuns === undefined ? {} : { heartbeat: { maxConcurrentRuns } },
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedIssue(companyId: string, assigneeAgentId: string, identifier: string, status = "todo") {
    return db
      .insert(issues)
      .values({
        companyId,
        identifier,
        title: `Task ${identifier}`,
        status,
        assigneeAgentId,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  it("hides the snapshot behind the experimental flag", async () => {
    const company = await seedCompany();
    const app = createApp(db, localBoardActor());

    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status).toBe(404);
  });

  it("reports every open task one agent holds, not just the first", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Multi Tasker");
    await seedAgent(company.id, "Idle Agent");
    await seedIssue(company.id, agent.id, "PX-1");
    await seedIssue(company.id, agent.id, "PX-2", "in_progress");
    await seedIssue(company.id, agent.id, "PX-3", "blocked");
    await seedIssue(company.id, agent.id, "PX-4", "done");

    const app = createApp(db, localBoardActor());
    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status).toBe(200);
    const multiTasker = res.body.agents.find((row: { name: string }) => row.name === "Multi Tasker");
    expect(multiTasker.tasks.map((task: { identifier: string }) => task.identifier).sort()).toEqual([
      "PX-1",
      "PX-2",
      "PX-3",
    ]);
    expect(multiTasker.maxConcurrentRuns).toBe(20);
    const idleAgent = res.body.agents.find((row: { name: string }) => row.name === "Idle Agent");
    expect(idleAgent.tasks).toEqual([]);
  });

  it("marks the task with a live run as active and keeps the rest queued", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Runner", 7);
    const active = await seedIssue(company.id, agent.id, "PX-10", "in_progress");
    await seedIssue(company.id, agent.id, "PX-11");
    await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      status: "running",
      contextSnapshot: { issueId: active.id },
    });

    const app = createApp(db, localBoardActor());
    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    const row = res.body.agents[0];
    expect(row.maxConcurrentRuns).toBe(7);
    expect(row.activeTaskCount).toBe(1);
    const activeTask = row.tasks.find((task: { identifier: string }) => task.identifier === "PX-10");
    expect(activeTask.active).toBe(true);
    expect(activeTask.runId).toBeTruthy();
    const queuedTask = row.tasks.find((task: { identifier: string }) => task.identifier === "PX-11");
    expect(queuedTask.active).toBe(false);
    expect(queuedTask.runId).toBeNull();
  });

  it("refuses seat writes from an agent actor and records a board write", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Seated");

    const agentApp = createApp(db, agentActor(company.id));
    const denied = await request(agentApp)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: agent.id, characterIndex: 3, seatId: "camera1-desk-a" }] });
    expect(denied.status).toBe(403);
    expect(await db.select().from(pixelsOfficeSeats)).toHaveLength(0);

    const boardApp = createApp(db, localBoardActor());
    const accepted = await request(boardApp)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: agent.id, characterIndex: 3, seatId: "camera1-desk-a" }] });
    expect(accepted.status).toBe(200);
    expect(accepted.body.assignments).toEqual([
      { agentId: agent.id, characterIndex: 3, seatId: "camera1-desk-a" },
    ]);

    const stored = await db.select().from(pixelsOfficeSeats);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.seatId).toBe("camera1-desk-a");

    const logged = await db.select().from(activityLog).where(eq(activityLog.companyId, company.id));
    expect(logged.some((row) => row.action === "pixels_office.seats_updated")).toBe(true);
  });

  it("replaces the whole seat map and drops agents from another company", async () => {
    const company = await seedCompany();
    const otherCompany = await seedCompany();
    await enablePixelsOffice();
    const mine = await seedAgent(company.id, "Mine");
    const foreign = await seedAgent(otherCompany.id, "Foreign");

    const app = createApp(db, localBoardActor());
    await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: mine.id, characterIndex: 1, seatId: "seat-one" }] });

    const res = await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({
        assignments: [
          { agentId: mine.id, characterIndex: 2, seatId: "seat-two" },
          { agentId: foreign.id, characterIndex: 5, seatId: "seat-foreign" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toEqual([
      { agentId: mine.id, characterIndex: 2, seatId: "seat-two" },
    ]);
    const stored = await db.select().from(pixelsOfficeSeats);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.seatId).toBe("seat-two");
  });

  it("deletes seat rows when their agent is deleted", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Doomed");

    const app = createApp(db, localBoardActor());
    await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: agent.id, characterIndex: 0, seatId: "seat-x" }] });
    expect(await db.select().from(pixelsOfficeSeats)).toHaveLength(1);

    await db.delete(agents).where(eq(agents.id, agent.id));

    expect(await db.select().from(pixelsOfficeSeats)).toHaveLength(0);
  });

  it("denies a board actor without membership in the company", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const app = createApp(db, {
      type: "board",
      userId: "outsider",
      source: "session",
      sessionId: "session-x",
      companyIds: [randomUUID()],
      isInstanceAdmin: false,
    } as Express.Request["actor"]);

    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status).toBe(403);
  });
});
