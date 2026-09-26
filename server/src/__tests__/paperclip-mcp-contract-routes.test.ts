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

const ISSUE_COUNT = 80;

describeEmbeddedPostgres("hosted Paperclip MCP error and paging contract", () => {
  const ctx = useEmbeddedPostgres("paperclip-hosted-mcp-contract-");
  let server: Server;
  let origin = "";
  let actor: Actor = { type: "none", source: "none" };
  let seeded: { companyId: string; otherCompanyId: string; agentId: string; issueId: string };

  beforeAll(async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "MCP contract");
    const other = await seedCompanyWithBoardAccess(ctx.db, "MCP contract other");
    const agentId = randomUUID();
    await ctx.db
      .insert(agents)
      .values({ id: agentId, companyId: company.companyId, name: "Worker", role: "general" });

    const issueRows = Array.from({ length: ISSUE_COUNT }, (_, index) => ({
      id: randomUUID(),
      companyId: company.companyId,
      title: `Contract issue ${index}`,
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    }));
    await ctx.db.insert(issues).values(issueRows);

    seeded = {
      companyId: company.companyId,
      otherCompanyId: other.companyId,
      agentId,
      issueId: issueRows[0].id,
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

  type ToolResult = {
    isError?: boolean;
    content?: Array<{ text: string }>;
    _meta?: Record<string, unknown>;
  };

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    toolsets?: string,
  ) {
    actor = {
      type: "agent",
      source: "agent_key",
      agentId: seeded.agentId,
      companyId: seeded.companyId,
      runId: randomUUID(),
    };
    const query = toolsets ? `?toolsets=${encodeURIComponent(toolsets)}` : "";
    const response = await fetch(`${origin}/api/mcp/paperclip${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer run-key",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = (await response.json()) as { result?: ToolResult; error?: unknown };
    if (!body.result) throw new Error(`no result: ${JSON.stringify(body)}`);
    return body.result;
  }

  it("pages the curated issue listing instead of returning the whole board", async () => {
    const result = await callTool("paperclipListIssues", {});

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content![0]!.text) as unknown[];
    expect(payload).toHaveLength(25);
    const compact = await callTool("paperclipListIssues", { limit: 5, view: "compact" });
    expect(JSON.parse(compact.content![0]!.text)).toHaveLength(5);
  });

  it("returns exactly one issue for limit 1", async () => {
    const result = await callTool("paperclipListIssues", { limit: 1 });

    expect(JSON.parse(result.content![0]!.text)).toHaveLength(1);
  });

  it("flags a 404 from the REST API as an MCP error with the status in _meta", async () => {
    const result = await callTool("paperclipGetIssue", { issueId: randomUUID() });

    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ "paperclip/httpStatus": 404 });
    expect(result.content![0]!.text).toContain("404");
  });

  it("flags a 403 from the REST API as an MCP error with the status in _meta", async () => {
    const result = await callTool(
      "paperclipGetIssueCount",
      { companyId: seeded.otherCompanyId },
      "extended",
    );

    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ "paperclip/httpStatus": 403 });
  });

  it("flags a 400 from the REST API as an MCP error with the status in _meta", async () => {
    const result = await callTool("paperclipApiRequest", {
      method: "GET",
      path: `/companies/${seeded.companyId}/issues?limit=abc`,
    });

    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ "paperclip/httpStatus": 400 });
    expect(result.content![0]!.text).toContain("limit must be a positive integer");
  });

  it("flags a bad argument as an MCP error without inventing a status", async () => {
    const result = await callTool("paperclipGetIssue", {});

    expect(result.isError).toBe(true);
    expect(result._meta).toBeUndefined();
    expect(result.content![0]!.text).toBe("issueId: expected string, received undefined");
  });

  it("keeps a successful call unflagged", async () => {
    const result = await callTool("paperclipGetIssue", { issueId: seeded.issueId });

    expect(result.isError).toBeUndefined();
    expect(result._meta).toBeUndefined();
    expect(JSON.parse(result.content![0]!.text)).toMatchObject({ id: seeded.issueId });
  });
});
