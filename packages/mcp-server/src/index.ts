import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PaperclipApiClient } from "./client.js";
import { hasManagementAuthority, readConfigFromEnv, type PaperclipMcpConfig } from "./config.js";
import { createGeneratedToolDefinitions } from "./generated-tools.js";
import { leanJsonSchema, type JsonSchemaObject } from "./lean-schema.js";
import { createToolDefinitions, type ToolDefinition } from "./tools.js";

export function leanToolListing(tools: ReadonlyArray<ToolDefinition>) {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: leanJsonSchema(
        z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }),
      ) as JsonSchemaObject,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
  };
}

export async function resolveManagementAuthority(
  client: PaperclipApiClient,
  config: PaperclipMcpConfig,
): Promise<boolean> {
  try {
    const actor = await client.requestJson<{ role?: unknown; authorityCapabilities?: unknown }>(
      "GET",
      "/agents/me",
    );
    if (Array.isArray(actor?.authorityCapabilities)) {
      return actor.authorityCapabilities.some(
        (capability) => typeof capability === "string" && capability.startsWith("company:"),
      );
    }
    return hasManagementAuthority(typeof actor?.role === "string" ? actor.role : null);
  } catch {
    return hasManagementAuthority(config.agentRole);
  }
}

export function createPaperclipToolDefinitions(
  client: PaperclipApiClient,
  config: PaperclipMcpConfig,
  management = false,
): ToolDefinition[] {
  const curated = createToolDefinitions(client);
  const curatedNames = new Set(curated.map((tool) => tool.name));
  const generated = createGeneratedToolDefinitions(client, config.toolsets, management).filter(
    (tool) => !curatedNames.has(tool.name),
  );
  return [...curated, ...generated];
}

export function createPaperclipMcpServer(
  config: PaperclipMcpConfig = readConfigFromEnv(),
  management = false,
) {
  const server = new McpServer({
    name: "paperclip",
    version: "0.1.0",
  });

  const client = new PaperclipApiClient(config);
  const tools = createPaperclipToolDefinitions(client, config, management);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      tool.execute,
    );
  }
  server.server.setRequestHandler(ListToolsRequestSchema, () => leanToolListing(tools));

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: PaperclipMcpConfig = readConfigFromEnv()) {
  const management = await resolveManagementAuthority(new PaperclipApiClient(config), config);
  const { server } = createPaperclipMcpServer(config, management);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
