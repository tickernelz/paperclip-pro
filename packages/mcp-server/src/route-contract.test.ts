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
import { CURATED_OPERATIONS, TOOL_OVERRIDES } from "./tool-overrides.js";

const NAME_TOKEN = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;

function nameTokens(name: string): string[] {
  return name.slice("paperclip".length).match(NAME_TOKEN) ?? [];
}

function parentResourceToken(operationId: string): string | null {
  const [method] = operationId.split(" ", 1);
  const segments = operationId
    .replace(/^[A-Z]+ /, "")
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean);
  const scoped =
    segments[0] === "companies" && segments[1]?.startsWith("{") ? segments.slice(2) : segments;
  const statics = scoped.filter((segment) => !segment.startsWith("{"));
  const action = statics[statics.length - 1];
  if (method === "POST" && action && /^[a-z-]+$/.test(action) && !action.endsWith("s")) return null;
  const parent = statics[0];
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

interface RequiredQuerySite {
  file: string;
  line: number;
  schema: string;
  method: string;
  path: string;
  required: string[];
}

type LooseSchema = { shape?: Record<string, { isOptional?: () => boolean }> };

function normalizePath(path: string): string {
  return path.replace(/\{[A-Za-z0-9_]+\}/g, "{}").replace(/\/+/g, "/");
}

function requiredQuerySites(): RequiredQuerySite[] {
  const sites: RequiredQuerySite[] = [];
  for (const file of readdirSync(routesDir).filter((entry) => entry.endsWith(".ts"))) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(routesDir, file), "utf8");
    const routes = [...source.matchAll(new RegExp(ROUTE_PATTERN.source, "g"))];
    const prefix = ROUTE_FILE_PREFIXES[file] ?? "/api";
    for (const match of source.matchAll(new RegExp(QUERY_VALIDATION_PATTERN.source, "g"))) {
      const schemaName = match[1];
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
      const routePath = enclosing[2]
        .replace(/\*([A-Za-z0-9_]+)/g, "{$1}")
        .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const mounted = (
        routePath.startsWith("/api") ? routePath : `${prefix}${routePath === "/" ? "" : routePath}`
      ).replace(/\/+/g, "/");
      sites.push({
        file,
        line: source.slice(0, match.index ?? 0).split("\n").length,
        schema: schemaName,
        method: enclosing[1].toUpperCase(),
        path: mounted.replace(/^\/api/, ""),
        required,
      });
    }
  }
  return sites;
}

describe("generated tool input contracts", () => {
  it("enumerates the routes that require a query parameter", () => {
    const sites = requiredQuerySites();
    expect(sites.map((site) => `${site.method} ${normalizePath(site.path)}`).sort()).toEqual([
      "GET /agents/me/inbox/mine",
      "GET /companies/{}/search/extract",
    ]);
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
