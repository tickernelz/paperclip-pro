import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperclipApiClient } from "./client.js";
import { hasManagementAuthority, readConfigFromEnv, type PaperclipMcpConfig } from "./config.js";
import { createGeneratedToolDefinitions } from "./generated-tools.js";
import { createToolDefinitions, type ToolDefinition } from "./tools.js";

export async function resolveManagementAuthority(
  client: PaperclipApiClient,
  config: PaperclipMcpConfig,
): Promise<boolean> {
  if (config.agentRole) return hasManagementAuthority(config.agentRole);
  try {
    const actor = await client.requestJson<{ role?: unknown }>("GET", "/agents/me");
    return hasManagementAuthority(typeof actor?.role === "string" ? actor.role : null);
  } catch {
    return false;
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
