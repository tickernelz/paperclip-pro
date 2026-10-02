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
  issueThreadInteractions,
  pixelsOfficeSeats,
} from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { pixelsOfficeRoutes } from "../routes/pixels-office.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { pixelsOfficeService } from "../services/pixels-office.js";
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

function agentActor(companyId: string, agentId = randomUUID()): Express.Request["actor"] {
  return {
    type: "agent",
    agentId,
    companyId,
    source: "agent_key",
  } as Express.Request["actor"];
}

function restrictedKeyAgentActor(
  companyId: string,
  agentId: string,
  keyScope: Record<string, unknown>,
): Express.Request["actor"] {
  return {
    type: "agent",
    agentId,
    companyId,
    source: "agent_key",
    keyScope,
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
    await db.delete(issueThreadInteractions);
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

  async function seedAgent(
    companyId: string,
    name: string,
    maxConcurrentRuns?: number,
    status = "idle",
  ) {
    return db
      .insert(agents)
      .values({
        companyId,
        name,
        role: "engineer",
        status,
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

  async function seedChildIssue(
    companyId: string,
    parentId: string,
    assigneeAgentId: string,
    identifier: string,
  ) {
    return db
      .insert(issues)
      .values({
        companyId,
        identifier,
        title: `Child ${identifier}`,
        status: "todo",
        assigneeAgentId,
        parentId,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedInteraction(
    companyId: string,
    issueId: string,
    values: {
      createdByAgentId?: string;
      addresseeAgentId?: string;
      addresseeUserId?: string;
      status?: string;
      effectiveResolverPolicy?: "anyone" | "not_creator" | "human_only";
    } = {},
  ) {
    return db
      .insert(issueThreadInteractions)
      .values({
        companyId,
        issueId,
        kind: "ask_user_questions",
        status: values.status ?? "pending",
        payload: {} as never,
        createdByAgentId: values.createdByAgentId ?? null,
        addresseeAgentId: values.addresseeAgentId ?? null,
        addresseeUserId: values.addresseeUserId ?? null,
        effectiveResolverPolicy: values.effectiveResolverPolicy ?? "anyone",
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

  it("replaces the whole seat map and refuses agents from another company", async () => {
    const company = await seedCompany();
    const otherCompany = await seedCompany();
    await enablePixelsOffice();
    const mine = await seedAgent(company.id, "Mine");
    const foreign = await seedAgent(otherCompany.id, "Foreign");

    const app = createApp(db, localBoardActor());
    await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: mine.id, characterIndex: 1, seatId: "seat-one" }] });

    const rejected = await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({
        assignments: [
          { agentId: mine.id, characterIndex: 2, seatId: "seat-two" },
          { agentId: foreign.id, characterIndex: 5, seatId: "seat-foreign" },
        ],
      });

    expect(rejected.status).toBe(422);
    const untouched = await db.select().from(pixelsOfficeSeats);
    expect(untouched).toHaveLength(1);
    expect(untouched[0]!.seatId).toBe("seat-one");

    const accepted = await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: mine.id, characterIndex: 2, seatId: "seat-two" }] });

    expect(accepted.status).toBe(200);
    expect(accepted.body.assignments).toEqual([
      { agentId: mine.id, characterIndex: 2, seatId: "seat-two" },
    ]);
    const stored = await db.select().from(pixelsOfficeSeats);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.seatId).toBe("seat-two");
  });

  it("rejects two seat assignments for the same agent", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Twice");

    const app = createApp(db, localBoardActor());
    const res = await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({
        assignments: [
          { agentId: agent.id, characterIndex: 1, seatId: "seat-one" },
          { agentId: agent.id, characterIndex: 2, seatId: "seat-two" },
        ],
      });

    expect(res.status).toBe(400);
    expect(await db.select().from(pixelsOfficeSeats)).toHaveLength(0);
  });

  it("returns stored seat assignments with the snapshot", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Seated");

    const app = createApp(db, localBoardActor());
    await request(app)
      .put(`/api/companies/${company.id}/pixels-office/seats`)
      .send({ assignments: [{ agentId: agent.id, characterIndex: 4, seatId: "seat-nine" }] });

    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status).toBe(200);
    expect(res.body.assignments).toEqual([
      { agentId: agent.id, characterIndex: 4, seatId: "seat-nine" },
    ]);
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

  it.each([
    ["task_bridge", { kind: "task_bridge", parentIssueId: randomUUID() }],
    ["skill_test", { kind: "skill_test", issueId: randomUUID() }],
  ])("denies the company-wide snapshot to %s keys", async (_kind, keyScope) => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Scoped");

    const app = createApp(
      db,
      restrictedKeyAgentActor(company.id, agent.id, keyScope as Record<string, unknown>),
    );
    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("serves the snapshot to a same-company agent and to the board", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Reader");

    const agentRes = await request(createApp(db, agentActor(company.id, agent.id))).get(
      `/api/companies/${company.id}/pixels-office`,
    );
    expect(agentRes.status, JSON.stringify(agentRes.body)).toBe(200);

    const boardRes = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );
    expect(boardRes.status).toBe(200);
  });

  it("omits terminated agents from the snapshot", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    await seedAgent(company.id, "Alive");
    await seedAgent(company.id, "Gone", undefined, "terminated");

    const app = createApp(db, localBoardActor());
    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status).toBe(200);
    expect(res.body.agents.map((row: { name: string }) => row.name)).toEqual(["Alive"]);
  });

  it("omits hidden and harness issues from the open task list", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Filtered");
    await seedIssue(company.id, agent.id, "PX-20");
    const hidden = await seedIssue(company.id, agent.id, "PX-21");
    const harness = await seedIssue(company.id, agent.id, "PX-22");
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, hidden.id));
    await db.update(issues).set({ harnessKind: "skill_test" }).where(eq(issues.id, harness.id));

    const app = createApp(db, localBoardActor());
    const res = await request(app).get(`/api/companies/${company.id}/pixels-office`);

    expect(res.status).toBe(200);
    expect(res.body.agents[0].tasks.map((task: { identifier: string }) => task.identifier)).toEqual([
      "PX-20",
    ]);
  });

  it("counts pending interactions for the issue assignee and for the addressee", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const owner = await seedAgent(company.id, "Owner");
    const helper = await seedAgent(company.id, "Helper");
    const issue = await seedIssue(company.id, owner.id, "PX-30");
    await seedInteraction(company.id, issue.id, {
      createdByAgentId: owner.id,
      addresseeAgentId: helper.id,
    });
    await seedInteraction(company.id, issue.id, {
      createdByAgentId: helper.id,
      status: "accepted",
    });

    const res = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byName = new Map<string, { pendingInteractionCount: number; awaitingBoardCount: number }>(
      res.body.agents.map((row: { name: string }) => [row.name, row]),
    );
    expect(byName.get("Owner")!.pendingInteractionCount).toBe(1);
    expect(byName.get("Helper")!.pendingInteractionCount).toBe(1);
  });

  it("counts an interaction only a human can resolve against its creator", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const creator = await seedAgent(company.id, "Creator");
    const peer = await seedAgent(company.id, "Peer");
    const issue = await seedIssue(company.id, creator.id, "PX-31");
    await seedInteraction(company.id, issue.id, {
      createdByAgentId: creator.id,
      effectiveResolverPolicy: "human_only",
    });
    await seedInteraction(company.id, issue.id, {
      createdByAgentId: peer.id,
      addresseeAgentId: creator.id,
    });

    const res = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );

    const byName = new Map<string, { awaitingBoardCount: number }>(
      res.body.agents.map((row: { name: string }) => [row.name, row]),
    );
    expect(byName.get("Creator")!.awaitingBoardCount).toBe(1);
    expect(byName.get("Peer")!.awaitingBoardCount).toBe(0);
  });

  it("flags only the agent paused by a budget hard-stop", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const stopped = await seedAgent(company.id, "Stopped", undefined, "paused");
    const resting = await seedAgent(company.id, "Resting", undefined, "paused");
    await db.update(agents).set({ pauseReason: "budget" }).where(eq(agents.id, stopped.id));
    await db.update(agents).set({ pauseReason: "manual" }).where(eq(agents.id, resting.id));

    const res = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );

    const byName = new Map<string, { budgetPaused: boolean }>(
      res.body.agents.map((row: { name: string }) => [row.name, row]),
    );
    expect(byName.get("Stopped")!.budgetPaused).toBe(true);
    expect(byName.get("Resting")!.budgetPaused).toBe(false);
  });

  it("draws collaboration edges for an addressed interaction and a fresh delegation", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const lead = await seedAgent(company.id, "Lead");
    const worker = await seedAgent(company.id, "Worker");
    const parent = await seedIssue(company.id, lead.id, "PX-40");
    const child = await seedChildIssue(company.id, parent.id, worker.id, "PX-41");
    const interactionIssue = await seedIssue(company.id, lead.id, "PX-42");
    await seedInteraction(company.id, interactionIssue.id, {
      createdByAgentId: lead.id,
      addresseeAgentId: worker.id,
    });

    const res = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.collaboration).toEqual(
      expect.arrayContaining([
        {
          fromAgentId: lead.id,
          toAgentId: worker.id,
          kind: "interaction",
          issueId: interactionIssue.id,
          since: expect.any(String),
        },
        {
          fromAgentId: lead.id,
          toAgentId: worker.id,
          kind: "delegation",
          issueId: child.id,
          since: expect.any(String),
        },
      ]),
    );
  });

  it("leaves out a delegation to the same agent and one older than a day", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const lead = await seedAgent(company.id, "Lead");
    const worker = await seedAgent(company.id, "Worker");
    const parent = await seedIssue(company.id, lead.id, "PX-50");
    await seedChildIssue(company.id, parent.id, lead.id, "PX-51");
    const stale = await seedChildIssue(company.id, parent.id, worker.id, "PX-52");
    await db
      .update(issues)
      .set({ createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000) })
      .where(eq(issues.id, stale.id));

    const res = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );

    expect(res.body.collaboration).toEqual([]);
  });

  it("keeps interaction counts and collaboration inside the company", async () => {
    const company = await seedCompany();
    const otherCompany = await seedCompany();
    await enablePixelsOffice();
    const mine = await seedAgent(company.id, "Mine");
    const theirLead = await seedAgent(otherCompany.id, "Their Lead");
    const theirWorker = await seedAgent(otherCompany.id, "Their Worker");
    const theirIssue = await seedIssue(otherCompany.id, theirLead.id, "OT-1");
    const theirParent = await seedIssue(otherCompany.id, theirLead.id, "OT-2");
    await seedChildIssue(otherCompany.id, theirParent.id, theirWorker.id, "OT-3");
    await seedInteraction(otherCompany.id, theirIssue.id, {
      createdByAgentId: theirLead.id,
      addresseeAgentId: theirWorker.id,
    });

    const res = await request(createApp(db, localBoardActor())).get(
      `/api/companies/${company.id}/pixels-office`,
    );

    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].id).toBe(mine.id);
    expect(res.body.agents[0].pendingInteractionCount).toBe(0);
    expect(res.body.collaboration).toEqual([]);
  });

  it("reads the whole snapshot in a fixed number of queries whatever the office holds", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const counts: number[] = [];

    for (const agentCount of [2, 8]) {
      await db.delete(issueThreadInteractions);
      await db.delete(issues);
      await db.delete(agents);
      const seeded = [];
      for (let index = 0; index < agentCount; index += 1) {
        seeded.push(await seedAgent(company.id, `Agent ${index}`));
      }
      for (const [index, agent] of seeded.entries()) {
        const issue = await seedIssue(company.id, agent.id, `QC-${index}`);
        await seedInteraction(company.id, issue.id, {
          createdByAgentId: agent.id,
          addresseeAgentId: seeded[(index + 1) % seeded.length]!.id,
        });
      }

      let selects = 0;
      const countingDb = new Proxy(db, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (typeof value !== "function") return value;
          if (property === "select") {
            return (...args: unknown[]) => {
              selects += 1;
              return (value as (...inner: unknown[]) => unknown).apply(target, args);
            };
          }
          return value.bind(target);
        },
      }) as Db;

      const snapshot = await pixelsOfficeService(countingDb).snapshot(company.id);
      expect(snapshot.agents).toHaveLength(agentCount);
      counts.push(selects);
    }

    expect(counts[0]).toBe(6);
    expect(counts[1]).toBe(6);
  });
});
