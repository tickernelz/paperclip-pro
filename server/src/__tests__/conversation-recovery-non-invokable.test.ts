import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agentRuntimeState,
  agents,
  authUsers,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { actorMiddleware } from "../middleware/auth.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { heartbeatService } from "../services/heartbeat.js";
import { recoveryService } from "../services/recovery/service.js";
import { undeliveredConversationComments } from "../services/agent-conversations.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("conversation recovery with a non-invokable agent", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-conversation-non-invokable-");
    db = createDb(tempDb.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableAgentChat: true });
  }, 90_000);

  afterEach(async () => {
    await db.delete(issueRecoveryActions);
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await tempDb?.cleanup();
  });

  async function seedConversation(agentStatus: string, userId = `user-${randomUUID()}`) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(authUsers).values({
      id: userId,
      name: "Chat User",
      email: `${userId}@paperclip.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companies).values({
      id: companyId,
      name: "Chat Co",
      issuePrefix: `NI${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Suwandi",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const issue = await issueService(db).create(companyId, {
      title: "Chat with Suwandi",
      conversationAgentId: agentId,
      conversationUserId: userId,
      assigneeAgentId: agentId,
      status: "in_progress",
      conversationState: "active",
    });
    await issueService(db).addComment(issue.id, "Halo, bisa bantu?", { userId }, {
      clientRequestId: randomUUID(),
      authorType: "user",
    });
    await db.update(agents).set({ status: agentStatus }).where(eq(agents.id, agentId));
    return { companyId, agentId, issueId: issue.id, userId };
  }

  function localBoardApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    app.use("/api", issueRoutes(db, { wakeup: async () => null } as never));
    app.use(errorHandler);
    return app;
  }

  function sweep() {
    const heartbeat = heartbeatService(db);
    return recoveryService(db, { enqueueWakeup: heartbeat.wakeup }).reconcileStrandedAssignedIssues();
  }

  it.each(["terminated", "paused", "pending_approval"])(
    "does not error or enqueue on repeated sweeps when the agent is %s",
    async (status) => {
      const seeded = await seedConversation(status);

      const first = await sweep();
      const second = await sweep();

      expect(first.errored).toBe(0);
      expect(second.errored).toBe(0);
      expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, seeded.agentId))).toHaveLength(0);
      expect(await undeliveredConversationComments(db, seeded.companyId, seeded.issueId)).toHaveLength(1);
    },
  );

  it("escalates a conversation with a terminated agent to the board exactly once", async () => {
    const seeded = await seedConversation("terminated");

    const first = await sweep();
    const second = await sweep();

    expect(first.escalated).toBe(1);
    expect(second.escalated).toBe(0);
    const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(issue?.status).toBe("blocked");
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, seeded.issueId))).toHaveLength(1);
    const blocked = await issueService(db).list(seeded.companyId, { attention: "blocked" });
    expect(blocked.map((row) => row.id)).toContain(seeded.issueId);
  });

  it("escalates once for an agent paused by budget and keeps the comment queued", async () => {
    const seeded = await seedConversation("paused");
    await db.update(agents).set({ pauseReason: "budget" }).where(eq(agents.id, seeded.agentId));

    const first = await sweep();
    const second = await sweep();

    expect(first.errored).toBe(0);
    expect(first.escalated).toBe(1);
    expect(second.errored).toBe(0);
    expect(second.escalated).toBe(0);
    const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(issue?.status).toBe("blocked");
    expect(await undeliveredConversationComments(db, seeded.companyId, seeded.issueId)).toHaveLength(1);
  });

  it.each(["paused", "pending_approval"])("keeps a conversation with a %s agent in place and delivers once the agent is invokable", async (status) => {
    const seeded = await seedConversation(status);

    const first = await sweep();
    expect(first.errored).toBe(0);
    expect(first.escalated).toBe(0);
    const [held] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(held?.status).toBe("in_progress");

    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, seeded.agentId));
    const enqueueWakeup = vi.fn(async () => ({ id: randomUUID() }) as never);
    const second = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(second.errored).toBe(0);
    expect(enqueueWakeup).toHaveBeenCalledWith(
      seeded.agentId,
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^conversation-comment:/) }),
    );
  });

  it("rejects a chat message for a terminated agent without storing it", async () => {
    const seeded = await seedConversation("terminated", "local-board");

    const response = await request(localBoardApp())
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Halo lagi", clientRequestId: randomUUID() });

    expect(response.status).toBe(409);
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, seeded.issueId))).toHaveLength(1);
  });

  it("accepts a chat message for a paused agent and keeps it queued for delivery after resume", async () => {
    const seeded = await seedConversation("paused", "local-board");

    const response = await request(localBoardApp())
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Tolong lanjutkan", clientRequestId: randomUUID() });

    expect(response.status).toBe(201);
    expect(await undeliveredConversationComments(db, seeded.companyId, seeded.issueId)).toHaveLength(2);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, seeded.agentId))).toHaveLength(0);
  });
});
