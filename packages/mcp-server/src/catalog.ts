import { z } from "zod";
import { boardToolAdvertised, type BoardSurfaceContext } from "./board-surface.js";
import type { PaperclipApiClient } from "./client.js";
import { expandToolsetUnion } from "./config.js";
import { bindGeneratedTools, prepareGeneratedTools } from "./generated-tools.js";
import { leanJsonSchema, type JsonSchemaObject } from "./lean-schema.js";
import type { ToolsetName } from "./tool-overrides.js";
import {
  createToolDefinitions,
  type RuntimeConnectionTools,
  type ToolAnnotations,
  type ToolDefinition,
} from "./tools.js";

export { PaperclipApiClient } from "./client.js";
export { hasManagementAuthority, parseToolsets } from "./config.js";
export {
  ACTOR_NEUTRAL_GUARDS,
  AGENT_ADMITTING_GUARDS,
  BOARD_ONLY_GUARDS,
  boardToolAdvertised,
  classifiedGuards,
} from "./board-surface.js";
export type { BoardSurfaceContext } from "./board-surface.js";
export type { ToolsetName } from "./tool-overrides.js";
export type { RuntimeConnectionTools, ToolDefinition } from "./tools.js";

export type ToolListing = {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: JsonSchemaObject;
    annotations?: ToolAnnotations;
  }>;
};

export function resolveListingAnnotations(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env.PAPERCLIP_MCP_LIST_ANNOTATIONS?.trim().toLowerCase() ?? "";
  return configured === "1" || configured === "true" || configured === "yes";
}

export type CatalogOptions = {
  annotations?: boolean;
  boardSurface?: BoardSurfaceContext;
  runtimeConnections?: RuntimeConnectionTools;
};

const listings = new Map<string, ToolListing>();

function listingKey(
  toolsets: ReadonlyArray<ToolsetName>,
  management: boolean,
  surface: BoardSurfaceContext | undefined,
  annotations: boolean,
): string {
  const base = `${[...toolsets].sort().join(",")}|${management ? "management" : "agent"}|${annotations ? "annotated" : "lean"}`;
  if (!management || !surface) return base;
  return `${base}|${[...surface.capabilities].sort().join(",")}|${[...surface.permissionKeys].sort().join(",")}`;
}

function toListingEntries(definitions: ReadonlyArray<ToolDefinition>, annotations: boolean) {
  return definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: leanJsonSchema(
      z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }),
    ) as JsonSchemaObject,
    ...(annotations && tool.annotations ? { annotations: tool.annotations } : {}),
  }));
}

/** Tool definitions bound to one caller, sharing schema and listing work per variant. */
export function paperclipToolCatalog(
  client: PaperclipApiClient,
  toolsets: ReadonlyArray<ToolsetName>,
  management: boolean,
  options: CatalogOptions = {},
): { definitions: ToolDefinition[]; listing: ToolListing } {
  const selected = expandToolsetUnion(toolsets);
  const curated = createToolDefinitions(client, options.runtimeConnections);
  const curatedNames = new Set(curated.map((tool) => tool.name));
  const prepared = prepareGeneratedTools(selected, management);
  const definitions = [
    ...curated,
    ...bindGeneratedTools(prepared, client).filter((tool) => !curatedNames.has(tool.name)),
  ];

  const annotations = options.annotations ?? resolveListingAnnotations();
  const key = listingKey(selected, management, options.boardSurface, annotations);
  let listing = listings.get(key);
  if (!listing) {
    const surface = management ? options.boardSurface : undefined;
    const advertisedNames = surface
      ? new Set(
          prepared
            .filter(({ spec }) => boardToolAdvertised(spec, surface))
            .map(({ spec }) => spec.name),
        )
      : null;
    const visible = advertisedNames
      ? definitions.filter((tool) => curatedNames.has(tool.name) || advertisedNames.has(tool.name))
      : definitions;
    listing = { tools: toListingEntries(visible, annotations) };
    listings.set(key, listing);
  }
  return { definitions, listing };
}
