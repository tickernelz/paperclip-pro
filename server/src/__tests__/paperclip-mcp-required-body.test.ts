
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  agents,
  companySkillComments,
  companySkills,
  connectionGrants,
  toolApplications,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { companySkillRoutes } from "../routes/company-skills.js";
import { paperclipMcpRoutes } from "../routes/paperclip-mcp.js";
import { toolAccessRoutes } from "../routes/tool-access.js";
import {
  describeEmbeddedPostgres,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

type Actor = Express.Request["actor"];

type RpcResult = {
  isError?: boolean;
  content?: Array<{ text: string }>;
  _meta?: Record<string, unknown>;
};

function httpStatus(result: RpcResult): number {
  return typeof result._meta?.["paperclip/httpStatus"] === "number"
    ? (result._meta["paperclip/httpStatus"] as number)
    : 200;
}

describeEmbeddedPostgres("hosted Paperclip MCP required-body tools", () => {
  const ctx = useEmbeddedPostgres("paperclip-mcp-required-body-");
  let server: Server;
  let origin = "";
  let actor: Actor = { type: "none", source: "none" };
  let seeded: {
    companyId: string;
    userId: string;
    agentId: string;
    skillId: string;
    commentId: string;
    connectionId: string;
    grantId: string;
  };

  beforeAll(async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "MCP required body");
    const agentId = randomUUID();
    await ctx.db
      .insert(agents)
      .values({ id: agentId, companyId: company.companyId, name: "Worker", role: "general" });

    const [skill] = await ctx.db
      .insert(companySkills)
      .values({
        companyId: company.companyId,
        key: "required-body-skill",
        slug: "required-body-skill",
        name: "Required body skill",
        markdown: "# required body",
      })
      .returning();
    const [comment] = await ctx.db
      .insert(companySkillComments)
      .values({
        companyId: company.companyId,
        companySkillId: skill!.id,
        authorAgentId: agentId,
        body: "original",
      })
      .returning();
    const [application] = await ctx.db
      .insert(toolApplications)
      .values({ companyId: company.companyId, name: "Required body app", type: "rest_api", status: "active" })
      .returning();
    const [connection] = await ctx.db
      .insert(toolConnections)
      .values({
        companyId: company.companyId,
        applicationId: application!.id,
        name: "Required body connection",
        uid: `required-body/${randomUUID()}`,
        transport: "rest_api",
        authKind: "none",
        status: "active",
        enabled: true,
        config: {},
        transportConfig: {},
        healthStatus: "ok",
      })
      .returning();
    const [grant] = await ctx.db
      .insert(connectionGrants)
      .values({
        companyId: company.companyId,
        connectionId: connection!.id,
        kind: "organization",
        credentialSecretRefs: [],
        status: "active",
        isDefault: true,
      })
      .returning();

    seeded = {
      companyId: company.companyId,
      userId: company.userId,
      agentId,
      skillId: skill!.id,
      commentId: comment!.id,
      connectionId: connection!.id,
      grantId: grant!.id,
    };

    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    api.use(paperclipMcpRoutes(ctx.db));
    api.use(companySkillRoutes(ctx.db));
    api.use(toolAccessRoutes(ctx.db, {} as never));
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

  async function callTool(name: string, args: Record<string, unknown>): Promise<RpcResult> {
    const response = await fetch(`${origin}/api/mcp/paperclip?toolsets=core,extended`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer run-key",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = (await response.json()) as { result?: RpcResult };
    if (!body.result) throw new Error(`no result: ${JSON.stringify(body)}`);
    return body.result;
  }

  it("carries the required body field of an update route", async () => {
    actor = {
      type: "agent",
      source: "agent_key",
      agentId: seeded.agentId,
      companyId: seeded.companyId,
    };

    const result = await callTool("paperclipUpdateSkillComment", {
      companyId: seeded.companyId,
      skillId: seeded.skillId,
      commentId: seeded.commentId,
      body: "updated through the generated tool",
    });

    expect(httpStatus(result)).toBe(200);
    const payload = JSON.parse(result.content![0]!.text) as { body: string };
    expect(payload.body).toBe("updated through the generated tool");
  });

  it("carries the required body field of a body-less registry route", async () => {
    actor = {
      type: "agent",
      source: "agent_key",
      agentId: seeded.agentId,
      companyId: seeded.companyId,
    };

    const result = await callTool("paperclipSetToolConnectionGrantMember", {
      connectionId: seeded.connectionId,
      grantId: seeded.grantId,
      memberUserIds: [seeded.userId],
    });

    expect(httpStatus(result)).not.toBe(400);
    expect(result.content![0]!.text).not.toContain("Validation error");
    expect(result.content![0]!.text).not.toContain("expected array");
  });
});
