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
        hint: "Comma-separated toolsets exposed by the Paperclip MCP server: core, extended, or all.",
        group: "Capabilities",
        meta: { visibleWhen: { key: "paperclipMcp", notValues: ["false"] } },
      },
    ],
  };
}
