import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agents } from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";
import { paperclipMcpRoutes } from "../routes/paperclip-mcp.js";
import {
  describeEmbeddedPostgres,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

type Actor = Express.Request["actor"];

type RpcResponse = {
  result?: {
    isError?: boolean;
    content?: Array<{ text: string }>;
  };
};

describeEmbeddedPostgres("hosted Paperclip MCP inbox tool", () => {
  const ctx = useEmbeddedPostgres("paperclip-mcp-inbox-");
  let server: Server;
  let origin = "";
  let actor: Actor = { type: "none", source: "none" };
  let seeded: { companyId: string; agentId: string };

  beforeAll(async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "MCP inbox");
    const agentId = randomUUID();
    await ctx.db
      .insert(agents)
      .values({ id: agentId, companyId: company.companyId, name: "Worker", role: "general" });

    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    api.use(paperclipMcpRoutes(ctx.db));
    api.use(agentRoutes(ctx.db));
    app.use("/api", api);
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || !address) throw new Error("no test server address");
    origin = `http://127.0.0.1:${address.port}`;
    seeded = { companyId: company.companyId, agentId };
  }, 40_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function rpc(body: Record<string, unknown>) {
    return fetch(`${origin}/api/mcp/paperclip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer run-key",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    }).then(async (response) => ({ status: response.status, body: (await response.json()) as RpcResponse }));
  }

  it("calls the inbox tool with the userId the route validates", async () => {
    actor = {
      type: "agent",
      source: "agent_key",
      agentId: seeded.agentId,
      companyId: seeded.companyId,
      runId: randomUUID(),
    };

    const { body } = await rpc({
      method: "tools/call",
      params: { name: "paperclipInbox", arguments: { userId: "board-user" } },
    });

    expect(body.result!.isError).toBeFalsy();
    const payload = JSON.parse(body.result!.content![0]!.text) as unknown;
    expect(Array.isArray(payload)).toBe(true);
  });

  it("rejects an inbox call that omits the required userId", async () => {
    actor = {
      type: "agent",
      source: "agent_key",
      agentId: seeded.agentId,
      companyId: seeded.companyId,
      runId: randomUUID(),
    };

    const { body } = await rpc({
      method: "tools/call",
      params: { name: "paperclipInbox", arguments: {} },
    });

    expect(body.result!.content![0]!.text).toContain("userId");
  });

  it("publishes the shared boilerplate notes once on initialize", async () => {
    actor = {
      type: "agent",
      source: "agent_key",
      agentId: seeded.agentId,
      companyId: seeded.companyId,
      runId: randomUUID(),
    };

    const { body } = await rpc({ method: "initialize" });
    const instructions = (body.result as { instructions?: string } | undefined)?.instructions;
    expect(typeof instructions).toBe("string");
    expect(instructions).toContain("Existing route authorization applies.");
    expect(instructions).toContain("Experimental API");
  });
});
