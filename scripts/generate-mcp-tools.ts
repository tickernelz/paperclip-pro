import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../server/src/routes/openapi.js";
import { leanJsonSchema } from "../packages/mcp-server/src/lean-schema.js";
import {
  CURATED_OPERATIONS,
  PROBE_BOARD_DENIED_OPERATIONS,
  EXCLUDED_OPERATIONS,
  TOOL_OVERRIDES,
  type ToolsetName,
} from "../packages/mcp-server/src/tool-overrides.js";

type Json = Record<string, any>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(repoRoot, "packages/mcp-server/src/generated/api-tools.json");
const routesDir = join(repoRoot, "server/src/routes");
const exclusionsPath = join(
  repoRoot,
  "packages/mcp-server/src/generated/excluded-operations.json",
);
const notesPath = join(
  repoRoot,
  "packages/mcp-server/src/generated/shared-tool-notes.json",
);

const COMPANY_IMPORT_TRANSFERS_ROUTE_PATH =
  /COMPANY_IMPORT_TRANSFERS_ROUTE_PATH\s*=\s*["']([^"']+)["']/.exec(
    readFileSync(join(repoRoot, "packages/shared/src/company-import-transfer.ts"), "utf8"),
  )?.[1] ?? "/import/transfers";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const READ_METHODS: Record<string, true> = { GET: true, HEAD: true };
const IDEMPOTENT_METHODS: Record<string, true> = { GET: true, PUT: true, DELETE: true, HEAD: true };

const CREDENTIAL_SEGMENTS =
  /\/(secrets|setup-secret|secret-proposals|secret-provider-configs|user-secrets|user-secret-definitions|keys|board-api-keys|credentials|setup-token-login-sessions|board-claim|invites|join-requests|gateway-tokens|tokens|token|rotate-secret|terminal-session-token|claim-api-key)(\/|$)/;
const PROTOCOL_SEGMENTS =
  /\/(oauth|auth|cli-auth|runtime-tools|mcp|ws|websocket|events|_plugins)(\/|$)/;
const DESTRUCTIVE_SEGMENTS =
  /\/(terminate|cancel|archive|purge|reset|rollback|revoke|unlink|disable|delete)(\/|$)/;
const NON_JSON_RESPONSE = /(\.[a-z]+$|\/content$|\/download$|\/pdf$|\/files$|\/stream$)/;

export interface GeneratedParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: Json;
}

export type ToolAuthority = "agent" | "board";

export interface GeneratedTool {
  name: string;
  operationId: string;
  method: string;
  path: string;
  description: string;
  toolset: ToolsetName;
  authority: ToolAuthority;
  authoritySource: "handler" | "registry" | "probe" | "default";
  tags: string[];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
  };
  guards: string[];
  permissions: string[];
  boardGuard: string | null;
  parameters: GeneratedParameter[];
  body?: {
    required: boolean;
    documented: boolean;
    mode: "merge" | "nest";
    advanced?: boolean;
    schema: Json;
  };
}

export interface GeneratorResult {
  tools: GeneratedTool[];
  sharedNotes: string[];
  excludedOperations: Record<string, string>;
  counts: {
    totalOperations: number;
    agentAuthorized: number;
    agentUsable: number;
    generated: number;
    excluded: Record<string, number>;
    perToolset: Record<string, number>;
  };
}

function operationKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

function dereference(document: Json, value: any, seen: string[] = []): any {
  if (Array.isArray(value)) return value.map((entry) => dereference(document, entry, seen));
  if (!value || typeof value !== "object") return value;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
    if (seen.includes(value.$ref)) return {};
    const target = value.$ref
      .slice(2)
      .split("/")
      .reduce((node: any, key: string) => node?.[key], document);
    if (!target) return {};
    return dereference(document, target, [...seen, value.$ref]);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, dereference(document, entry, seen)]),
  );
}

