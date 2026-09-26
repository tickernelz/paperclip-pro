import { z } from "zod";
import type { PaperclipApiClient } from "./client.js";
import { expandToolsetUnion } from "./config.js";
import { bindGeneratedTools, prepareGeneratedTools } from "./generated-tools.js";
import { leanJsonSchema, type JsonSchemaObject } from "./lean-schema.js";
import type { ToolsetName } from "./tool-overrides.js";
import { createToolDefinitions, type ToolAnnotations, type ToolDefinition } from "./tools.js";

export { PaperclipApiClient } from "./client.js";
export { hasManagementAuthority, parseToolsets } from "./config.js";
export type { ToolsetName } from "./tool-overrides.js";
export type { ToolDefinition } from "./tools.js";

export type ToolListing = {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: JsonSchemaObject;
    annotations?: ToolAnnotations;
  }>;
};

const listings = new Map<string, ToolListing>();

/** Tool definitions bound to one caller, sharing schema and listing work per variant. */
export function paperclipToolCatalog(
  client: PaperclipApiClient,
  toolsets: ReadonlyArray<ToolsetName>,
  management: boolean,
): { definitions: ToolDefinition[]; listing: ToolListing } {
  const selected = expandToolsetUnion(toolsets);
  const curated = createToolDefinitions(client);
  const curatedNames = new Set(curated.map((tool) => tool.name));
  const generated = bindGeneratedTools(prepareGeneratedTools(selected, management), client).filter(
    (tool) => !curatedNames.has(tool.name),
  );
  const definitions = [...curated, ...generated];
  const key = `${[...selected].sort().join(",")}|${management ? "management" : "agent"}`;
  let listing = listings.get(key);
  if (!listing) {
    listing = {
      tools: definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: leanJsonSchema(
          z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }),
        ) as JsonSchemaObject,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      })),
    };
    listings.set(key, listing);
  }
  return { definitions, listing };
}
