import type { ToolsetName } from "./tool-overrides.js";

export interface PaperclipMcpConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string | null;
  agentId: string | null;
  runId: string | null;
  toolsets: ToolsetName[];
  agentRole: string | null;
}

export const MANAGEMENT_ROLES: Record<string, true> = { ceo: true, board: true };

export function hasManagementAuthority(role: string | null | undefined): boolean {
  return typeof role === "string" && MANAGEMENT_ROLES[role.trim().toLowerCase()] === true;
}

export const TOOLSET_NAMES: ToolsetName[] = ["core", "extended"];

export function parseToolsets(requested: string | null | undefined): ToolsetName[] {
  const requestedNames = (requested ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (requestedNames.includes("all")) return [...TOOLSET_NAMES];
  const selected = TOOLSET_NAMES.filter((name) => requestedNames.includes(name));
  return selected.length > 0 ? selected : ["core"];
}

export function resolveToolsets(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): ToolsetName[] {
  const flagIndex = argv.indexOf("--toolsets");
  const inline = argv.find((entry) => entry.startsWith("--toolsets="));
  const requested =
    (flagIndex >= 0 ? argv[flagIndex + 1] : undefined) ??
    inline?.slice("--toolsets=".length) ??
    env.PAPERCLIP_MCP_TOOLSETS;
  for (const name of (requested ?? "").split(",").map((entry) => entry.trim().toLowerCase())) {
    if (name && name !== "all" && !TOOLSET_NAMES.includes(name as ToolsetName)) {
      console.error(`Ignoring unknown Paperclip MCP toolset "${name}"`);
    }
  }
  return parseToolsets(requested);
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeApiUrl(apiUrl: string): string {
  const trimmed = stripTrailingSlash(apiUrl.trim());
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaperclipMcpConfig {
  const apiUrl = nonEmpty(env.PAPERCLIP_API_URL);
  if (!apiUrl) {
    throw new Error("Missing PAPERCLIP_API_URL");
  }
  const apiKey = nonEmpty(env.PAPERCLIP_API_KEY);
  if (!apiKey) {
    throw new Error("Missing PAPERCLIP_API_KEY");
  }

  return {
    apiUrl: normalizeApiUrl(apiUrl),
    apiKey,
    companyId: nonEmpty(env.PAPERCLIP_COMPANY_ID),
    agentId: nonEmpty(env.PAPERCLIP_AGENT_ID),
    runId: nonEmpty(env.PAPERCLIP_RUN_ID),
    toolsets: resolveToolsets(env),
    agentRole: nonEmpty(env.PAPERCLIP_AGENT_ROLE),
  };
}
