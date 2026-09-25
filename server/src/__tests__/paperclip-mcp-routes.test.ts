import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agents, issues } from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
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

  it("exposes board-authority tools to a ceo agent", async () => {
    actor = agentActor(seeded.ceoAgentId);
    const { body } = await rpc({ method: "tools/list" }, { toolsets: "core,extended" });
    const names = body.result!.tools!.map((tool) => tool.name);
    expect(names).toContain("paperclipGetIssueChatBinding");
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
});
