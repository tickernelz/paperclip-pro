import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { canonicalToolName, wardmoteToolCatalog } from "./catalog.js";
import { WardmoteApiClient } from "./client.js";
import { hasManagementAuthority, readConfigFromEnv, type WardmoteMcpConfig } from "./config.js";
import { sharedToolNotes } from "./generated-tools.js";

export async function resolveManagementAuthority(
  client: WardmoteApiClient,
  config: WardmoteMcpConfig,
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

export function createWardmoteMcpServer(
  config: WardmoteMcpConfig = readConfigFromEnv(),
  management = false,
) {
  const server = new McpServer(
    {
      name: "wardmote",
      version: "0.1.0",
    },
    {
      instructions: sharedToolNotes().join(" "),
    },
  );

  const client = new WardmoteApiClient(config);
  const { definitions: tools } = wardmoteToolCatalog(client, config.toolsets, management);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.loose(),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      tool.execute,
    );
  }
  server.server.setRequestHandler(ListToolsRequestSchema, () =>
    wardmoteToolCatalog(client, config.toolsets, management).listing,
  );

  return {
    server,
    tools,
    client,
  };
}

export async function connectWardmoteMcpServer(server: McpServer, transport: Transport): Promise<void> {
  await server.connect(transport);
  const deliver = transport.onmessage;
  transport.onmessage = (message, extra) => {
    const params = "method" in message && message.method === "tools/call" ? message.params : undefined;
    const name = typeof params?.name === "string" ? params.name : null;
    deliver?.(name && params ? { ...message, params: { ...params, name: canonicalToolName(name) } } : message, extra);
  };
}

export async function runServer(config: WardmoteMcpConfig = readConfigFromEnv()) {
  const management = await resolveManagementAuthority(new WardmoteApiClient(config), config);
  const { server } = createWardmoteMcpServer(config, management);
  await connectWardmoteMcpServer(server, new StdioServerTransport());
}
