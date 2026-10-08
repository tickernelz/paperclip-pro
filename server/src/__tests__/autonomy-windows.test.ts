import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issueAutonomyWindows,
  issueThreadInteractions,
  issues,
} from "@tickernelz/paperclip-pro-db";
import type { IssueThreadInteraction } from "@tickernelz/paperclip-pro-shared";
import {
  isAutonomyWindowEligibleInteraction,
  issueThreadInteractionService,
} from "../services/issue-thread-interactions.js";
import { autonomyWindowService } from "../services/autonomy-windows.js";
import { autonomyWindowRoutes } from "../routes/autonomy-windows.js";
import { errorHandler } from "../middleware/index.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

for (const key of Object.keys(process.env)) if (key.startsWith("PAPERCLIP_")) delete process.env[key];

describe("autonomy window eligibility", () => {
  const plain = {
    kind: "request_confirmation",
    status: "pending",
    createdByAgentId: "agent-1",
    addresseeAgentId: null,
    payload: { version: 1, prompt: "Push the branch?" },
  } as unknown as IssueThreadInteraction;
  const withPayload = (payload: Record<string, unknown>) =>
    ({ ...plain, payload: { version: 1, prompt: "Push the branch?", ...payload } }) as unknown as IssueThreadInteraction;

  it("accepts only agent-created confirmations explicitly declared non-destructive", () => {
    expect(isAutonomyWindowEligibleInteraction(withPayload({ destructive: false }))).toBe(true);
    expect(isAutonomyWindowEligibleInteraction(plain)).toBe(false);
  });

  it.each([
    ["tool action", withPayload({ toolAction: { actionRequestId: randomUUID() } })],
    ["secret proposal", withPayload({ secretProposal: { proposalId: randomUUID() } })],
    ["connection authorization", withPayload({ connectionAuthorization: { version: 1 } })],
    ["OpenWA approval", withPayload({ openwaApprovalRequestId: randomUUID() })],
    ["destructive", withPayload({ destructive: true })],
    ["native completion review", withPayload({ target: { type: "custom", key: "native_completion_review", revisionId: "r1" } })],
    ["agent-addressed", { ...plain, addresseeAgentId: "agent-2" } as unknown as IssueThreadInteraction],
    ["user-created", { ...plain, createdByAgentId: null } as unknown as IssueThreadInteraction],
    ["already resolved", { ...plain, status: "accepted" } as unknown as IssueThreadInteraction],
    ["checkbox", { ...plain, kind: "request_checkbox_confirmation" } as unknown as IssueThreadInteraction],
  ])("keeps %s cards pending", (_label, interaction) => {
    expect(isAutonomyWindowEligibleInteraction(interaction)).toBe(false);
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres.sequential("autonomy windows", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let agentId: string;
  let ids: { root: string; child: string; grandchild: string; outside: string; review: string };
  const wakeup = vi.fn(async () => null);

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-autonomy-windows-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(async () => {
    wakeup.mockClear();
    companyId = randomUUID();
    agentId = randomUUID();
    ids = { root: randomUUID(), child: randomUUID(), grandchild: randomUUID(), outside: randomUUID(), review: randomUUID() };
    await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "AUT", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Coder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: false } },
      permissions: {},
    });
    const issue = (id: string, identifier: string, parentId: string | null, status = "in_progress") => ({
      id,
      companyId,
      identifier,
      parentId,
      title: identifier,
      status,
      priority: "medium",
      assigneeAgentId: agentId,
    });
    await db.insert(issues).values(issue(ids.root, "AUT-1", null));
    await db.insert(issues).values(issue(ids.child, "AUT-2", ids.root));
    await db.insert(issues).values(issue(ids.grandchild, "AUT-3", ids.child));
    await db.insert(issues).values(issue(ids.outside, "AUT-4", null));
    await db.insert(issues).values(issue(ids.review, "AUT-5", ids.root, "in_review"));
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueAutonomyWindows);
    await db.delete(issueThreadInteractions);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  const owner = { userId: "owner-user", grantedVia: "paperclip" as const };
  const interactions = () => issueThreadInteractionService(db, { wakeup });
  const confirm = (issueId: string, payload: Record<string, unknown> = {}, continuationPolicy = "wake_assignee") =>
    interactions().create(
      { id: issueId, companyId },
      {
        kind: "request_confirmation",
        continuationPolicy,
        payload: { version: 1, prompt: "Push the branch and deploy?", destructive: false, ...payload },
      } as never,
      { agentId },
    );

  it("auto-accepts a plain confirmation on a descendant, audits the window and wakes the assignee", async () => {
    const [window] = await autonomyWindowService(db).open(companyId, { issueIds: ["AUT-1"], hours: 4 }, owner);

    const accepted = await confirm(ids.grandchild);

    expect(accepted.status).toBe("accepted");
    expect(accepted.result).toMatchObject({
      outcome: "accepted",
      resolutionDetails: { source: "autonomy_window", windowId: window!.id, rootIssueId: ids.root, grantedByUserId: "owner-user" },
    });
    const [stored] = await db.select().from(issueAutonomyWindows).where(eq(issueAutonomyWindows.id, window!.id));
    expect(stored!.acceptCount).toBe(1);
    const audit = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "issue.thread_interaction_accepted"), eq(activityLog.entityId, ids.grandchild)));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "system", actorId: "system:autonomy-window" });
    expect(audit[0]!.details).toMatchObject({ interactionId: accepted.id, windowId: window!.id, source: "autonomy_window" });
    expect(wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        requestedByActorId: "system:autonomy-window",
        payload: expect.objectContaining({ interactionId: accepted.id, resolutionSource: "autonomy_window" }),
      }),
    );
  });

  it("does not wake when the continuation policy does not ask for it", async () => {
    await autonomyWindowService(db).open(companyId, { issueIds: [ids.root] }, owner);
    const accepted = await confirm(ids.child, {}, "none");
    expect(accepted.status).toBe("accepted");
    expect(wakeup).not.toHaveBeenCalled();
  });

  it("leaves confirmations outside the window pending", async () => {
    await autonomyWindowService(db).open(companyId, { issueIds: ["AUT-2"] }, owner);
    expect((await confirm(ids.outside)).status).toBe("pending");
    expect((await confirm(ids.root)).status).toBe("pending");
  });

  it("leaves questions, checkbox, verdict, suggested-task, destructive and review cards pending inside the window", async () => {
    await autonomyWindowService(db).open(companyId, { issueIds: ["AUT-1"] }, owner);
    const issue = { id: ids.grandchild, companyId };
    const svc = interactions();
    const created = [
      await svc.create(issue, {
        kind: "ask_user_questions",
        payload: {
          version: 1,
          questions: [{ id: "scope", prompt: "Which scope?", selectionMode: "single", options: [{ id: "small", label: "Small" }] }],
        },
      } as never, { agentId }),
      await svc.create(issue, {
        kind: "request_checkbox_confirmation",
        payload: { version: 1, prompt: "Select regions", options: [{ id: "us", label: "US" }] },
      } as never, { agentId }),
      await svc.create(issue, {
        kind: "request_item_verdicts",
        payload: { version: 1, prompt: "Review these", items: [{ id: "one", label: "One" }] },
      } as never, { agentId }),
      await svc.create(issue, {
        kind: "suggest_tasks",
        payload: { version: 1, tasks: [{ clientKey: "t1", title: "Build API" }] },
      } as never, { agentId }),
      await confirm(ids.grandchild, { destructive: true }),
      await confirm(ids.grandchild, { destructive: undefined }),
      await confirm(ids.review),
    ];
    expect(created.map((entry) => entry.status)).toEqual(["pending", "pending", "pending", "pending", "pending", "pending", "pending"]);
    const [window] = await db.select().from(issueAutonomyWindows);
    expect(window!.acceptCount).toBe(0);
  });

  it("stops auto-accepting after close, expiry and the accept cap", async () => {
    const svc = autonomyWindowService(db);
    const [closing] = await svc.open(companyId, { issueIds: ["AUT-1"] }, owner);
    await svc.close(closing!.id, owner, companyId);
    expect((await confirm(ids.child)).status).toBe("pending");

    const [expiring] = await svc.open(companyId, { issueIds: ["AUT-1"] }, owner);
    await db
      .update(issueAutonomyWindows)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(issueAutonomyWindows.id, expiring!.id));
    expect((await confirm(ids.child)).status).toBe("pending");
    const [expired] = await db.select().from(issueAutonomyWindows).where(eq(issueAutonomyWindows.id, expiring!.id));
    expect(expired!.status).toBe("expired");

    const [capped] = await svc.open(companyId, { issueIds: ["AUT-1"], maxAccepts: 1 }, owner);
    expect((await confirm(ids.child)).status).toBe("accepted");
    expect((await confirm(ids.grandchild)).status).toBe("pending");
    const [used] = await db.select().from(issueAutonomyWindows).where(eq(issueAutonomyWindows.id, capped!.id));
    expect(used!.acceptCount).toBe(1);
  });

  function app(actor: Record<string, unknown>) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      (req as unknown as { actor: Record<string, unknown> }).actor = actor;
      next();
    });
    server.use("/api", autonomyWindowRoutes(db));
    server.use(errorHandler);
    return server;
  }

  it("lets only board users open, list and close windows and logs both transitions", async () => {
    const agentApp = app({ type: "agent", agentId, companyId, source: "agent_key" });
    expect((await request(agentApp).get(`/api/companies/${companyId}/autonomy-windows`)).status).toBe(403);
    expect((await request(agentApp).post(`/api/companies/${companyId}/autonomy-windows`).send({ issueIds: ["AUT-1"] })).status).toBe(403);

    const board = app({ type: "board", userId: "board-user", source: "session", isInstanceAdmin: true, companyIds: [companyId] });
    const opened = await request(board).post(`/api/companies/${companyId}/autonomy-windows`).send({ issueIds: ["AUT-1"], hours: 2 });
    expect(opened.status).toBe(201);
    const windowId = opened.body.windows[0].id as string;
    expect(opened.body.windows[0]).toMatchObject({ rootIssueId: ids.root, rootIssueIdentifier: "AUT-1", grantedByUserId: "board-user", grantedVia: "paperclip", status: "live" });
    expect(new Date(opened.body.windows[0].expiresAt).getTime() - Date.now()).toBeGreaterThan(110 * 60_000);

    const listed = await request(board).get(`/api/companies/${companyId}/autonomy-windows`);
    expect(listed.body.windows.map((window: { id: string }) => window.id)).toEqual([windowId]);

    expect((await request(agentApp).delete(`/api/autonomy-windows/${windowId}`)).status).toBe(403);
    const closed = await request(board).delete(`/api/autonomy-windows/${windowId}`);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ id: windowId, status: "revoked", closedByUserId: "board-user" });
    expect((await request(board).delete(`/api/autonomy-windows/${windowId}`)).status).toBe(409);

    const rows = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
    const transitions = rows.filter((row) => row.action.startsWith("autonomy_window."));
    expect(transitions.map((row) => [row.action, row.actorType, row.actorId, (row.details as Record<string, unknown>).windowId])).toEqual(
      expect.arrayContaining([
        ["autonomy_window.opened", "user", "board-user", windowId],
        ["autonomy_window.closed", "user", "board-user", windowId],
      ]),
    );
    expect(transitions).toHaveLength(2);
  });

  it("rejects unknown issues and out-of-range hours", async () => {
    const board = app({ type: "board", userId: "board-user", source: "session", isInstanceAdmin: true, companyIds: [companyId] });
    expect((await request(board).post(`/api/companies/${companyId}/autonomy-windows`).send({ issueIds: ["AUT-99"] })).status).toBe(404);
    expect((await request(board).post(`/api/companies/${companyId}/autonomy-windows`).send({ issueIds: ["AUT-1"], hours: 25 })).status).toBe(400);
  });
});
