import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sharedSchemas from "@tickernelz/paperclip-pro-shared";
import { generatedToolSpecs, sharedToolNotes } from "./generated-tools.js";
import {
  canonicalOperationKey,
  missingRequiredBodyFields,
  routeBodySchemas,
} from "./route-body-schemas.js";
import {
  CURATED_OPERATIONS,
  EXCLUDED_OPERATIONS,
  TOOL_OVERRIDES,
} from "./tool-overrides.js";

const NAME_TOKEN = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;

function nameTokens(name: string): string[] {
  return name.slice("paperclip".length).match(NAME_TOKEN) ?? [];
}

function parentResourceToken(operationId: string): string | null {
  const segments = operationId
    .replace(/^[A-Z]+ /, "")
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean);
  const scoped =
    segments[0] === "companies" && segments[1]?.startsWith("{") ? segments.slice(2) : segments;
  const parent = scoped.filter((segment) => !segment.startsWith("{"))[0];
  return parent ? (singular(parent).match(NAME_TOKEN) ?? [])[0] ?? null : null;
}

function singular(segment: string): string {
  const word = segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses") || word.endsWith("uses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const routesDir = join(repoRoot, "server/src/routes");

const ROUTE_FILE_PREFIXES: Record<string, string> = {
  "companies.ts": "/api/companies",
  "cloud.ts": "/api/cloud",
  "health.ts": "/api/health",
  "auth.ts": "/api/auth",
};

const ROUTE_PATTERN = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
const QUERY_VALIDATION_PATTERN = /(\w+)\.(?:safeParse|parse)\(\s*req\.query/;
const QUERY_READ_PATTERN = /req\.query\.([A-Za-z_][A-Za-z0-9_]*)/g;
const QUERY_ASSIGNMENT_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]{0,240}?);/g;
const REJECTION_PATTERN = /(?:res\s*\.?\s*)?status\(400\)/g;
const IF_PATTERN = /\bif\s*\(/g;
const ABSENCE_TOLERANT_PATTERN = [
  /!==\s*undefined/,
  /!==\s*null/,
  /!=\s*null/,
  /===\s*undefined/,
  /typeof\s+\w+\s*!==\s*["']string["']/,
  /\?\?/,
  /\|\|/,
];

interface RequiredQuerySite {
  file: string;
  line: number;
  schema: string;
  method: string;
  path: string;
  required: string[];
}

interface RouteSpan {
  file: string;
  method: string;
  path: string;
  body: string;
  startLine: number;
}

type LooseSchema = { shape?: Record<string, { isOptional?: () => boolean }> };

function normalizePath(path: string): string {
  return path.replace(/\{[A-Za-z0-9_]+\}/g, "{}").replace(/\/+/g, "/");
}

function mountedRoutePath(file: string, routePath: string): string {
  const prefix = ROUTE_FILE_PREFIXES[file] ?? "/api";
  const templated = routePath
    .replace(/\*([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const mounted = (
    templated.startsWith("/api") ? templated : `${prefix}${templated === "/" ? "" : templated}`
  ).replace(/\/+/g, "/");
  return mounted.replace(/^\/api/, "");
}

function routeSpans(): RouteSpan[] {
  const spans: RouteSpan[] = [];
  for (const file of readdirSync(routesDir).filter((entry) => entry.endsWith(".ts"))) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(routesDir, file), "utf8");
    const matches = [...source.matchAll(new RegExp(ROUTE_PATTERN.source, "g"))];
    for (const [index, match] of matches.entries()) {
      const end = matches[index + 1]?.index ?? source.length;
      spans.push({
        file,
        method: match[1]!.toUpperCase(),
        path: mountedRoutePath(file, match[2]!),
        body: source.slice(match.index, end),
        startLine: source.slice(0, match.index).split("\n").length,
      });
    }
  }
  return spans;
}

interface GuardClause {
  condition: string;
  start: number;
  end: number;
}

function guardClauses(body: string): GuardClause[] {
  const guards: GuardClause[] = [];
  for (const match of body.matchAll(new RegExp(IF_PATTERN.source, "g"))) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let cursor = open;
    while (cursor < body.length) {
      if (body[cursor] === "(") depth += 1;
      else if (body[cursor] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      cursor += 1;
    }
    if (depth !== 0) continue;
    const condition = body.slice(open + 1, cursor);
    let after = cursor + 1;
    while (after < body.length && /\s/.test(body[after]!)) after += 1;
    let end = after + 1;
    if (body[after] === "{") {
      let braces = 0;
      let scan = after;
      while (scan < body.length) {
        if (body[scan] === "{") braces += 1;
        else if (body[scan] === "}") {
          braces -= 1;
          if (braces === 0) break;
        }
        scan += 1;
      }
      if (braces !== 0) continue;
      end = scan + 1;
    } else {
      end = body.indexOf(";", after);
      if (end === -1) continue;
    }
    guards.push({ condition, start: after, end });
  }
  return guards;
}

function toleratesAbsence(condition: string): boolean {
  return ABSENCE_TOLERANT_PATTERN.some((pattern) => pattern.test(condition));
}

function rejectsWhenMissing(condition: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`!\\s*${escaped}\\b`).test(condition) ||
    new RegExp(`${escaped}\\s*!==?\\s*["']`).test(condition)
  );
}

/**
 * Indexes routes that require a query value without validating one: `const
 * attention = req.query.attention` then `if (attention !== "blocked")` rejects
 * the request with 400 when the value is absent, and the generated tool had no
 * way to send it. A 400 guard nested inside `if (field !== undefined) {` only
 * rejects a bad value, which the tool cannot produce, so those do not count.
 */
function directRequiredQuerySites(spans: RouteSpan[]): RequiredQuerySite[] {
  const sites: RequiredQuerySite[] = [];
  for (const span of spans) {
    const reads = new Set(
      [...span.body.matchAll(new RegExp(QUERY_READ_PATTERN.source, "g"))].map((m) => m[1]!),
    );
    if (reads.size === 0) continue;
    const rejections = [
      ...span.body.matchAll(new RegExp(REJECTION_PATTERN.source, "g")),
    ].map((match) => match.index!);
    if (rejections.length === 0) continue;

    const aliases = new Map<string, string>();
    for (const match of span.body.matchAll(
      new RegExp(QUERY_ASSIGNMENT_PATTERN.source, "g"),
    )) {
      for (const field of reads) {
        if (match[2]!.includes(`req.query.${field}`)) aliases.set(match[1]!, field);
      }
    }
    const guards = guardClauses(span.body);
    const required = new Map<string, number>();
    for (const rejection of rejections) {
      const chain = guards.filter((guard) => guard.start <= rejection && rejection < guard.end);
      const governing = chain.at(-1);
      if (!governing) continue;
      for (const [name, field] of [...aliases, ...[...reads].map((f) => [f, f] as const)]) {
        if (!rejectsWhenMissing(governing.condition, name)) continue;
        if (chain.some((guard) => toleratesAbsence(guard.condition))) continue;
        if (!required.has(field)) required.set(field, governing.start);
      }
    }
    if (required.size === 0) continue;
    sites.push({
      file: span.file,
      line: span.startLine + span.body.slice(0, required.values().next().value!).split("\n").length - 1,
      schema: "req.query",
      method: span.method,
      path: span.path,
      required: [...required.keys()].sort(),
    });
  }
  return sites;
}

function validatedQuerySites(): RequiredQuerySite[] {
  const sites: RequiredQuerySite[] = [];
  for (const file of readdirSync(routesDir).filter((entry) => entry.endsWith(".ts"))) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(routesDir, file), "utf8");
    const routes = [...source.matchAll(new RegExp(ROUTE_PATTERN.source, "g"))];
    for (const match of source.matchAll(new RegExp(QUERY_VALIDATION_PATTERN.source, "g"))) {
      const schemaName = match[1]!;
      const schema = (sharedSchemas as unknown as Record<string, LooseSchema | undefined>)[
        schemaName
      ];
      if (!schema?.shape) continue;
      const required = Object.entries(schema.shape)
        .filter(([, value]) => value.isOptional?.() === false)
        .map(([key]) => key)
        .sort();
      if (required.length === 0) continue;
      const enclosing = routes.filter((entry) => (entry.index ?? 0) < (match.index ?? 0)).pop();
      if (!enclosing) continue;
      sites.push({
        file,
        line: source.slice(0, match.index ?? 0).split("\n").length,
        schema: schemaName,
        method: enclosing[1]!.toUpperCase(),
        path: mountedRoutePath(file, enclosing[2]!),
        required,
      });
    }
  }
  return sites;
}

