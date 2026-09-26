import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agents, issues, principalPermissionGrants } from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { accessRoutes } from "../routes/access.js";
import { issueRoutes } from "../routes/issues.js";
import { paperclipMcpRoutes } from "../routes/paperclip-mcp.js";
import {
  describeEmbeddedPostgres,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

type Actor = Express.Request["actor"];

describeEmbeddedPostgres("server-hosted Paperclip MCP endpoint", () => {
  const ctx = useEmbeddedPostgres("paperclip-hosted-mcp-");
  let server: Server;
  let origin = "";
  let actor: Actor = { type: "none", source: "none" };
  let seeded: {
    companyId: string;
    otherCompanyId: string;
    agentId: string;
    ceoAgentId: string;
    issueId: string;
  };

  beforeAll(async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Hosted MCP");
    const other = await seedCompanyWithBoardAccess(ctx.db, "Hosted MCP other");
    const agentId = randomUUID();
    const ceoAgentId = randomUUID();
    await ctx.db.insert(agents).values([
      { id: agentId, companyId: company.companyId, name: "Worker", role: "general" },
      { id: ceoAgentId, companyId: company.companyId, name: "Chief", role: "ceo" },
    ]);
    const issueId = randomUUID();
    await ctx.db.insert(issues).values({
      id: issueId,
      companyId: company.companyId,
      title: "Hosted MCP round trip",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    seeded = {
      companyId: company.companyId,
      otherCompanyId: other.companyId,
      agentId,
      ceoAgentId,
      issueId,
    };

    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    api.use(paperclipMcpRoutes(ctx.db));
    api.use(issueRoutes(ctx.db, {} as never));
    api.use(
      accessRoutes(ctx.db, {
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        bindHost: "127.0.0.1",
        allowedHostnames: [],
      }),
    );
    app.use("/api", api);
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || !address) throw new Error("no test server address");
    origin = `http://127.0.0.1:${address.port}`;
  }, 40_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function agentActor(agentId: string): Actor {
    return {
      type: "agent",
      source: "agent_key",
      agentId,
      companyId: seeded.companyId,
      runId: randomUUID(),
    };
  }

  type RpcResponse = {
    result?: {
      isError?: boolean;
      content?: Array<{ text: string }>;
      tools?: Array<{ name: string }>;
      nextCursor?: string;
      serverInfo?: { name: string };
      capabilities?: { tools?: unknown };
    };
    error?: { code: number; message: string };
  };

  async function rpc(
    body: Record<string, unknown>,
    opts: { authorized?: boolean; toolsets?: string } = {},
  ) {
    const query = opts.toolsets ? `?toolsets=${encodeURIComponent(opts.toolsets)}` : "";
    const response = await fetch(`${origin}/api/mcp/paperclip${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(opts.authorized === false ? {} : { Authorization: "Bearer run-key" }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    });
    return { status: response.status, body: (await response.json()) as RpcResponse };
  }

  it("rejects an unauthenticated caller", async () => {
    actor = { type: "none", source: "none" };
    expect((await rpc({ method: "tools/list" })).status).toBe(401);
  });

  it("rejects a caller that is not an agent", async () => {
    actor = { type: "board", source: "session", userId: "board-user" };
    expect((await rpc({ method: "tools/list" })).status).toBe(403);
  });

  it("rejects an agent actor without a bearer credential", async () => {
    actor = agentActor(seeded.agentId);
    expect((await rpc({ method: "tools/list" }, { authorized: false })).status).toBe(401);
  });

  it("answers initialize without touching the database", async () => {
    actor = agentActor(seeded.agentId);
    const { status, body } = await rpc({ method: "initialize" });
    expect(status).toBe(200);
    expect(body.result!.serverInfo!.name).toBe("paperclip");
    expect(body.result!.capabilities!.tools).toBeDefined();
  });

  it("refuses the transport methods it does not implement", async () => {
    const get = await fetch(`${origin}/api/mcp/paperclip`);
    expect(get.status).toBe(405);
  });

  it("hides board-authority tools from an agent without management authority", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
    const names = body.result!.tools!.map((tool) => tool.name);
    expect(names).toContain("paperclipGetIssue");
    expect(names).not.toContain("paperclipGetIssueChatBinding");
  });

  it("exposes only the board tools an agent guard really reaches to a ceo agent", async () => {
    actor = agentActor(seeded.ceoAgentId);
    const { body } = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
    const names = body.result!.tools!.map((tool) => tool.name);
    expect(names).toContain("paperclipListManagedAgentProfiles");
    expect(names).not.toContain("paperclipGetIssueChatBinding");
  });

  it("defaults to the core toolset when none is requested", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({ method: "tools/list" });
    const names = body.result!.tools!.map((tool) => tool.name);
    expect(names).toContain("paperclipGetIssue");
    expect(names).not.toContain("paperclipGetIssueActivity");
  });

  it("calls a tool through the REST API with the caller's credentials", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({
      method: "tools/call",
      params: { name: "paperclipGetIssue", arguments: { issueId: seeded.issueId } },
    });
    expect(body.result!.isError).toBeFalsy();
    const payload = JSON.parse(body.result!.content![0]!.text) as { id: string; title: string };
    expect(payload.id).toBe(seeded.issueId);
    expect(payload.title).toBe("Hosted MCP round trip");
  });

  it("denies a tool call that reaches across companies", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc(
      {
        method: "tools/call",
        params: {
          name: "paperclipGetIssueCount",
          arguments: { companyId: seeded.otherCompanyId },
        },
      },
      { toolsets: "core,extended" },
    );
    const payload = JSON.parse(body.result!.content![0]!.text) as { status: number };
    expect(payload.status).toBe(403);
  });

  it("refuses a tool the selected toolset does not expose", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({
      method: "tools/call",
      params: { name: "paperclipGetIssueChatBinding", arguments: { issueId: seeded.issueId } },
    });
    expect(body.result!.isError).toBe(true);
    expect(body.result!.content![0]!.text).toContain("unavailable");
  });

  it("reports an unknown JSON-RPC method", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({ method: "resources/list" });
    expect(body.error!.code).toBe(-32601);
  });

  it("hides a board tool the caller's grants cannot reach", async () => {
    actor = agentActor(seeded.ceoAgentId);
    const { body } = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
    const names = body.result!.tools!.map((tool) => tool.name);
    expect(names).not.toContain("paperclipListMembers");
    const call = await rpc(
      {
        method: "tools/call",
        params: { name: "paperclipListMembers", arguments: { companyId: seeded.companyId } },
      },
      { toolsets: "core,extended" },
    );
    const payload = JSON.parse(call.body.result!.content![0]!.text) as { status: number };
    expect(payload.status).toBe(403);
  });

  it("still refuses a pruned board tool reached through paperclipApiRequest", async () => {
    actor = agentActor(seeded.ceoAgentId);
    const listed = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
    const names = listed.body.result!.tools!.map((tool) => tool.name);
    expect(names).not.toContain("paperclipListIssueFeedbackTraces");

    const hidden = await rpc(
      {
        method: "tools/call",
        params: {
          name: "paperclipApiRequest",
          arguments: {
            method: "GET",
            path: `/companies/${seeded.companyId}/members`,
          },
        },
      },
      { toolsets: "core,extended" },
    );
    const hiddenPayload = JSON.parse(hidden.body.result!.content![0]!.text) as { status: number };
    expect(hiddenPayload.status).toBe(403);

    expect(names).toContain("paperclipGetUserDirectory");
    const advertised = await rpc(
      {
        method: "tools/call",
        params: {
          name: "paperclipGetUserDirectory",
          arguments: { companyId: seeded.companyId },
        },
      },
      { toolsets: "core,extended" },
    );
    expect(advertised.body.result!.isError).toBeFalsy();
    const advertisedPayload = JSON.parse(advertised.body.result!.content![0]!.text) as {
      users: unknown[];
    };
    expect(Array.isArray(advertisedPayload.users)).toBe(true);
  });

  it("advertises the board tool whose permission key the caller holds", async () => {
    await ctx.db.insert(principalPermissionGrants).values({
      id: randomUUID(),
      companyId: seeded.companyId,
      principalType: "agent",
      principalId: seeded.ceoAgentId,
      permissionKey: "users:manage_permissions",
    });
    actor = agentActor(seeded.ceoAgentId);
    const { body } = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
    const names = body.result!.tools!.map((tool) => tool.name);
    expect(names).toContain("paperclipListMembers");
  });

  it("pages tools/list so the full set is reachable without one huge response", async () => {
    actor = agentActor(seeded.ceoAgentId);
    const previousPageSize = process.env.PAPERCLIP_MCP_PAGE_SIZE;
    process.env.PAPERCLIP_MCP_PAGE_SIZE = "10";
    try {
      const names: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (let guard = 0; guard < 200; guard += 1) {
        const { body } = await rpc(
          { method: "tools/list", params: cursor ? { cursor } : {} },
          { toolsets: "core,extended" },
        );
        const page = body.result!;
        pages += 1;
        names.push(...page.tools!.map((tool) => tool.name));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      delete process.env.PAPERCLIP_MCP_PAGE_SIZE;
      const single = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
      const full = single.body.result!.tools!.map((tool) => tool.name);
      expect(pages).toBeGreaterThan(1);
      expect(new Set(names).size).toBe(names.length);
      expect([...names].sort()).toEqual([...full].sort());
    } finally {
      if (previousPageSize === undefined) delete process.env.PAPERCLIP_MCP_PAGE_SIZE;
      else process.env.PAPERCLIP_MCP_PAGE_SIZE = previousPageSize;
    }
  });

  it("rejects a tools/list cursor that is not a page offset", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({ method: "tools/list", params: { cursor: "nonsense" } });
    expect(body.error!.code).toBe(-32602);
  });

  it("rejects a tools/list cursor past the end of the listing", async () => {
    actor = agentActor(seeded.agentId);
    const { body } = await rpc({
      method: "tools/list",
      params: { cursor: Buffer.from("99999", "utf8").toString("base64url") },
    });
    expect(body.error!.code).toBe(-32602);
  });

  it("hides another agent's conversations from the issue list", async () => {
    const otherAgentId = randomUUID();
    await ctx.db.insert(agents).values({
      id: otherAgentId,
      companyId: seeded.companyId,
      name: "Other worker",
      role: "general",
    });
    const foreignIssueId = randomUUID();
    await ctx.db.insert(issues).values({
      id: foreignIssueId,
      companyId: seeded.companyId,
      title: "Another agent's conversation",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: otherAgentId,
      conversationAgentId: otherAgentId,
      conversationUserId: "other-user",
      conversationState: "waiting",
    });
    const ownIssueId = randomUUID();
    await ctx.db.insert(issues).values({
      id: ownIssueId,
      companyId: seeded.companyId,
      title: "My own conversation",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: seeded.agentId,
      conversationAgentId: seeded.agentId,
      conversationUserId: "other-user",
      conversationState: "waiting",
    });
    actor = agentActor(seeded.agentId);
    const { body } = await rpc(
      {
        method: "tools/call",
        params: {
          name: "paperclipListIssues",
          arguments: { companyId: seeded.companyId, includeConversations: true },
        },
      },
      { toolsets: "core,extended" },
    );
    expect(body.result!.isError).toBeFalsy();
    const rows = JSON.parse(body.result!.content![0]!.text) as Array<{
      id: string;
      conversationAgentId?: string | null;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((issue) => issue.id === foreignIssueId)).toBe(false);
    expect(rows.some((issue) => issue.id === ownIssueId)).toBe(true);
    expect(
      rows.every((issue) => !issue.conversationAgentId || issue.conversationAgentId === seeded.agentId),
    ).toBe(true);
  });

  it("hides other users' conversations from a board caller", async () => {
    actor = {
      type: "board",
      source: "session",
      userId: "board-user",
      companyIds: [seeded.companyId],
      memberships: [{ companyId: seeded.companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false,
    };
    const list = await fetch(
      `${origin}/api/companies/${seeded.companyId}/issues?includeConversations=true`,
      { headers: { Authorization: "Bearer run-key" } },
    );
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<{
      id: string;
      conversationUserId?: string | null;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((issue) => issue.title === "Another agent's conversation")).toBe(false);
    expect(
      rows.every(
        (issue) => !issue.conversationUserId || issue.conversationUserId === "board-user",
      ),
    ).toBe(true);
  });
});
