import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { paperclipToolCatalog } from "./catalog.js";
import { PaperclipApiClient } from "./client.js";
import { hasManagementAuthority, readConfigFromEnv, type PaperclipMcpConfig } from "./config.js";
import { sharedToolNotes } from "./generated-tools.js";

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

export function createPaperclipMcpServer(
  config: PaperclipMcpConfig = readConfigFromEnv(),
  management = false,
) {
  const server = new McpServer(
    {
      name: "paperclip",
      version: "0.1.0",
    },
    {
      instructions: sharedToolNotes().join(" "),
    },
  );

  const client = new PaperclipApiClient(config);
  const { definitions: tools } = paperclipToolCatalog(client, config.toolsets, management);
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
  server.server.setRequestHandler(ListToolsRequestSchema, (request) => {
    const cursor = request.params?.cursor;
    return paperclipToolCatalog(client, config.toolsets, management, { cursor }).listing;
  });

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
