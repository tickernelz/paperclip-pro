import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sharedSchemas from "@tickernelz/paperclip-pro-shared";
import { generatedToolSpecs, sharedToolNotes } from "./generated-tools.js";

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
