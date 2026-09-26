
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import * as sharedSchemas from "@tickernelz/paperclip-pro-shared";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const routesDir = join(repoRoot, "server/src/routes");

const ROUTE_FILE_PREFIXES: Record<string, string> = {
  "companies.ts": "/api/companies",
  "cloud.ts": "/api/cloud",
  "health.ts": "/api/health",
  "auth.ts": "/api/auth",
};

const ROUTE_PATTERN = /router\.(get|post|put|patch|delete)\(\s*["'\x60]([^"'\x60]+)["'\x60]/g;
const BODY_MIDDLEWARE_PATTERN =
  /(?<![.\w$])(validate|validateIssueMutationBody)\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;
const LOCAL_IMPORT_PATTERN = /import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g;

export interface RouteBodySite {
  key: string;
  method: string;
  path: string;
  file: string;
  line: number;
  schemaName: string;
  source: "shared" | "sibling" | "inline";
  required: string[];
  properties: string[];
  schema: Record<string, unknown>;
}

export interface UnresolvedRouteBodySite {
  key: string;
  file: string;
  line: number;
  schemaName: string;
}

export function canonicalOperationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path
    .replace(/^\/api/, "")
    .replace(/\{[A-Za-z0-9_]+\}/g, "{}")
    .replace(/\/+/g, "/")}`;
}

function mountRoutePath(file: string, routePath: string): string {
  const prefix = ROUTE_FILE_PREFIXES[file] ?? "/api";
  const withPlaceholders = routePath
    .replace(/\*([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const rootMounted =
    withPlaceholders.startsWith("/api") ||
    (file === "tool-gateway.ts" && withPlaceholders.startsWith("/mcp/gateways/")) ||
    (file === "connection-intents.ts" &&
      (withPlaceholders.startsWith("/mcp/") || withPlaceholders.startsWith("/runtime-tools/")));
  const mounted = rootMounted
    ? withPlaceholders
    : `${prefix}${withPlaceholders === "/" ? "" : withPlaceholders}`;
  return mounted.replace(/\/+/g, "/");
}

function localSchemaImports(source: string): Map<string, string> {
  const imports = new Map<string, string>();
  for (const match of source.matchAll(new RegExp(LOCAL_IMPORT_PATTERN.source, "g"))) {
    for (const part of match[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]!.trim();
      if (name) imports.set(name, match[2]!);
    }
  }
  return imports;
}

const siblingModuleCache = new Map<string, Record<string, unknown> | null>();

async function siblingSchema(file: string, specifier: string, name: string): Promise<unknown> {
  const target = join(routesDir, specifier.replace(/\.js$/, ".ts"));
  if (!existsSync(target)) return undefined;
  if (!siblingModuleCache.has(target)) {
    try {
      siblingModuleCache.set(
        target,
        (await import(pathToFileURL(target).href)) as Record<string, unknown>,
      );
    } catch {
      siblingModuleCache.set(target, null);
    }
  }
  return siblingModuleCache.get(target)?.[name];
}

function collectBranchRequired(converted: Record<string, unknown>): {
  required: string[];
  properties: string[];
} {
  const required = new Set<string>((converted.required as string[] | undefined) ?? []);
  const properties = new Set<string>(
    Object.keys((converted.properties ?? {}) as Record<string, unknown>),
  );
  const branches = [
    ...((converted.anyOf as unknown[] | undefined) ?? []),
    ...((converted.oneOf as unknown[] | undefined) ?? []),
    ...((converted.allOf as unknown[] | undefined) ?? []),
  ];
  for (const branch of branches) {
    if (!branch || typeof branch !== "object") continue;
    const nested = collectBranchRequired(branch as Record<string, unknown>);
    for (const field of nested.required) required.add(field);
    for (const field of nested.properties) properties.add(field);
  }
  return { required: [...required].sort(), properties: [...properties].sort() };
}

function toObjectJsonSchema(schema: unknown): Record<string, unknown> | null {
  try {
    const converted = z.toJSONSchema(schema as never, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    return converted && typeof converted === "object" ? converted : null;
  } catch {
    return null;
  }
}

interface InlineShape {
  required: string[];
  properties: string[];
}

function objectLiteralAt(source: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

function fieldsFromLiteral(literal: string): InlineShape {
  const required: string[] = [];
  const properties: string[] = [];
  for (const raw of splitTopLevelFields(literal)) {
    const entry = raw.trim();
    if (!entry) continue;
    const named = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(entry);
    if (!named) continue;
    properties.push(named[1]!);
    if (/\.optional\(\)/.test(entry) || /\.default\(/.test(entry)) continue;
    required.push(named[1]!);
  }
  return { required, properties };
}

function mergeShapes(base: InlineShape | null, extension: InlineShape): InlineShape {
  const required = new Set(base ? base.required : []);
  for (const field of extension.required) required.add(field);
  const properties = new Set(base ? base.properties : []);
  for (const field of extension.properties) properties.add(field);
  return { required: [...required].sort(), properties: [...properties].sort() };
}

const INLINE_DECLARATION =
  /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(z\s*\.?\s*object|([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*extend)\s*\(/g;

function inlineShapes(
  source: string,
  sharedShape: (name: string) => InlineShape | null,
): Map<string, InlineShape> {
  const shapes = new Map<string, InlineShape>();
  for (let pass = 0; pass < 4; pass += 1) {
    let progressed = false;
    for (const match of source.matchAll(new RegExp(INLINE_DECLARATION.source, "g"))) {
      const name = match[1]!;
      if (shapes.has(name)) continue;
      const baseName = match[3];
      if (baseName && !shapes.has(baseName)) {
        const inherited = sharedShape(baseName);
        if (inherited) shapes.set(baseName, inherited);
        else continue;
      }
      const open = source.indexOf("{", match.index + match[0].length - 1);
      if (open < 0) continue;
      const literal = objectLiteralAt(source, open);
      if (literal === null) continue;
      const extension = fieldsFromLiteral(literal);
      shapes.set(name, baseName ? mergeShapes(shapes.get(baseName)!, extension) : extension);
      progressed = true;
    }
    if (!progressed) break;
  }
  return shapes;
}

function inlineRequiredFields(
  source: string,
  name: string,
  sharedShape: (name: string) => InlineShape | null,
): InlineShape | null {
  return inlineShapes(source, sharedShape).get(name) ?? null;
}

function shapeFromShared(name: string): InlineShape | null {
  const schema = (sharedSchemas as unknown as Record<string, unknown>)[name];
  if (!schema) return null;
  const converted = toObjectJsonSchema(schema);
  if (!converted) return null;
  return {
    required: [...((converted.required as string[] | undefined) ?? [])].sort(),
    properties: Object.keys((converted.properties ?? {}) as Record<string, unknown>).sort(),
  };
}

function splitTopLevelFields(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "{" || character === "(" || character === "[") depth += 1;
    else if (character === "}" || character === ")" || character === "]") depth -= 1;
    else if (character === "," && depth === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
}

export async function routeBodySchemas(): Promise<{
  sites: RouteBodySite[];
  unresolved: UnresolvedRouteBodySite[];
}> {
  const sites: RouteBodySite[] = [];
  const unresolved: UnresolvedRouteBodySite[] = [];
  const files = readdirSync(routesDir).filter(
    (entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"),
  );
  for (const file of files) {
    const source = readFileSync(join(routesDir, file), "utf8");
    const routes = [...source.matchAll(new RegExp(ROUTE_PATTERN.source, "g"))];
    if (routes.length === 0) continue;
    const imports = localSchemaImports(source);
    for (const match of source.matchAll(new RegExp(BODY_MIDDLEWARE_PATTERN.source, "g"))) {
      const schemaName = match[2]!;
      const enclosing = routes.filter((entry) => (entry.index ?? 0) < (match.index ?? 0)).pop();
      if (!enclosing) continue;
      const method = enclosing[1]!.toUpperCase();
      const path = mountRoutePath(file, enclosing[2]!);
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const key = `${method} ${path}`;

      let schema = (sharedSchemas as unknown as Record<string, unknown>)[schemaName];
      let origin: RouteBodySite["source"] = "shared";
      if (!schema) {
        const specifier = imports.get(schemaName);
        if (specifier) {
          schema = (await siblingSchema(file, specifier, schemaName)) as never;
          if (schema) origin = "sibling";
        }
      }
      if (schema) {
        const converted = toObjectJsonSchema(schema);
        if (converted) {
          const { required, properties } = collectBranchRequired(converted);
          sites.push({
            key, method, path, file, line, schemaName, source: origin, required, properties,
            schema: converted,
          });
          continue;
        }
      }

      const inline = inlineRequiredFields(source, schemaName, shapeFromShared);
      if (inline) {
        const properties: Record<string, unknown> = {};
        for (const field of inline.properties) properties[field] = {};
        sites.push({
          key, method, path, file, line, schemaName, source: "inline",
          required: inline.required,
          properties: inline.properties,
          schema: { type: "object", properties, required: inline.required },
        });
        continue;
      }
      unresolved.push({ key, file, line, schemaName });
    }
  }
  return { sites, unresolved };
}

export async function routeBodySchemaIndex(): Promise<{
  byOperation: Map<string, RouteBodySite>;
  sites: RouteBodySite[];
  unresolved: UnresolvedRouteBodySite[];
}> {
  const { sites, unresolved } = await routeBodySchemas();
  const byOperation = new Map<string, RouteBodySite>();
  for (const site of sites) {
    const key = canonicalOperationKey(site.method, site.path);
    if (!byOperation.has(key)) byOperation.set(key, site);
  }
  return { byOperation, sites, unresolved };
}

export interface BodyExposureInput {
  parameters: ReadonlyArray<{ name: string }>;
  body?: {
    mode: "merge" | "nest";
    required: boolean;
    schema: Record<string, unknown>;
  };
}

function branchFieldNames(schema: Record<string, unknown>): Set<string> {
  const names = new Set<string>(Object.keys((schema.properties ?? {}) as Record<string, unknown>));
  const branches = [
    ...((schema.anyOf as unknown[] | undefined) ?? []),
    ...((schema.oneOf as unknown[] | undefined) ?? []),
    ...((schema.allOf as unknown[] | undefined) ?? []),
  ];
  for (const branch of branches) {
    if (!branch || typeof branch !== "object") continue;
    for (const name of branchFieldNames(branch as Record<string, unknown>)) names.add(name);
  }
  return names;
}

export function missingRequiredBodyFields(
  spec: BodyExposureInput,
  required: ReadonlyArray<string>,
): string[] {
  if (required.length === 0) return [];
  if (!spec.body) return [...required];
  if (spec.body.mode === "merge") {
    const exposed = new Set<string>(spec.parameters.map((parameter) => parameter.name));
    for (const name of branchFieldNames(spec.body.schema)) exposed.add(name);
    return required.filter((field) => exposed.has(field) === false);
  }
  const nested = branchFieldNames(spec.body.schema);
  return required.filter((field) => nested.has(field) === false);
}
