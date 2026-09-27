import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PaperclipApiClient } from "./client.js";
import { routeBodySchemas } from "./route-body-schemas.js";
import { CURATED_OPERATIONS } from "./tool-overrides.js";
import { createToolDefinitions, type ToolDefinition } from "./tools.js";

const COMMENT_OPERATION = "POST /api/issues/{id}/comments";
const ADD_COMMENT_TOOL = "paperclipAddComment";
const DELIVERY_FIELDS = ["deliver", "commentDeliver"];

function isDeliveryField(name: string): boolean {
  return DELIVERY_FIELDS.includes(name);
}

function curatedClient(): PaperclipApiClient {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
    toolsets: ["core"],
    agentRole: null,
  });
}

function curatedTool(name: string): ToolDefinition {
  const tool = createToolDefinitions(curatedClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function publishedProperties(tool: ToolDefinition): Record<string, Record<string, unknown>> {
  const json = z.toJSONSchema(tool.schema, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, Record<string, unknown>>;
  };
  return json.properties ?? {};
}

async function routeCommentBody() {
  const { sites, unresolved } = await routeBodySchemas();
  const site = sites.find((entry) => entry.key === COMMENT_OPERATION);
  if (!site) {
    const names = unresolved
      .filter((entry) => entry.key === COMMENT_OPERATION)
      .map((entry) => `${entry.file}:${entry.line} ${entry.schemaName}`);
    throw new Error(
      `No resolved body validation for ${COMMENT_OPERATION}${
        names.length > 0 ? ` (unresolved: ${names.join(", ")})` : ""
      }`,
    );
  }
  return site;
}

describe("the comment tool and the comment route agree on delivery", () => {
  it("keeps the add-comment operation curated rather than generated", () => {
    expect(CURATED_OPERATIONS[COMMENT_OPERATION]).toBe(ADD_COMMENT_TOOL);
  });

  it("exposes on the published tool every body field the route validates", async () => {
    const site = await routeCommentBody();
    const exposed = publishedProperties(curatedTool(ADD_COMMENT_TOOL));
    const missing = Object.keys(site.schema.properties ?? {}).filter((name) => !(name in exposed));
    expect({
      operation: site.key,
      validatedBy: `${site.schemaName} at ${site.file}:${site.line}`,
      missing,
    }).toEqual({
      operation: site.key,
      validatedBy: `${site.schemaName} at ${site.file}:${site.line}`,
      missing: [],
    });
  });

  it("keeps the published deliver enum identical to the route's", async () => {
    const site = await routeCommentBody();
    const published = publishedProperties(curatedTool(ADD_COMMENT_TOOL)).deliver;
    expect(published).toStrictEqual((site.schema.properties as Record<string, unknown>).deliver);
    expect(published).toMatchObject({ type: "string", enum: ["steer", "queue"] });
  });

  it("leaves deliver optional on both sides so the server resolves the global default", async () => {
    const site = await routeCommentBody();
    const tool = curatedTool(ADD_COMMENT_TOOL);
    const routeRequired = ((site.schema.required as string[] | undefined) ?? []).includes("deliver");
    const toolRequired = tool.schema.shape.deliver?.isOptional() === false;
    expect({ routeRequired, toolRequired }).toEqual({ routeRequired: false, toolRequired: false });
  });

  it("passes the requested mode through to the route instead of resolving it at the tool", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = curatedClient();
    const original = client.requestJson.bind(client);
    client.requestJson = (async (
      method: string,
      path: string,
      options?: { body?: Record<string, unknown> },
    ) => {
      requests.push({ path, body: options?.body ?? {} });
      return original(method, path, options);
    }) as typeof client.requestJson;
    const tool = createToolDefinitions(client).find((candidate) => candidate.name === ADD_COMMENT_TOOL)!;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "c1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    for (const deliver of ["steer", "queue"] as const) {
      await tool.execute({ issueId: "issue-1", body: "ping", deliver });
    }
    await tool.execute({ issueId: "issue-1", body: "ping" });

    expect(requests.map((entry) => entry.body.deliver)).toEqual(["steer", "queue", undefined]);
    expect(requests.every((entry) => entry.path.endsWith("/issues/issue-1/comments"))).toBe(true);
  });

  it("exposes every delivery field the route validates on every curated tool", async () => {
    const { sites } = await routeBodySchemas();
    const tools = new Map(
      createToolDefinitions(curatedClient()).map((tool) => [tool.name, tool]),
    );
    const violations: string[] = [];
    let checked = 0;
    let compared = 0;
    for (const site of sites) {
      const properties = (site.schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const validated = Object.keys(properties).filter(isDeliveryField);
      if (validated.length === 0) continue;
      const toolName = CURATED_OPERATIONS[site.key];
      if (!toolName) continue;
      const tool = tools.get(toolName);
      if (!tool) {
        violations.push(`${site.key} maps to unknown tool ${toolName}`);
        continue;
      }
      const exposed = publishedProperties(tool);
      for (const field of validated) {
        checked += 1;
        if (!(field in exposed)) {
          violations.push(
            `${toolName} (${site.key}) does not expose ${field} validated by ${site.schemaName} at ${site.file}:${site.line}`,
          );
          continue;
        }
        const shaped = Object.keys(properties[field] ?? {}).length > 0;
        if (shaped) compared += 1;
        if (shaped && JSON.stringify(exposed[field]) !== JSON.stringify(properties[field])) {
          violations.push(
            `${toolName} (${site.key}) publishes ${field} as ${JSON.stringify(exposed[field])} but the route validates ${JSON.stringify(properties[field])}`,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(compared).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("tells the agent that a steer request is queued, not refused", () => {
    const description = curatedTool(ADD_COMMENT_TOOL).description;
    expect(description).toContain("deliver to steer or queue");
    expect(description).toContain("board-only");
    expect(description).toContain("queued rather than refused");
    expect(description).toContain("deliveredAs");
    expect(description).toContain("not_requested");
    expect(description).toContain("board_only");
  });
});
