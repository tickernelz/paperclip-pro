import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  instanceSettings,
  issues,
} from "@tickernelz/paperclip-pro-db";
import { PIXELS_OFFICE_TIMELINE_PAGE_LIMIT } from "@tickernelz/paperclip-pro-shared";
import { errorHandler } from "../middleware/index.js";
import { pixelsOfficeRoutes } from "../routes/pixels-office.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type TimelineEvent = {
  at: string;
  agentId: string | null;
  kind: string;
  issueId?: string;
  runId?: string;
  status?: string;
  otherAgentId?: string;
};

const WINDOW_FROM = "2026-03-01T00:00:00.000Z";
const WINDOW_TO = "2026-03-01T06:00:00.000Z";

function at(minutes: number) {
  return new Date(Date.parse(WINDOW_FROM) + minutes * 60_000);
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

describeEmbeddedPostgres("pixels office timeline route", () => {
  let db!: Db;
  let tempDb: EmbeddedPostgresTestDatabase | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-pixels-timeline-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
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

  async function seedAgent(companyId: string, name: string) {
    return db
      .insert(agents)
      .values({ companyId, name, role: "engineer", status: "idle", runtimeConfig: {} })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function enablePixelsOffice() {
    await instanceSettingsService(db).updateExperimental({ enablePixelsOffice: true });
  }

  function boardActor(): Express.Request["actor"] {
    return { type: "board", userId: "board-user", source: "local_implicit", isInstanceAdmin: true };
  }

  async function fetchTimeline(
    db_: Db,
    companyId: string,
    query: Record<string, string>,
    actor: Express.Request["actor"] = boardActor(),
  ) {
    return request(createApp(db_, actor))
      .get(`/api/companies/${companyId}/pixels-office/timeline`)
      .query(query);
  }

  it("stays hidden behind the experimental flag", async () => {
    const company = await seedCompany();

    const res = await fetchTimeline(db, company.id, { from: WINDOW_FROM, to: WINDOW_TO });

    expect(res.status).toBe(404);
  });

  it("denies an agent key scoped below company read", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Scoped");

    const res = await fetchTimeline(db, company.id, { from: WINDOW_FROM, to: WINDOW_TO }, {
      type: "agent",
      agentId: agent.id,
      companyId: company.id,
      source: "agent_key",
      keyScope: { kind: "task_bridge", parentIssueId: randomUUID() },
    } as Express.Request["actor"]);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it.each([
    ["a window wider than a day", { from: WINDOW_FROM, to: "2026-03-02T06:00:00.000Z" }],
    ["an inverted window", { from: WINDOW_TO, to: WINDOW_FROM }],
    ["a non-timestamp bound", { from: "yesterday", to: WINDOW_TO }],
  ])("rejects %s", async (_label, query) => {
    const company = await seedCompany();
    await enablePixelsOffice();

    const res = await fetchTimeline(db, company.id, query);

    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("merges run and activity events in time order with their kinds", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Worker");
    const peer = await seedAgent(company.id, "Peer");
    const issue = await db
      .insert(issues)
      .values({ companyId: company.id, identifier: "PX-1", title: "Work", status: "todo" })
      .returning()
      .then((rows) => rows[0]!);
    const run = await db
      .insert(heartbeatRuns)
      .values({
        companyId: company.id,
        agentId: agent.id,
        status: "succeeded",
        startedAt: at(10),
        finishedAt: at(40),
        contextSnapshot: { issueId: issue.id },
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(activityLog).values([
      {
        companyId: company.id,
        actorType: "agent",
        actorId: agent.id,
        agentId: agent.id,
        action: "issue.updated",
        entityType: "issue",
        entityId: issue.id,
        details: { status: "in_progress", _previous: { status: "todo" } },
        createdAt: at(20),
      },
      {
        companyId: company.id,
        actorType: "agent",
        actorId: agent.id,
        agentId: agent.id,
        action: "issue.thread_interaction_created",
        entityType: "issue",
        entityId: issue.id,
        details: { interactionId: randomUUID(), addresseeAgentId: peer.id },
        createdAt: at(30),
      },
      {
        companyId: company.id,
        actorType: "agent",
        actorId: agent.id,
        agentId: agent.id,
        action: "issue.comment_added",
        entityType: "issue",
        entityId: issue.id,
        details: {},
        createdAt: at(35),
      },
      {
        companyId: company.id,
        actorType: "system",
        actorId: "budget_service",
        agentId: agent.id,
        action: "budget.hard_threshold_crossed",
        entityType: "budget_incident",
        entityId: randomUUID(),
        details: {},
        createdAt: at(50),
      },
    ]);

    const res = await fetchTimeline(db, company.id, { from: WINDOW_FROM, to: WINDOW_TO });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const events = res.body.events as TimelineEvent[];
    expect(events.map((event) => event.kind)).toEqual([
      "run_started",
      "issue_status",
      "interaction",
      "run_finished",
      "budget",
    ]);
    expect(events[0]).toMatchObject({ runId: run.id, agentId: agent.id, issueId: issue.id });
    expect(events[1]).toMatchObject({ issueId: issue.id, status: "in_progress" });
    expect(events[2]).toMatchObject({ otherAgentId: peer.id });
    expect(events[3]).toMatchObject({ runId: run.id, status: "succeeded" });
    expect(res.body.nextCursor).toBeNull();
  });

  it("drops events outside the window and events from another company", async () => {
    const company = await seedCompany();
    const otherCompany = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Mine");
    const stranger = await seedAgent(otherCompany.id, "Theirs");
    await db.insert(heartbeatRuns).values([
      { companyId: company.id, agentId: agent.id, status: "succeeded", startedAt: at(-60), finishedAt: at(-30) },
      { companyId: otherCompany.id, agentId: stranger.id, status: "succeeded", startedAt: at(5), finishedAt: at(6) },
    ]);
    await db.insert(activityLog).values([
      {
        companyId: otherCompany.id,
        actorType: "agent",
        actorId: stranger.id,
        agentId: stranger.id,
        action: "budget.hard_threshold_crossed",
        entityType: "budget_incident",
        entityId: randomUUID(),
        details: {},
        createdAt: at(7),
      },
      {
        companyId: company.id,
        actorType: "agent",
        actorId: agent.id,
        agentId: agent.id,
        action: "budget.hard_threshold_crossed",
        entityType: "budget_incident",
        entityId: randomUUID(),
        details: {},
        createdAt: at(8),
      },
    ]);

    const res = await fetchTimeline(db, company.id, { from: WINDOW_FROM, to: WINDOW_TO });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const events = res.body.events as TimelineEvent[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "budget", agentId: agent.id });
  });

  it("pages past the limit with an opaque cursor and no repeats", async () => {
    const company = await seedCompany();
    await enablePixelsOffice();
    const agent = await seedAgent(company.id, "Busy");
    const issue = await db
      .insert(issues)
      .values({ companyId: company.id, identifier: "PX-2", title: "Loop", status: "todo" })
      .returning()
      .then((rows) => rows[0]!);

    const total = PIXELS_OFFICE_TIMELINE_PAGE_LIMIT + 3;
    const rows = Array.from({ length: total }, (_unused, index) => ({
      companyId: company.id,
      actorType: "agent",
      actorId: agent.id,
      agentId: agent.id,
      action: "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      details: { status: index % 2 === 0 ? "in_progress" : "todo" },
      createdAt: new Date(Date.parse(WINDOW_FROM) + index * 1000),
    }));
    for (let offset = 0; offset < rows.length; offset += 1000) {
      await db.insert(activityLog).values(rows.slice(offset, offset + 1000));
    }

    const first = await fetchTimeline(db, company.id, { from: WINDOW_FROM, to: WINDOW_TO });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.events).toHaveLength(PIXELS_OFFICE_TIMELINE_PAGE_LIMIT);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await fetchTimeline(db, company.id, {
      from: WINDOW_FROM,
      to: WINDOW_TO,
      cursor: first.body.nextCursor as string,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.events).toHaveLength(3);
    expect(second.body.nextCursor).toBeNull();

    const firstAts = (first.body.events as TimelineEvent[]).map((event) => event.at);
    const secondAts = (second.body.events as TimelineEvent[]).map((event) => event.at);
    expect(new Set([...firstAts, ...secondAts]).size).toBe(total);
    expect(secondAts[0]! > firstAts[firstAts.length - 1]!).toBe(true);
  });
});
