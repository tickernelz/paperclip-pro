import { z } from "zod";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import type { ToolDefinition } from "./tools.js";

export type ConnectorToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ConnectorMcpTools = {
  tools: ConnectorToolSpec[];
  call: (input: { tool: string; arguments: Record<string, unknown> }) => Promise<unknown>;
};

export type ConnectorToolDefinition = ToolDefinition & { inputSchemaJson: Record<string, unknown> };

const passthroughArguments = z.object({}).loose();

export function createConnectorToolDefinitions(connector: ConnectorMcpTools): ConnectorToolDefinition[] {
  return connector.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: passthroughArguments,
    inputSchemaJson: tool.inputSchema,
    execute: async (input: Record<string, unknown>) => {
      try {
        return formatTextResponse(await connector.call({ tool: tool.name, arguments: input }));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  }));
}
