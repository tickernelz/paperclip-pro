import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issues,
  webPushSubscriptions,
} from "@tickernelz/paperclip-pro-db";
import { buildUserMentionHref, type LiveEvent, type NotificationKind } from "@tickernelz/paperclip-pro-shared";
import { errorHandler } from "../middleware/index.js";
import { notificationRoutes } from "../routes/notifications.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { parseNotificationTrigger } from "../services/notifications/classify.js";
import { loadNotificationContext } from "../services/notifications/context.js";
import { createNotificationDispatcher } from "../services/notifications/dispatcher.js";
import type { WebPushRuntime, WebPushSender, WebPushTarget } from "../services/notifications/web-push.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function fakeSender(statusByEndpoint: Record<string, number> = {}) {
  const sent: Array<{ target: WebPushTarget; payload: string }> = [];
  const sender: WebPushSender = async (target, payload) => {
    const status = statusByEndpoint[target.endpoint];
    if (status) throw Object.assign(new Error(`push failed ${status}`), { statusCode: status });
    sent.push({ target, payload });
  };
  return { sender, sent };
}

describeEmbeddedPostgres("notification dispatch", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-notifications-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(webPushSubscriptions);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const prefix = `N${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({ id: companyId, name: `Notify ${companyId}`, issuePrefix: prefix });
    await db.insert(companyMemberships).values(
      ["owner", "commenter", "mentioned", "bystander"].map((principalId) => ({
        companyId,
        principalType: "user",
        principalId,
        status: "active",
        membershipRole: "operator",
      })),
    );
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Wira",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: false } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Ship notifications",
      identifier: `${prefix}-1`,
      status: "in_progress",
      priority: "medium",
      createdByUserId: "owner",
      assigneeAgentId: agentId,
    });
    await db.insert(issueComments).values({ companyId, issueId, authorUserId: "commenter", body: "Looks good so far" });
    const [agentComment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId,
        authorAgentId: agentId,
        body: `Need eyes from [@Mentioned](${buildUserMentionHref("mentioned")}) and [@Out](${buildUserMentionHref("outsider")})`,
      })
      .returning();
    return { companyId, agentId, issueId, prefix, commentId: agentComment!.id };
  }

  function commentEvent(seeded: Awaited<ReturnType<typeof seed>>): LiveEvent {
    return {
      id: 1,
      companyId: seeded.companyId,
      type: "activity.logged",
      createdAt: new Date().toISOString(),
      payload: {
        actorType: "agent",
        actorId: seeded.agentId,
        agentId: seeded.agentId,
        action: "issue.comment_added",
        entityType: "issue",
        entityId: seeded.issueId,
        details: { commentId: seeded.commentId, bodySnippet: "Need eyes" },
      },
    };
  }

  async function subscribe(userId: string, endpoint: string, kinds: NotificationKind[]) {
    await db.insert(webPushSubscriptions).values({ userId, endpoint, p256dh: "p256dh-key", auth: "auth-key", kinds });
  }

  it("resolves comment recipients from the issue inbox audience and members mentioned in the comment", async () => {
    const seeded = await seed();
    const trigger = parseNotificationTrigger(commentEvent(seeded))!;
    const context = await loadNotificationContext(db, trigger);
    expect(context).toMatchObject({
      issuePrefix: seeded.prefix,
      agentName: "Wira",
      issue: { identifier: `${seeded.prefix}-1`, title: "Ship notifications" },
    });
    expect([...context!.issueInboxUserIds].sort()).toEqual(["commenter", "owner"]);
    expect([...context!.mentionedUserIds].sort()).toEqual(["mentioned", "outsider"]);
    expect([...context!.boardUserIds].sort()).toEqual(["bystander", "commenter", "mentioned", "owner"]);
  });

  it("publishes once, pushes only to subscriptions enabling the kind, and prunes expired endpoints", async () => {
    const seeded = await seed();
    await subscribe("owner", "https://push.example/owner-comment", ["comment"]);
    await subscribe("owner", "https://push.example/owner-approval-only", ["approval"]);
    await subscribe("commenter", "https://push.example/commenter-gone", ["comment"]);
    await subscribe("mentioned", "https://push.example/mentioned-flaky", ["comment", "approval"]);
    await subscribe("bystander", "https://push.example/bystander", ["comment"]);
    const { sender, sent } = fakeSender({
      "https://push.example/commenter-gone": 410,
      "https://push.example/mentioned-flaky": 500,
    });
    const published: LiveEvent[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(seeded.companyId, (event) => {
      if (event.type === "notification.created") published.push(event);
    });
    try {
      const dispatcher = createNotificationDispatcher({ db, sender: () => sender });
      await dispatcher.handleEvent(commentEvent(seeded));
      await dispatcher.handleEvent(commentEvent(seeded));
    } finally {
      unsubscribe();
    }

    expect(published).toHaveLength(1);
    const payload = published[0]!.payload as { recipientUserIds: string[]; notification: { key: string; url: string } };
    expect([...payload.recipientUserIds].sort()).toEqual(["commenter", "mentioned", "owner"]);
    expect(payload.notification).toMatchObject({ key: `comment:${seeded.commentId}`, url: `/${seeded.prefix}/issues/${seeded.prefix}-1` });

    expect(sent.map((entry) => entry.target.endpoint)).toEqual(["https://push.example/owner-comment"]);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ notification: { kind: "comment", key: `comment:${seeded.commentId}` } });

    const rows = await db.select().from(webPushSubscriptions);
    const byEndpoint = new Map(rows.map((row) => [row.endpoint, row]));
    expect(byEndpoint.has("https://push.example/commenter-gone")).toBe(false);
    expect(byEndpoint.get("https://push.example/mentioned-flaky")?.failureCount).toBe(1);
    expect(byEndpoint.get("https://push.example/owner-comment")?.lastSuccessAt).toBeInstanceOf(Date);
    expect(byEndpoint.get("https://push.example/owner-approval-only")?.lastSuccessAt).toBeNull();
  });

  describe("routes", () => {
    const owner = { type: "board", userId: "owner", source: "session", isInstanceAdmin: false, companyIds: [] };
    const other = { type: "board", userId: "other", source: "session", isInstanceAdmin: false, companyIds: [] };

    function appFor(actor: Record<string, unknown>, sender: WebPushSender) {
      const runtime: WebPushRuntime = { config: () => ({ enabled: true, publicKey: "public-key" }), sender: () => sender };
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.actor = actor as never;
        next();
      });
      app.use("/api", notificationRoutes(db, runtime));
      app.use(errorHandler);
      return app;
    }

    const subscription = (endpoint: string, kinds: NotificationKind[]) => ({
      endpoint,
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
      kinds,
    });

    it("scopes subscriptions to the calling user", async () => {
      const { sender } = fakeSender();
      const endpoint = "https://push.example/owner-device";
      const put = await request(appFor(owner, sender))
        .put("/api/notifications/web-push/subscription")
        .send(subscription(endpoint, ["comment", "approval"]));
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ endpoint, kinds: ["comment", "approval"], lastSuccessAt: null });

      const foreignDelete = await request(appFor(other, sender))
        .delete("/api/notifications/web-push/subscription")
        .send({ endpoint });
      expect(foreignDelete.status).toBe(204);
      expect(await db.select().from(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint))).toHaveLength(1);

      const ownDelete = await request(appFor(owner, sender))
        .delete("/api/notifications/web-push/subscription")
        .send({ endpoint });
      expect(ownDelete.status).toBe(204);
      expect(await db.select().from(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint))).toHaveLength(0);
    });

    it("rebinds an endpoint to the user who registers it", async () => {
      const { sender } = fakeSender();
      const endpoint = "https://push.example/shared-browser";
      await request(appFor(owner, sender)).put("/api/notifications/web-push/subscription").send(subscription(endpoint, ["comment"]));
      await request(appFor(other, sender)).put("/api/notifications/web-push/subscription").send(subscription(endpoint, ["review"]));
      const rows = await db.select().from(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: "other", kinds: ["review"] });
    });

    it("sends the test push to every subscription of the caller only", async () => {
      await subscribe("owner", "https://push.example/owner-a", ["approval"]);
      await subscribe("owner", "https://push.example/owner-b", []);
      await subscribe("other", "https://push.example/other", ["comment"]);
      const { sender, sent } = fakeSender();
      const res = await request(appFor(owner, sender)).post("/api/notifications/web-push/test");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: 2, failed: 0 });
      expect(sent.map((entry) => entry.target.endpoint).sort()).toEqual(["https://push.example/owner-a", "https://push.example/owner-b"]);
    });

    it("rejects agent callers", async () => {
      const { sender } = fakeSender();
      const res = await request(appFor({ type: "agent", agentId: randomUUID(), companyId: randomUUID(), source: "agent_key" }, sender))
        .get("/api/notifications/web-push/config");
      expect(res.status).toBe(403);
    });

    it("returns the web push config to board users", async () => {
      const { sender } = fakeSender();
      const res = await request(appFor(owner, sender)).get("/api/notifications/web-push/config");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: true, publicKey: "public-key" });
    });
  });
});