function normalizeSchema(schema: Json): Json {
  if (!schema || typeof schema !== "object") return {};
  const { nullable, oneOf, allOf, example, examples, ...rest } = schema as Json;
  let result: Json = { ...rest };

  if (Array.isArray(oneOf)) {
    result.anyOf = oneOf.map((entry: Json) => normalizeSchema(entry));
  }
  if (Array.isArray(allOf)) {
    const merged: Json = { type: "object", properties: {}, required: [] as string[] };
    for (const entry of allOf.map((member: Json) => normalizeSchema(member))) {
      if (entry.type !== "object") return {};
      Object.assign(merged.properties, entry.properties ?? {});
      merged.required = [...(merged.required as string[]), ...((entry.required as string[]) ?? [])];
    }
    if ((merged.required as string[]).length === 0) delete merged.required;
    result = { ...result, ...merged };
  }
  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((entry: Json) => normalizeSchema(entry));
  }
  if (result.items) result.items = normalizeSchema(result.items as Json);
  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties as Json)
        .map(([key, value]) => [key, normalizeSchema(value as Json)])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (result.additionalProperties && typeof result.additionalProperties === "object") {
    result.additionalProperties = normalizeSchema(result.additionalProperties as Json);
  }
  if (Array.isArray(result.required)) {
    result.required = [...new Set(result.required as string[])].sort();
  }
  if (nullable === true) {
    const inner = result;
    return Object.keys(inner).length === 0
      ? {}
      : { anyOf: [inner, { type: "null" }] };
  }
  return result;
}

