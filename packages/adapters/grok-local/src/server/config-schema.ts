import type { AdapterConfigSchema } from "@tickernelz/paperclip-pro-adapter-utils";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "paperclipMcp",
        label: "Paperclip MCP tools",
        type: "toggle",
        default: true,
        hint: "Mount the Paperclip API as MCP tools (paperclip* tool names) for the run, instead of making the agent use curl.",
        group: "Capabilities",
      },
      {
        key: "paperclipMcpToolsets",
        label: "Paperclip MCP toolsets",
        type: "text",
        default: "core",
        hint: "Toolsets exposed by the Paperclip MCP server: core (default) or full (every agent-callable tool). extended and all are deprecated aliases of full.",
        group: "Capabilities",
        meta: { visibleWhen: { key: "paperclipMcp", notValues: ["false"] } },
      },
    ],
  };
}