function requiredQuerySites(): RequiredQuerySite[] {
  return [...validatedQuerySites(), ...directRequiredQuerySites(routeSpans())];
}

describe("generated tool input contracts", () => {
  it("enumerates the routes that require a query parameter", () => {
    const sites = requiredQuerySites();
    expect(
      sites
        .map((site) => `${site.method} ${normalizePath(site.path)} ${site.required.join(",")}`)
        .sort(),
    ).toEqual([
      "GET /agents/me/inbox/mine userId",
      "GET /companies/{}/issues/count attention",
      "GET /companies/{}/search/extract contains",
      "GET /plugins/{}/bridge/stream/{} companyId",
      "GET /tool-gateway/audit companyId,cursor",
      "GET /tool-gateway/runtime-slots companyId",
      "POST /tool-gateway/action-requests/{}/approve companyId",
      "POST /tool-gateway/action-requests/{}/decline companyId",
      "POST /tool-gateway/runtime-slots/{}/restart companyId",
      "POST /tool-gateway/runtime-slots/{}/stop companyId",
    ]);
  });

  it("leaves a route that needs no query out of the required list", () => {
    for (const operation of [
      "GET /companies/{companyId}/search",
      "GET /companies/{companyId}/slack/endpoints/{endpointId}/search",
      "POST /companies/{companyId}/slack/endpoints/{endpointId}/search/connect",
      "PUT /companies/{companyId}/slack/endpoints/{endpointId}/search",
      "DELETE /companies/{companyId}/slack/endpoints/{endpointId}/search",
    ]) {
      const [method, path] = operation.split(" ");
      const sites = requiredQuerySites();
      expect(
        sites.filter(
          (site) => site.method === method && normalizePath(site.path) === normalizePath(path!),
        ),
      ).toEqual([]);
    }
  });

  it("exposes every query parameter the validated route requires", () => {
    const specs = generatedToolSpecs();
    const byOperation = new Map(
      specs.map((spec) => [`${spec.method} ${normalizePath(spec.path)}`, spec]),
    );
    const violations: string[] = [];
    for (const site of requiredQuerySites()) {
      const spec = byOperation.get(`${site.method} ${normalizePath(site.path)}`);
      if (!spec) {
        if (EXCLUDED_OPERATIONS[`${site.method} /api${site.path}`]) continue;
        violations.push(`${site.method} ${site.path} has no generated tool (${site.file}:${site.line})`);
        continue;
      }
      const exposed = new Set(
        spec.parameters.filter((parameter) => parameter.in === "query").map((parameter) => parameter.name),
      );
      const missing = site.required.filter((key) => !exposed.has(key));
      if (missing.length > 0) {
        violations.push(
          `${spec.name} (${spec.operationId}) is missing ${missing.join(", ")} required by ${site.schema} at ${site.file}:${site.line}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("enumerates the generated tools whose route requires a body field", async () => {
    const { sites, unresolved } = await routeBodySchemas();
    expect(unresolved).toEqual([]);
    const generated = new Map(
      generatedToolSpecs().map((spec) => [canonicalOperationKey(spec.method, spec.path), spec]),
    );
    const inspected = sites.filter((site) =>
      generated.has(canonicalOperationKey(site.method, site.path)),
    );
    expect(inspected.length).toBeGreaterThan(200);
    const requiring = inspected.filter((site) => site.required.length > 0);
    expect(requiring.length).toBeGreaterThan(130);
    for (const operation of [
      "POST /api/companies/{companyId}/skills/{skillId}/comments",
      "PATCH /api/companies/{companyId}/skills/{skillId}/comments/{commentId}",
      "POST /api/companies/{companyId}/skills/install-catalog",
      "POST /api/issues/{id}/children",
      "PUT /api/tool-connections/{connectionId}/grants/{grantId}/members",
    ]) {
      const key = canonicalOperationKey(operation.split(" ")[0]!, operation.split(" ").slice(1).join(" "));
      expect(generated.has(key)).toBe(true);
      expect(requiring.some((site) => canonicalOperationKey(site.method, site.path) === key)).toBe(true);
    }
  });

  it("exposes every body field the validated route requires", async () => {
    const { sites } = await routeBodySchemas();
    const byOperation = new Map(
      generatedToolSpecs().map((spec) => [canonicalOperationKey(spec.method, spec.path), spec]),
    );
    const violations: string[] = [];
    let inspected = 0;
    for (const site of sites) {
      const spec = byOperation.get(canonicalOperationKey(site.method, site.path));
      if (!spec) continue;
      inspected += 1;
      const missing = missingRequiredBodyFields(spec, site.required);
      if (missing.length > 0) {
        violations.push(
          `${spec.name} (${spec.operationId}) is missing ${missing.join(", ")} required by ${site.schemaName} at ${site.file}:${site.line}`,
        );
      }
    }
    expect(inspected).toBeGreaterThan(200);
    expect(violations).toEqual([]);
  });

  it("names every path placeholder after its resource instead of a bare id or key", () => {
    const bare = generatedToolSpecs().filter((spec) =>
      spec.parameters.some(
        (parameter) =>
          parameter.in === "path" && (parameter.name === "id" || parameter.name === "key"),
      ),
    );
    expect(bare.map((spec) => spec.name)).toEqual([]);
  });

  it("declares a path parameter for every placeholder in the stored path", () => {
    const violations: string[] = [];
    for (const spec of generatedToolSpecs()) {
      const placeholders = [...spec.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]);
      const declared = new Set(
        spec.parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name),
      );
      const missing = placeholders.filter((placeholder) => !declared.has(placeholder));
      if (missing.length > 0) violations.push(`${spec.name} ${spec.path} ${missing.join(", ")}`);
    }
    expect(violations).toEqual([]);
  });

  it("caps every generated and curated tool name at 40 characters", () => {
    const overLong = generatedToolSpecs()
      .map((spec) => spec.name)
      .filter((name) => name.length > 40);
    expect(overLong).toEqual([]);
  });

  it("keeps every tool description non-empty after hoisting the shared statements", () => {
    const empty = generatedToolSpecs()
      .filter((spec) => spec.description.trim().length === 0)
      .map((spec) => spec.name);
    expect(empty).toEqual([]);
  });

  it("joins the kept description sentences without duplicating a period", () => {
    const doubled = generatedToolSpecs()
      .filter((spec) => /(?<!\.)\.\.(?!\.)/.test(spec.description))
      .map((spec) => spec.name);
    expect(doubled).toEqual([]);
  });

  it("repeats no description sentence across ten tools", () => {
    const occurrences = new Map<string, number>();
    for (const spec of generatedToolSpecs()) {
      for (const sentence of spec.description.split(/(?<=\.)\s+/).map((part) => part.trim())) {
        if (!sentence) continue;
        occurrences.set(sentence, (occurrences.get(sentence) ?? 0) + 1);
      }
    }
    const repeated = [...occurrences]
      .filter(([, count]) => count >= 10)
      .map(([sentence]) => sentence);
    expect(repeated).toEqual([]);
  });

  it("never publishes the mechanical method-and-path summary", () => {
    const mechanical = generatedToolSpecs()
      .filter((spec) => /^(GET|POST|PUT|PATCH|DELETE)\b/.test(spec.description))
      .map((spec) => spec.name);
    expect(mechanical).toEqual([]);
  });

  it("tells two tools in one tag apart when the description is short", () => {
    const groups = new Map<string, string[]>();
    for (const spec of generatedToolSpecs()) {
      if (spec.description.trim().length >= 20) continue;
      for (const tag of spec.tags.length > 0 ? spec.tags : [""]) {
        const key = `${tag}\u0000${spec.description}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(spec.name);
      }
    }
    const collisions = [...groups.values()].filter((names) => names.length > 1);
    expect(collisions).toEqual([]);
  });

  it("keeps the parent resource token in every generated tool name", () => {
    const lost: string[] = [];
    for (const spec of generatedToolSpecs()) {
      if (CURATED_OPERATIONS[spec.operationId]) continue;
      if (TOOL_OVERRIDES[spec.operationId]?.name) continue;
      if (/_[0-9a-f]{6}$/.test(spec.name)) continue;
      const parent = parentResourceToken(spec.operationId);
      if (!parent) continue;
      const tokens = nameTokens(spec.name);
      if (tokens.length < 3) continue;
      if (!tokens.includes(parent)) lost.push(`${spec.name} lost ${parent} on ${spec.operationId}`);
    }
    expect(lost).toEqual([]);
  });

  it("publishes the hoisted statements once as shared notes", () => {
    const notes = sharedToolNotes();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).toContain("[Experimental] Existing route authorization applies.");
    expect(notes.some((note) => note.startsWith("[Email] "))).toBe(true);
  });

  it("records the capability the route's authority guard asserts", () => {
    const specs = generatedToolSpecs();
    const withCapability = specs.filter((spec) => spec.authorityCapability);
    expect(withCapability.length).toBeGreaterThan(0);
    expect(withCapability.every((spec) => /^[a-z_]+:[a-z_]+$/.test(spec.authorityCapability!))).toBe(
      true,
    );
    const connections = specs.find(
      (spec) => spec.operationId === "GET /api/companies/{companyId}/ai-connections",
    );
    expect(connections?.authorityCapability).toBe("work:read");
  });
});