const SINGULARS: Record<string, string> = {
  issues: "Issue",
  comments: "Comment",
  documents: "Document",
  approvals: "Approval",
  projects: "Project",
  goals: "Goal",
  agents: "Agent",
  revisions: "Revision",
  attachments: "Attachment",
  interactions: "Interaction",
  routines: "Routine",
  skills: "Skill",
  companies: "Company",
  labels: "Label",
  cases: "Case",
  decisions: "Decision",
  environments: "Environment",
  folders: "Folder",
  triggers: "Trigger",
  runs: "Run",
};

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function singular(segment: string): string {
  if (SINGULARS[segment]) return SINGULARS[segment];
  const word = pascal(segment);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses") || word.endsWith("uses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function derivedName(method: string, path: string): string {
  const raw = path.replace(/^\/api\//, "");
  const segments = raw.split("/").filter(Boolean);
  const scoped =
    segments[0] === "companies" && segments[1]?.startsWith("{") ? segments.slice(2) : segments;
  const statics = scoped.filter((segment) => !segment.startsWith("{"));
  const endsWithParam = scoped.length > 0 && scoped[scoped.length - 1].startsWith("{");
  const last = statics[statics.length - 1] ?? "resource";
  const leading = statics.slice(0, -1).map((segment) => singular(segment)).join("");

  if (method === "GET") {
    return endsWithParam || statics.length === 0 || !last.endsWith("s")
      ? `Get${leading}${singular(last)}`
      : `List${leading}${pascal(last)}`;
  }
  if (method === "DELETE") return `Delete${leading}${singular(last)}`;
  if (method === "PATCH") return `Update${leading}${singular(last)}`;
  if (method === "PUT") return `Set${leading}${singular(last)}`;
  const verbish = /^[a-z-]+$/.test(last) && !SINGULARS[last] && !last.endsWith("s");
  return verbish ? `${pascal(last)}${leading}` : `Create${leading}${singular(last)}`;
}

export const NAME_LENGTH_LIMIT = 40;

const NAME_PREFIX = "paperclip";

function disambiguatedName(base: string, path: string, method: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const qualifier = pascal(
    path
      .replace(/^\/api\//, "")
      .split("/")
      .filter((segment) => segment.startsWith("{"))
      .map((segment) => segment.slice(1, -1))
      .join("-"),
  );
  const qualified = `${base}By${qualifier}`;
  if (qualifier && !taken.has(qualified)) return qualified;
  const withMethod = `${base}${pascal(method.toLowerCase())}`;
  if (!taken.has(withMethod)) return withMethod;
  let index = 2;
  while (taken.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

const NAME_TOKEN = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;

export function cappedName(name: string, method: string, path: string, taken: Set<string>): string {
  if (name.length <= NAME_LENGTH_LIMIT && !taken.has(name)) return name;
  const tokens = name.slice(NAME_PREFIX.length).match(NAME_TOKEN) ?? [];
  const digest = createHash("sha256").update(`${method} ${path}`).digest("hex").slice(0, 6);
  if (tokens.length >= 3) {
    const interior = tokens.slice(1, -1);
    for (let drop = 1; drop <= interior.length; drop += 1) {
      const candidate = `${NAME_PREFIX}${[tokens[0], ...interior.slice(drop), tokens[tokens.length - 1]].join("")}`;
      if (candidate.length <= NAME_LENGTH_LIMIT && !taken.has(candidate)) return candidate;
    }
  }
  const suffix = `_${digest}`;
  let stem = `${NAME_PREFIX}${tokens.join("")}`.slice(0, NAME_LENGTH_LIMIT - suffix.length);
  while (taken.has(`${stem}${suffix}`) && stem.length > NAME_PREFIX.length) {
    stem = stem.slice(0, -1);
  }
  return `${stem}${suffix}`;
}

const PLACEHOLDER_RESOURCES: Record<string, string> = {
  "action-requests": "actionRequest",
  agents: "agent",
  announcements: "announcement",
  cases: "case",
  "decision-training": "decisionTraining",
  decisions: "decision",
  documents: "document",
  environments: "environment",
  examples: "example",
  "execution-workspaces": "executionWorkspace",
  goals: "goal",
  issues: "issue",
  projects: "project",
  "routine-triggers": "routineTrigger",
  routines: "routine",
  "runtime-slots": "runtimeSlot",
  "status-cards": "statusCard",
  "work-products": "workProduct",
};

function semanticParameterNames(path: string): Map<string, string> {
  const segments = path.split("/").filter(Boolean);
  const names = new Map<string, string>();
  for (const [index, segment] of segments.entries()) {
    if (!/^\{[A-Za-z0-9_]+\}$/.test(segment)) continue;
    const placeholder = segment.slice(1, -1);
    if (placeholder !== "id" && placeholder !== "key") continue;
    const resource = segments[index - 1];
    if (!resource) continue;
    const stem = PLACEHOLDER_RESOURCES[resource] ?? pascal(singular(resource)).replace(/^./, (c) => c.toLowerCase());
    names.set(placeholder, `${stem}${placeholder === "key" ? "Key" : "Id"}`);
  }
  return names;
}

const DESCRIPTION_SENTENCE_SPLIT = /(?<=\.)\s+/;
const SHARED_SENTENCE_MIN_OCCURRENCES = 10;

function descriptionSentences(text: string): string[] {
  return text
    .split(DESCRIPTION_SENTENCE_SPLIT)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hoistSharedSentences(tools: GeneratedTool[]): string[] {
  const occurrences = new Map<string, Set<string>>();
  const scopes = new Map<string, Set<string>>();
  const firstSentences = new Set<string>();
  for (const tool of tools) {
    const sentences = descriptionSentences(tool.description);
    if (sentences.length > 0) firstSentences.add(sentences[0]);
    for (const [index, sentence] of sentences.entries()) {
      if (index === 0) continue;
      if (!occurrences.has(sentence)) {
        occurrences.set(sentence, new Set());
        scopes.set(sentence, new Set());
      }
      occurrences.get(sentence)!.add(tool.name);
      for (const tag of tool.tags) scopes.get(sentence)!.add(tag);
    }
  }
  const shared = new Set(
    [...occurrences]
      .filter(
        ([sentence, names]) =>
          names.size >= SHARED_SENTENCE_MIN_OCCURRENCES && !firstSentences.has(sentence),
      )
      .map(([sentence]) => sentence),
  );
  if (shared.size === 0) return [];
  for (const tool of tools) {
    const kept = descriptionSentences(tool.description).filter((sentence) => !shared.has(sentence));
    if (kept.length === 0) continue;
    tool.description = kept.join(" ");
  }
  return [...shared]
    .map((sentence) => {
      const scope = [...(scopes.get(sentence) ?? [])].sort().join(",");
      return scope ? `[${scope}] ${sentence}` : sentence;
    })
    .sort();
}

function storedPath(path: string, placeholderNames: Map<string, string>): string {
  const withoutPrefix = path.replace(/^\/api/, "");
  if (placeholderNames.size === 0) return withoutPrefix;
  return withoutPrefix.replace(/\{([A-Za-z0-9_]+)\}/g, (match, placeholder: string) => {
    const renamed = placeholderNames.get(placeholder);
    return renamed ? `{${renamed}}` : match;
  });
}

function jsonBodySchema(
  operation: Json,
  document: Json,
): { required: boolean; documented: boolean; advanced?: boolean; schema: Json } | null {
  const content = operation.requestBody?.content as Json | undefined;
  if (!content) return null;
  const media = content["application/json"];
  if (!media?.schema) return null;
  const required = operation.requestBody.required === true;
  const schema = leanJsonSchema(normalizeSchema(dereference(document, media.schema))) as Json;
  if (schema.type === "object" || schema.properties || schema.anyOf) {
    return { required, documented: true, schema };
  }
  return { required, documented: false, schema: { type: "object" } };
}

const ROUTE_FILE_PREFIXES: Record<string, string> = {
  "companies.ts": "/api/companies",
  "cloud.ts": "/api/cloud",
  "health.ts": "/api/health",
  "auth.ts": "/api/auth",
};

interface RouteSlice {
  path: string;
  method: string;
  file: string;
  line: number;
  body: string;
}

export interface RouteGuardEvidence {
  guards: string[];
  permissions: string[];
  boardGuard: string | null;
}

function routeSourceSlices(): RouteSlice[] {
  const slices: RouteSlice[] = [];
  const pattern = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  for (const file of readdirSync(routesDir).filter((entry) => entry.endsWith(".ts"))) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(routesDir, file), "utf8");
    const prefix = ROUTE_FILE_PREFIXES[file] ?? "/api";
    const matches = [...source.matchAll(pattern)];
    for (const [index, match] of matches.entries()) {
      const start = source.lastIndexOf("\n", match.index ?? 0) + 1;
      const end = matches[index + 1]?.index ?? source.length;
      const routePath = match[2]
        .split("${COMPANY_IMPORT_TRANSFERS_ROUTE_PATH}")
        .join(COMPANY_IMPORT_TRANSFERS_ROUTE_PATH)
        .replace(/\*([A-Za-z0-9_]+)/g, "{$1}")
        .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const rootMounted =
        routePath.startsWith("/api") ||
        (file === "tool-gateway.ts" && routePath.startsWith("/mcp/gateways/")) ||
        (file === "connection-intents.ts" &&
          (routePath.startsWith("/mcp/") || routePath.startsWith("/runtime-tools/")));
      const mounted = rootMounted ? routePath : `${prefix}${routePath === "/" ? "" : routePath}`;
      slices.push({
        method: match[1].toUpperCase(),
        path: mounted.replace(/\/+/g, "/"),
        file,
        line: source.slice(0, start).split("\n").length,
        body: source.slice(start, end),
      });
    }
  }
  return slices;
}

const BOARD_GUARDS = /^\s*(await\s+)?(assertBoard|assertInstanceAdmin|assertBoardOrgAccess)\s*\(/;
const ANY_GUARD = /\b(assert[A-Z]\w*|require[A-Z]\w*|hasCompanyAccess|getActorInfo)\s*\(/g;

export function routeGuardEvidence(): Map<string, RouteGuardEvidence> {
  const evidence = new Map<string, RouteGuardEvidence>();
  for (const slice of routeSourceSlices()) {
    const lines = slice.body.split("\n");
    const handlerLine = lines.findIndex((line) => line.includes("=> {"));
    const handlerIndent =
      handlerLine < 0 ? -1 : lines[handlerLine].length - lines[handlerLine].trimStart().length;
    let boardGuard: string | null = null;
    if (handlerIndent >= 0) {
      for (const [offset, line] of lines.entries()) {
        if (!BOARD_GUARDS.test(line)) continue;
        if (line.length - line.trimStart().length !== handlerIndent + 2) continue;
        boardGuard = `${line.trim().replace(/\(.*/, "")}@${slice.file}:${slice.line + offset}`;
        break;
      }
    }
    const guards = [...new Set([...slice.body.matchAll(ANY_GUARD)].map((match) => match[1]))].sort();
    const permissions = [
      ...new Set(
        [...slice.body.matchAll(/assertCompanyPermission\([^)]*?["']([a-z_]+:[a-z_]+)["']/g)].map(
          (match) => match[1],
        ),
      ),
    ].sort();
    evidence.set(`${slice.method} ${slice.path}`, { guards, permissions, boardGuard });
  }
  return evidence;
}

export function mountedRoutes(): string[] {
  return [...new Set(routeSourceSlices().map((slice) => `${slice.method} ${slice.path}`))].sort();
}

function unregisteredRoutes(knownOperations: Set<string>): string[] {
  return mountedRoutes().filter((key) => !knownOperations.has(key)).sort();
}

export function generate(): GeneratorResult {
  const document = buildOpenApiDocument();
  const excludedOperations: Record<string, string> = {};
  const excluded: Record<string, number> = {};
  const note = (key: string, reason: string) => {
    excludedOperations[key] = reason;
    excluded[reason.split(":")[0]] = (excluded[reason.split(":")[0]] ?? 0) + 1;
  };

  const knownOperations = new Set<string>();
  const candidates: Array<{ key: string; method: string; path: string; operation: Json }> = [];
  let totalOperations = 0;
  let agentAuthorized = 0;

  for (const [path, item] of Object.entries<Json>(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method] as Json | undefined;
      if (!operation) continue;
      totalOperations += 1;
      const key = operationKey(method, path);
      knownOperations.add(key);
      const authorization = operation["x-paperclip-authorization"] ?? {};
      if (authorization.actor === "board_or_agent") agentAuthorized += 1;
      if (authorization.actor !== "board_or_agent" && authorization.actor !== "board") {
        note(key, `actor:${authorization.actor ?? "unknown"}`);
        continue;
      }
      if (authorization.instanceAdmin === true) {
        note(key, "instance_admin");
        continue;
      }
      candidates.push({ key, method: method.toUpperCase(), path, operation });
    }
  }

  for (const key of [...Object.keys(CURATED_OPERATIONS), ...Object.keys(TOOL_OVERRIDES), ...Object.keys(EXCLUDED_OPERATIONS)]) {
    if (!knownOperations.has(key)) {
      throw new Error(`Unknown operation in the reviewed tool lists: ${key}`);
    }
  }

  const evidence = routeGuardEvidence();
  const agentUsableKeys: string[] = [];
  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const reviewed = EXCLUDED_OPERATIONS[candidate.key];
    if (reviewed) {
      note(candidate.key, `reviewed:${reviewed}`);
      continue;
    }
    if (operationDeprecated(candidate.operation)) {
      note(candidate.key, "deprecated");
      continue;
    }
    if (PROTOCOL_SEGMENTS.test(candidate.path)) {
      note(candidate.key, "protocol");
      continue;
    }
    if (CREDENTIAL_SEGMENTS.test(candidate.path)) {
      note(candidate.key, "credential_surface");
      continue;
    }
    if (!supportsJsonRequest(candidate.operation)) {
      note(candidate.key, "non_json_request");
      continue;
    }
    if (NON_JSON_RESPONSE.test(candidate.path)) {
      note(candidate.key, "non_json_response");
      continue;
    }
    agentUsableKeys.push(candidate.key);
    if (CURATED_OPERATIONS[candidate.key]) {
      note(candidate.key, `curated:${CURATED_OPERATIONS[candidate.key]}`);
      continue;
    }
    kept.push(candidate);
  }

  const taken = new Set<string>(Object.values(CURATED_OPERATIONS));
  const tools: GeneratedTool[] = [];
  for (const candidate of [...kept].sort((a, b) => a.key.localeCompare(b.key))) {
    const override = TOOL_OVERRIDES[candidate.key] ?? {};
    const name =
      override.name ??
      cappedName(
        disambiguatedName(
          `paperclip${derivedName(candidate.method, candidate.path)}`,
          candidate.path,
          candidate.method,
          taken,
        ),
        candidate.method,
        candidate.path,
        taken,
      );
    taken.add(name);

    const placeholderNames = semanticParameterNames(candidate.path);
    const parameters: GeneratedParameter[] = ((candidate.operation.parameters ?? []) as Json[])
      .filter((parameter) => parameter.in === "path" || parameter.in === "query")
      .map((parameter) => ({
        name:
          parameter.in === "path"
            ? (placeholderNames.get(parameter.name as string) ?? (parameter.name as string))
            : (parameter.name as string),
        in: parameter.in as "path" | "query",
        required: parameter.required === true,
        schema: leanJsonSchema(
          normalizeSchema(dereference(document, parameter.schema ?? {})),
        ) as Json,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const body = jsonBodySchema(candidate.operation, document);
    if (body && override.bodyFields) {
      if (!body.documented || body.schema.type !== "object") {
        throw new Error(`bodyFields on ${candidate.key} needs a documented object body`);
      }
      const properties = (body.schema.properties ?? {}) as Json;
      const missing = override.bodyFields.filter((field) => !(field in properties));
      if (missing.length > 0) {
        throw new Error(`Unknown bodyFields on ${candidate.key}: ${missing.join(", ")}`);
      }
      const keep = new Set([...((body.schema.required as string[]) ?? []), ...override.bodyFields]);
      body.schema = {
        ...body.schema,
        properties: Object.fromEntries(
          Object.entries(properties).filter(([key]) => keep.has(key)),
        ),
      };
      body.advanced = true;
    }
    const parameterNames = new Set(parameters.map((parameter) => parameter.name));
    const bodyProperties = Object.keys((body?.schema.properties ?? {}) as Json);
    const mode: "merge" | "nest" =
      body?.documented &&
      body.schema.type === "object" &&
      bodyProperties.every((key) => !parameterNames.has(key))
        ? "merge"
        : "nest";

    const summary = (candidate.operation.summary as string | undefined)?.trim();
    const described = (candidate.operation.description as string | undefined)?.trim();
    const undocumentedBody =
      body && !body.documented
        ? "The request body fields are not published in the API registry; pass them as an object in `body`"
        : "";
    const description =
      override.description ??
      [summary || `${candidate.method} ${candidate.path}`, described, undocumentedBody]
        .filter(Boolean)
        .join(". ");

    const guardEvidence = evidence.get(candidate.key);
    const registryBoard = candidate.operation["x-paperclip-authorization"]?.actor === "board";
    const probeDenial = PROBE_BOARD_DENIED_OPERATIONS[candidate.key];
    const authority: ToolAuthority =
      guardEvidence?.boardGuard || registryBoard || probeDenial ? "board" : "agent";
    const authoritySource: "handler" | "registry" | "probe" | "default" = guardEvidence?.boardGuard
      ? "handler"
      : registryBoard
        ? "registry"
        : probeDenial
          ? "probe"
          : "default";

    tools.push({
      name,
      operationId: candidate.key,
      method: candidate.method,
      path: storedPath(candidate.path, placeholderNames),
      description: `${description}${override.requiredHint ? ` ${override.requiredHint}` : ""}`.trim(),
      toolset: override.toolset ?? "extended",
      authority,
      authoritySource,
      tags: [...((candidate.operation.tags as string[] | undefined) ?? [])].sort(),
      annotations: {
        readOnlyHint: override.annotations?.readOnlyHint ?? READ_METHODS[candidate.method] === true,
        destructiveHint:
          override.annotations?.destructiveHint ??
          (candidate.method === "DELETE" || DESTRUCTIVE_SEGMENTS.test(candidate.path)),
        idempotentHint:
          override.annotations?.idempotentHint ?? IDEMPOTENT_METHODS[candidate.method] === true,
      },
      guards: guardEvidence?.guards ?? [],
      permissions: guardEvidence?.permissions ?? [],
      boardGuard: guardEvidence?.boardGuard ?? (probeDenial ? `probe:${probeDenial}` : null),
      parameters,
      ...(body
        ? {
            body: {
              required: body.required,
              documented: body.documented,
              mode,
              ...(body.advanced ? { advanced: true } : {}),
              schema: body.schema,
            },
          }
        : {}),
    });
  }

  const perToolset: Record<string, number> = {};
  for (const tool of tools) perToolset[tool.toolset] = (perToolset[tool.toolset] ?? 0) + 1;

  const sharedNotes = hoistSharedSentences(tools);

  return {
    tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    sharedNotes,
    excludedOperations: Object.fromEntries(
      Object.entries(excludedOperations).sort(([a], [b]) => a.localeCompare(b)),
    ),
    unregisteredRoutes: unregisteredRoutes(knownOperations),
    counts: {
      totalOperations,
      agentAuthorized,
      agentUsable: agentUsableKeys.length,
      generated: tools.length,
      mountedRoutes: mountedRoutes().length,
      unregisteredRoutes: unregisteredRoutes(knownOperations).length,
      excluded,
      perToolset,
    },
  };
}

function operationDeprecated(operation: Json): boolean {
  return operation.deprecated === true || /deprecated/i.test(String(operation.summary ?? ""));
}

function supportsJsonRequest(operation: Json): boolean {
  const content = operation.requestBody?.content as Json | undefined;
  if (!content) return true;
  return Object.keys(content).includes("application/json");
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const result = generate();
  const artifacts: Array<[string, string]> = [
    [outputPath, serialize(result.tools)],
    [notesPath, serialize(result.sharedNotes)],
    [exclusionsPath, serialize(result.excludedOperations)],
  ];
  if (process.argv.includes("--check")) {
    const stale = artifacts.filter(([file, content]) => readFileSync(file, "utf8") !== content);
    if (stale.length > 0) {
      console.error(
        `Stale generated MCP tool artifacts; run \`pnpm generate:mcp-tools\`:\n${stale
          .map(([file]) => file)
          .join("\n")}`,
      );
      process.exit(1);
    }
  } else {
    for (const [file, content] of artifacts) writeFileSync(file, content);
  }
  if (result.unregisteredRoutes.length > 0) {
    console.error(
      `Mounted routes missing from the OpenAPI registry:\n${result.unregisteredRoutes.join("\n")}`,
    );
  }
  console.log(JSON.stringify(result.counts, null, 2));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
