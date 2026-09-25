import { readFileSync } from "node:fs";
import { z } from "zod";
import type { PaperclipApiClient } from "./client.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import type { ToolDefinition } from "./tools.js";
import type { ToolsetName } from "./tool-overrides.js";

const jsonSchemaValue = z.record(z.string(), z.unknown());

const generatedToolSchema = z.object({
  name: z.string(),
  operationId: z.string(),
  method: z.string(),
  path: z.string(),
  description: z.string(),
  toolset: z.enum(["core", "extended"]),
  authority: z.enum(["agent", "board"]),
  authoritySource: z.enum(["handler", "registry", "probe", "default"]),
  guards: z.array(z.string()),
  permissions: z.array(z.string()),
  boardGuard: z.string().nullable(),
  tags: z.array(z.string()),
  annotations: z.object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
  }),
  parameters: z.array(
    z.object({
      name: z.string(),
      in: z.enum(["path", "query"]),
      required: z.boolean(),
      schema: jsonSchemaValue,
    }),
  ),
  body: z
    .object({
      required: z.boolean(),
      documented: z.boolean(),
      mode: z.enum(["merge", "nest"]),
      advanced: z.boolean().optional(),
      schema: jsonSchemaValue,
    })
    .optional(),
});

export type GeneratedToolSpec = z.infer<typeof generatedToolSchema>;

let cachedSpecs: GeneratedToolSpec[] | undefined;

const generatedToolListSchema = z.array(generatedToolSchema);

function readGeneratedToolFile(): unknown[] {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("./generated/api-tools.json", import.meta.url), "utf8"),
  );
  if (!Array.isArray(parsed)) {
    throw new Error("Generated MCP tool definitions must be an array");
  }
  return parsed;
}

export function generatedToolSpecs(): GeneratedToolSpec[] {
  cachedSpecs ??= generatedToolListSchema.parse(readGeneratedToolFile());
  return cachedSpecs;
}

function selectedToolSpecs(
  toolsets: ReadonlyArray<ToolsetName>,
  management: boolean,
): GeneratedToolSpec[] {
  const selected = readGeneratedToolFile().filter((entry) => {
    const spec = entry as { toolset?: unknown; authority?: unknown };
    return (
      toolsets.includes(spec.toolset as ToolsetName) &&
      (management || spec.authority === "agent")
    );
  });
  return generatedToolListSchema.parse(selected);
}

function inputSchema(spec: GeneratedToolSpec): z.ZodObject {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const parameter of spec.parameters) {
    properties[parameter.name] = parameter.schema;
    if (parameter.required && parameter.name !== "companyId") required.push(parameter.name);
  }
  if (spec.body?.mode === "merge") {
    Object.assign(properties, (spec.body.schema.properties ?? {}) as Record<string, unknown>);
    required.push(...((spec.body.schema.required ?? []) as string[]));
  } else if (spec.body) {
    properties.body = spec.body.schema;
    if (spec.body.required) required.push("body");
  }
  const schema = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...new Set(required)] } : {}),
  } as z.core.JSONSchema.JSONSchema;
  const converted = z.fromJSONSchema(schema, { defaultTarget: "draft-2020-12" });
  if (!(converted instanceof z.ZodObject)) {
    throw new Error(`Generated tool ${spec.name} did not produce an object schema`);
  }
  if (!spec.body?.advanced) return converted;
  return converted.extend({
    advanced: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        `any other field accepted by ${spec.method} ${spec.path}; see paperclipApiRequest for the full schema`,
      ),
  });
}

function requestPath(client: PaperclipApiClient, spec: GeneratedToolSpec, values: Record<string, unknown>) {
  let path = spec.path;
  const query = new URLSearchParams();
  for (const parameter of spec.parameters) {
    const supplied = values[parameter.name];
    delete values[parameter.name];
    if (parameter.in === "path") {
      const resolved =
        parameter.name === "companyId"
          ? client.resolveCompanyId(typeof supplied === "string" ? supplied : null)
          : supplied;
      if (resolved === undefined || resolved === null || resolved === "") {
        throw new Error(`${parameter.name} is required by ${spec.operationId}`);
      }
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(resolved)));
      continue;
    }
    if (supplied === undefined || supplied === null) continue;
    for (const entry of Array.isArray(supplied) ? supplied : [supplied]) {
      query.append(parameter.name, String(entry));
    }
  }
  const search = query.toString();
  return search.length > 0 ? `${path}?${search}` : path;
}

export function createGeneratedToolDefinitions(
  client: PaperclipApiClient,
  toolsets: ReadonlyArray<ToolsetName>,
  management = false,
): ToolDefinition[] {
  return selectedToolSpecs(toolsets, management)
    .map((spec) => {
      const schema = inputSchema(spec);
      return {
        name: spec.name,
        description: spec.description,
        schema,
        annotations: {
          readOnlyHint: spec.annotations.readOnlyHint,
          destructiveHint: spec.annotations.destructiveHint,
          idempotentHint: spec.annotations.idempotentHint,
        },
        execute: async (input: Record<string, unknown>) => {
          try {
            const values: Record<string, unknown> = { ...schema.parse(input) };
            const advanced = values.advanced as Record<string, unknown> | undefined;
            delete values.advanced;
            const path = requestPath(client, spec, values);
            const requestBody =
              spec.body?.mode === "nest"
                ? values.body
                : spec.body
                  ? values
                  : spec.method === "GET"
                    ? undefined
                    : {};
            const body =
              advanced && requestBody !== undefined && requestBody !== null
                ? { ...(requestBody as Record<string, unknown>), ...advanced }
                : requestBody;
            return formatTextResponse(
              await client.requestJson(spec.method, path, body === undefined ? {} : { body }),
            );
          } catch (error) {
            return formatErrorResponse(error);
          }
        },
      };
    });
}
