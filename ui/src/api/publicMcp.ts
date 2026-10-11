import type { McpConnection, McpConnectionSetup } from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export const publicMcpApi = {
  setup: () => api.get<McpConnectionSetup>("/mcp/setup"),
  connections: () => api.get<McpConnection[]>("/mcp/connections"),
  revoke: (id: string) => api.delete(`/mcp/connections/${encodeURIComponent(id)}`),
};
