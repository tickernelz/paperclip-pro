import { OPENWA_TOOLS, type OpenwaToolName } from "@tickernelz/paperclip-pro-shared/openwa-tools";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import type { ToolDefinition } from "./tools.js";

export interface OpenwaMcpTools {
  call(input: { tool: OpenwaToolName; arguments: Record<string, unknown> }): Promise<unknown>;
}

export class OpenwaMcpToolError extends Error {
  constructor(readonly body: Record<string, unknown>) {
    super(typeof body.message === "string" ? body.message : String(body.error ?? "OpenWA tool failed"));
  }
}

export function createOpenwaToolDefinitions(tools: OpenwaMcpTools): ToolDefinition[] {
  return OPENWA_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    annotations: tool.risk === "read" ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: false },
    execute: async (input: Record<string, unknown>) => {
      try {
        return formatTextResponse(await tools.call({ tool: tool.name, arguments: input }));
      } catch (error) {
        if (error instanceof OpenwaMcpToolError) return { ...formatTextResponse(error.body), isError: true };
        return formatErrorResponse(error);
      }
    },
  }));
}