function multipartUploadSites(): { operation: string; file: string; line: number }[] {
  const out: { operation: string; file: string; line: number }[] = [];
  for (const span of routeSpans()) {
    if (!/run[A-Za-z]*Upload\s*\(/.test(span.body)) continue;
    const mounted = span.path.startsWith("/api") ? span.path : `/api${span.path}`;
    out.push({
      operation: `${span.method} ${mounted.replace(/\/+/g, "/")}`,
      file: span.file,
      line: span.startLine,
    });
  }
  return out;
}

describe("routes an MCP tool call cannot serve", () => {
  it("never advertises a multipart upload route, because a tool cannot send a binary file", () => {
    const advertised = new Set(generatedToolSpecs().map((spec) => spec.operationId));
    const sites = multipartUploadSites();
    expect(sites.length).toBeGreaterThan(0);
    const offenders = sites
      .filter((site) => advertised.has(site.operation))
      .map((site) => `${site.operation} (${site.file}:${site.line})`);
    expect(offenders).toEqual([]);
  });

  it("keeps every reason in the exclusion table a known reason", () => {
    const known = new Set([
      "credential_surface",
      "company_transfer",
      "instance_setup",
      "non_json_request",
      "route_stub",
      "runner_lifecycle_authority",
      "runtime_authority",
      "sse_stream",
      "trust_boundary",
    ]);
    expect(
      Object.entries(EXCLUDED_OPERATIONS)
        .filter(([, reason]) => !known.has(reason))
        .map(([operation, reason]) => `${operation} -> ${reason}`),
    ).toEqual([]);
  });
});
