import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres includeConversations route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BOARD_USER = "board-owner";
const OTHER_BOARD_USER = "board-other";

type Actor = Express.Request["actor"];

type ListRow = { id: string; title: string };

const WORK_ITEMS = ["Ship the release", "Review the audit", "Answer the customer"];

describeEmbeddedPostgres("issue list includeConversations union", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const companyId = randomUUID();
  const workerAgentId = randomUUID();
  const partnerAgentId = randomUUID();
  const rivalAgentId = randomUUID();
  const workIssueIds = [randomUUID(), randomUUID(), randomUUID()];
  const ownAgentConversationId = randomUUID();
  const ownUserConversationId = randomUUID();
  const rivalAgentConversationId = randomUUID();
  const rivalUserConversationId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-include-conversations-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({
      id: companyId,
      name: "Conversations",
      issuePrefix: `C${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await seedBoardMember(BOARD_USER);
    await seedBoardMember(OTHER_BOARD_USER);
    await db.insert(agents).values([
      { id: workerAgentId, companyId, name: "Worker", role: "general" },
      { id: partnerAgentId, companyId, name: "Partner", role: "general" },
      { id: rivalAgentId, companyId, name: "Rival", role: "general" },
    ]);
    await db.insert(issues).values([
      ...workIssueIds.map((id, index) => ({
        id,
        companyId,
        title: WORK_ITEMS[index]!,
        status: "todo" as const,
        priority: "medium" as const,
      })),
      conversation({
        id: ownAgentConversationId,
        title: "Thread the worker owns",
        conversationAgentId: workerAgentId,
        conversationUserId: BOARD_USER,
      }),
      conversation({
        id: ownUserConversationId,
        title: "Thread the owner started",
        conversationAgentId: partnerAgentId,
        conversationUserId: BOARD_USER,
      }),
      conversation({
        id: rivalAgentConversationId,
        title: "Thread the rival owns",
        conversationAgentId: rivalAgentId,
        conversationUserId: OTHER_BOARD_USER,
      }),
      conversation({
        id: rivalUserConversationId,
        title: "Thread the other owner started",
        conversationAgentId: partnerAgentId,
        conversationUserId: OTHER_BOARD_USER,
      }),
    ]);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function conversation(input: {
    id: string;
    title: string;
    conversationAgentId: string;
    conversationUserId: string;
  }) {
    return {
      id: input.id,
      companyId,
      title: input.title,
      status: "in_review" as const,
      priority: "medium" as const,
      assigneeAgentId: input.conversationAgentId,
      conversationAgentId: input.conversationAgentId,
      conversationUserId: input.conversationUserId,
      conversationState: "waiting" as const,
    };
  }

  async function seedBoardMember(userId: string) {
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId: userId,
      membershipRole: "owner",
      grantedByUserId: null,
    });
  }

  function createApp(actor: Actor) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { actor?: Actor }).actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return app;
  }

  function boardActor(userId: string): Actor {
    return {
      type: "board",
      source: "cloud_tenant",
      userId,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false,
    };
  }

  function agentActor(agentId: string): Actor {
    return {
      type: "agent",
      source: "agent_key",
      agentId,
      companyId,
      runId: randomUUID(),
    };
  }

  async function list(
    actor: Actor,
    query: Record<string, string> = {},
  ): Promise<ListRow[]> {
    const res = await request(createApp(actor))
      .get(`/api/companies/${companyId}/issues`)
      .query({ limit: "50", ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ListRow[];
  }

  const titles = (rows: ListRow[]) => rows.map((row) => row.title).sort();

  it("returns only the normal work items when the flag is absent", async () => {
    expect(titles(await list(boardActor(BOARD_USER)))).toEqual([...WORK_ITEMS].sort());
    expect(titles(await list(agentActor(workerAgentId)))).toEqual([...WORK_ITEMS].sort());
  });

  it("adds a board user's own threads to the work items", async () => {
    const without = await list(boardActor(BOARD_USER));
    const with_ = await list(boardActor(BOARD_USER), { includeConversations: "true" });
    expect(titles(with_)).toEqual(
      [...WORK_ITEMS, "Thread the owner started", "Thread the worker owns"].sort(),
    );
    expect(with_.filter((row) => without.some((base) => base.id === row.id))).toEqual(without);
  });

  it("adds only an agent's own thread to the work items", async () => {
    const without = await list(agentActor(workerAgentId));
    const with_ = await list(agentActor(workerAgentId), { includeConversations: "true" });
    expect(titles(with_)).toEqual([...WORK_ITEMS, "Thread the worker owns"].sort());
    expect(with_.filter((row) => without.some((base) => base.id === row.id))).toEqual(without);
  });

  it("never hands either caller another actor's thread", async () => {
    for (const actor of [boardActor(BOARD_USER), agentActor(workerAgentId)]) {
      const ids = (await list(actor, { includeConversations: "true" })).map((row) => row.id);
      expect(ids).not.toContain(rivalAgentConversationId);
      expect(ids).not.toContain(rivalUserConversationId);
    }
  });

  it("keeps a search spanning the work items and the caller's own threads", async () => {
    const rows = await list(boardActor(BOARD_USER), {
      includeConversations: "true",
      q: "Thread",
    });
    expect(titles(rows)).toEqual(
      ["Thread the owner started", "Thread the worker owns"].sort(),
    );
  });
});
