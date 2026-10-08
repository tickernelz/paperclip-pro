import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
} from "@tickernelz/paperclip-pro-db";
import type * as Services from "../services/index.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

const wakeups = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null));

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Services>();
  return {
    ...actual,
    heartbeatService: (...args: Parameters<typeof Services.heartbeatService>) => ({
      ...actual.heartbeatService(...args),
      wakeup: wakeups,
    }),
  };
});

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentWakeup: vi.fn(),
}));

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { issueRoutes } = await import("../routes/issues.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as never));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
  });
  return app;
}

describeEmbeddedPostgres("issue comment ancestor handoff (embedded postgres)", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-ancestor-handoff-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    wakeups.mockClear();
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  it("forwards a child assignee's plain @Name handoff to the parent and wakes its assignee", async () => {
    const company = await db.insert(companies).values({
      name: "Handoff Company",
      issuePrefix: `HO${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const [bayu, wira] = await db.insert(agents).values(["Bayu (Research)", "Wira (WhatsApp)"].map((name) => ({
      companyId: company.id,
      name,
      role: "engineer",
      status: "active" as const,
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }))).returning();
    const parent = await db.insert(issues).values({
      companyId: company.id,
      identifier: `${company.issuePrefix}-379`,
      title: "OpenWA channel",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: wira!.id,
    }).returning().then((rows) => rows[0]!);
    const child = await db.insert(issues).values({
      companyId: company.id,
      identifier: `${company.issuePrefix}-723`,
      title: "Research",
      status: "in_progress",
      priority: "medium",
      parentId: parent.id,
      assigneeAgentId: bayu!.id,
    }).returning().then((rows) => rows[0]!);
    const run = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: bayu!.id,
      status: "running",
      contextSnapshot: { issueId: child.id },
    }).returning().then((rows) => rows[0]!);

    const app = await createApp(db, {
      type: "agent",
      agentId: bayu!.id,
      companyId: company.id,
      runId: run.id,
      source: "agent_jwt",
    });
    const body = "@Wira: silakan teruskan ke grup Research Lab0 dengan tag mas Khusnul.";
    const res = await request(app).post(`/api/issues/${child.id}/comments`).send({ body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    await vi.waitFor(() => expect(wakeups).toHaveBeenCalledWith(wira!.id, expect.objectContaining({
      reason: "issue_commented",
    })), { timeout: 10_000 });

    const forwarded = await db.select().from(issueComments).where(eq(issueComments.issueId, parent.id));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      authorAgentId: bayu!.id,
      createdByRunId: run.id,
      body: `Forwarded from [${child.identifier}](/${company.issuePrefix}/issues/${child.identifier}#comment-${res.body.id}):\n\n${body}`,
    });
    expect(wakeups).toHaveBeenCalledWith(wira!.id, expect.objectContaining({
      payload: expect.objectContaining({ issueId: parent.id, commentId: forwarded[0]!.id }),
      contextSnapshot: expect.objectContaining({
        issueId: parent.id,
        taskId: parent.id,
        commentId: forwarded[0]!.id,
        wakeCommentId: forwarded[0]!.id,
        wakeReason: "issue_commented",
        source: "comment.ancestor_handoff",
        sourceIssueId: child.id,
        sourceCommentId: res.body.id,
      }),
    }));
    expect(wakeups.mock.calls.filter(([agentId]) => agentId === wira!.id)).toHaveLength(1);
    await vi.waitFor(async () => {
      const events = await db.select().from(activityLog).where(and(
        eq(activityLog.entityId, parent.id),
        eq(activityLog.action, "issue.comment_added"),
      ));
      expect(events).toEqual([expect.objectContaining({
        details: expect.objectContaining({
          commentId: forwarded[0]!.id,
          source: "comment.ancestor_handoff",
          sourceIssueId: child.id,
          sourceCommentId: res.body.id,
        }),
      })]);
    });
  }, 30_000);
});
