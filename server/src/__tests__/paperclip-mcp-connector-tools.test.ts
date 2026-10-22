import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agents, heartbeatRuns, issues } from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { paperclipMcpRoutes } from "../routes/paperclip-mcp.js";
import { toolAccessService } from "../services/tool-access.js";
import {
  describeEmbeddedPostgres,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

type Actor = Express.Request["actor"];

describeEmbeddedPostgres("Paperclip MCP connector tools", () => {
  const ctx = useEmbeddedPostgres("paperclip-mcp-connectors-");
  let server: Server;
  let origin = "";
  let actor: Actor = { type: "none", source: "none" };
  let seeded: { companyId: string; agentId: string; runId: string; issueId: string; userId: string };

  beforeAll(async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "MCP connectors");
    const agentId = randomUUID();
    await ctx.db.insert(agents).values({ id: agentId, companyId: company.companyId, name: "Worker", role: "general" });
    const issueId = randomUUID();
    await ctx.db.insert(issues).values({
      id: issueId,
      companyId: company.companyId,
      title: "Drive the user browser",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    const runId = randomUUID();
    await ctx.db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company.companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: { issueId },
    });
    seeded = { companyId: company.companyId, agentId, runId, issueId, userId: company.userId };

    const access = toolAccessService(ctx.db);
    const boardActor = { actorType: "user" as const, actorId: company.userId };
    const connected = await access.connectGalleryApp(company.companyId, { galleryKey: "local-browser" }, boardActor);
    await access.finishGalleryAppConnection(
      company.companyId,
      connected.connectionId,
      { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: { agentIds: [agentId] } },
      boardActor,
    );

    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    api.use(paperclipMcpRoutes(ctx.db));
    app.use("/api", api);
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || !address) throw new Error("no test server address");
    origin = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function runActor(): Actor {
    return {
      type: "agent",
      source: "agent_jwt",
      agentId: seeded.agentId,
      agentRole: "general",
      agentStatus: "running",
      companyId: seeded.companyId,
      runId: seeded.runId,
      onBehalfOfUserId: seeded.userId,
    };
  }

  async function rpc(body: Record<string, unknown>) {
    const response = await fetch(`${origin}/api/mcp/paperclip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer run-key",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        result?: { isError?: boolean; content?: Array<{ text: string }>; tools?: Array<{ name: string; inputSchema?: unknown }> };
      },
    };
  }

  it("advertises the paired-browser tools to the run that holds the connection", async () => {
    actor = runActor();
    const { body } = await rpc({ method: "tools/list" });
    const tools = body.result!.tools!;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("local_browser_sessions");
    expect(names).toContain("local_browser_snapshot");
    const snapshot = tools.find((tool) => tool.name === "local_browser_snapshot");
    expect(JSON.stringify(snapshot!.inputSchema)).toContain("selector");
  });

  it("answers a browser call with the connector result instead of an unknown tool", async () => {
    actor = runActor();
    const { body } = await rpc({
      method: "tools/call",
      params: { name: "local_browser_sessions", arguments: {} },
    });
    expect(body.result!.isError, body.result!.content?.[0]?.text).toBeFalsy();
    expect(body.result!.content![0]!.text).toContain("sessions");
  });

  it("reports the pairing hint when the run asks for a page with no browser connected", async () => {
    actor = runActor();
    const { body } = await rpc({
      method: "tools/call",
      params: { name: "local_browser_snapshot", arguments: { selector: "main" } },
    });
    expect(body.result!.isError).toBe(true);
    expect(body.result!.content![0]!.text.toLowerCase()).toContain("pair");
  });

  it("hides the browser tools from a key-authenticated run that holds no run credential", async () => {
    actor = { ...runActor(), source: "agent_key", runId: undefined } as Actor;
    const { body } = await rpc({ method: "tools/list" });
    expect(body.result!.tools!.map((tool) => tool.name)).not.toContain("local_browser_sessions");
  });
});
