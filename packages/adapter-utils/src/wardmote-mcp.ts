import { existsSync } from "node:fs";
import path from "node:path";

export const WARDMOTE_MCP_SERVER_NAME = "wardmote";
export const WARDMOTE_MCP_PACKAGE = "@tickernelz/wardmote-mcp-server";
export const WARDMOTE_MCP_BIN = "wardmote-mcp-server";
export const WARDMOTE_MCP_DEFAULT_TOOLSETS = "core";
export const WARDMOTE_MCP_TOOLSETS_ENV = "WARDMOTE_MCP_TOOLSETS";
export const WARDMOTE_MCP_HTTP_PATH = "/mcp/wardmote";
export const WARDMOTE_MCP_RUN_ID_HEADER = "X-Wardmote-Run-Id";

const RUN_ENV_KEYS = [
  "WARDMOTE_API_URL",
  "WARDMOTE_API_KEY",
  "WARDMOTE_COMPANY_ID",
  "WARDMOTE_AGENT_ID",
  "WARDMOTE_RUN_ID",
] as const;

export type WardmoteAccessMode = "mcp" | "rest";

export type WardmoteMcpTransportKind = "http" | "stdio";

export interface WardmoteMcpCommand {
  command: string;
  args: string[];
  source: "bin" | "dist" | "path";
}

function readToggle(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function wardmoteMcpToolsets(config: Record<string, unknown>): string {
  const parts = (typeof config.wardmoteMcpToolsets === "string" ? config.wardmoteMcpToolsets : "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(",") : WARDMOTE_MCP_DEFAULT_TOOLSETS;
}

export function wardmoteMcpTransport(config: Record<string, unknown>): WardmoteMcpTransportKind {
  return config.wardmoteMcpTransport === "stdio" ? "stdio" : "http";
}

/** Server-hosted MCP endpoint for this run, mirroring the API base the REST path uses. */
export function wardmoteMcpEndpoint(apiUrl: string, toolsets: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  const base = trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  return `${base}${WARDMOTE_MCP_HTTP_PATH}?toolsets=${encodeURIComponent(toolsets)}`;
}

/** MCP needs the `wardmoteMcp` toggle on plus an API base and a run credential; everything else is REST. */
export function wardmoteAccessMode(
  config: Record<string, unknown>,
  env: Record<string, string | undefined>,
): WardmoteAccessMode {
  if (!readToggle(config.wardmoteMcp, true)) return "rest";
  if (!(env.WARDMOTE_API_URL ?? "").trim()) return "rest";
  if (!(env.WARDMOTE_API_KEY ?? "").trim()) return "rest";
  return "mcp";
}

export function wardmoteMcpHttpHeaders(input: {
  apiKey: string;
  runId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${input.apiKey}` };
  const runId = (input.runId ?? "").trim();
  if (runId) headers[WARDMOTE_MCP_RUN_ID_HEADER] = runId;
  return headers;
}

/** Locate the stdio MCP server shipped with this install: nearest `.bin` shim, then `dist/stdio.js`, then PATH. */
export function resolveWardmoteMcpServerCommand(options: {
  searchFrom?: string;
  exists?: (candidate: string) => boolean;
  nodePath?: string;
} = {}): WardmoteMcpCommand {
  const exists = options.exists ?? existsSync;
  const nodePath = options.nodePath ?? process.execPath;
  let dir = path.resolve(options.searchFrom ?? import.meta.dirname);
  for (;;) {
    const modules = path.join(dir, "node_modules");
    const bin = path.join(modules, ".bin", WARDMOTE_MCP_BIN);
    if (exists(bin)) return { command: bin, args: [], source: "bin" };
    const dist = path.join(modules, WARDMOTE_MCP_PACKAGE, "dist", "stdio.js");
    if (exists(dist)) return { command: nodePath, args: [dist], source: "dist" };
    const parent = path.dirname(dir);
    if (parent === dir) return { command: WARDMOTE_MCP_BIN, args: [], source: "path" };
    dir = parent;
  }
}

export interface WardmoteMcpServerEntryInput {
  enabled: boolean;
  transport: WardmoteMcpTransportKind;
  command: WardmoteMcpCommand;
  toolsets: string;
  env: Record<string, string>;
  /** `placeholder` emits `${WARDMOTE_API_KEY}` for runtimes that expand env references; `literal` writes the token. */
  credential?: "placeholder" | "literal";
}

export function buildWardmoteMcpServerEntry(
  input: WardmoteMcpServerEntryInput,
): Record<string, unknown> {
  const literal = input.credential === "literal";
  const apiKey = (input.env.WARDMOTE_API_KEY ?? "").trim();
  if (input.transport === "http") {
    return {
      type: "http",
      enabled: input.enabled,
      url: wardmoteMcpEndpoint(input.env.WARDMOTE_API_URL ?? "", input.toolsets),
      headers: wardmoteMcpHttpHeaders({
        apiKey: literal ? apiKey : "${WARDMOTE_API_KEY}",
        runId: input.env.WARDMOTE_RUN_ID ?? "",
      }),
    };
  }
  const env: Record<string, string> = {};
  for (const key of RUN_ENV_KEYS) {
    const value = input.env[key];
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = key === "WARDMOTE_API_KEY" && !literal ? `\${${key}}` : value.trim();
  }
  env[WARDMOTE_MCP_TOOLSETS_ENV] = input.toolsets;
  return {
    type: "stdio",
    enabled: input.enabled,
    command: input.command.command,
    args: [...input.command.args, "--toolsets", input.toolsets],
    env,
  };
}

export function renderWardmoteMcpConfig(input: WardmoteMcpServerEntryInput): string {
  const servers = { [WARDMOTE_MCP_SERVER_NAME]: buildWardmoteMcpServerEntry(input) };
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

export function wardmoteMcpGuidance(toolsets: string, toolCount: number | null = null): string {
  const lines = [
    `Wardmote's API is mounted as MCP tools on the "${WARDMOTE_MCP_SERVER_NAME}" server (toolsets: ${toolsets}${toolCount === null ? "" : `, ${toolCount} tools`}).`,
    'Every tool name starts with "wardmote", for example wardmoteListIssues or wardmoteAddComment.',
    "These tools are the only way to reach Wardmote; they already carry this run's identity, API key and run id.",
    `When no dedicated tool covers an endpoint, use the ${WARDMOTE_MCP_SERVER_NAME} escape-hatch tool wardmoteApiRequest instead of a shell HTTP client.`,
  ];
  if (/\b(full|extended|all)\b/i.test(toolsets)) {
    lines.push(
      `For a one-off call the escape hatch is cheaper than carrying the extended surface, and wardmoteApiRequest is always available.`,
    );
  }
  return lines.join("\n");
}

export function wardmoteRestGuidance(options: { shellHint?: string } = {}): string {
  const shell = options.shellHint?.trim();
  return [
    "This runtime has no wardmote* tools. Reach Wardmote over its REST API instead.",
    shell
      ? `Use ${shell} with curl; normalize the base URL first: WARDMOTE_API_BASE="\${WARDMOTE_API_URL%/}"; WARDMOTE_API_BASE="\${WARDMOTE_API_BASE%/api}".`
      : 'Use a terminal with curl; normalize the base URL first: WARDMOTE_API_BASE="${WARDMOTE_API_URL%/}"; WARDMOTE_API_BASE="${WARDMOTE_API_BASE%/api}".',
    'Send `Authorization: Bearer $WARDMOTE_API_KEY` on every request and `X-Wardmote-Run-Id: $WARDMOTE_RUN_ID` on every mutation.',
    "GET example:",
    '  curl -s -H "Authorization: Bearer $WARDMOTE_API_KEY" "$WARDMOTE_API_BASE/api/agents/me"',
    "Write example:",
    '  curl -s -X POST -H "Authorization: Bearer $WARDMOTE_API_KEY" -H "Content-Type: application/json" -H "X-Wardmote-Run-Id: $WARDMOTE_RUN_ID" -d \'{"body":"Status update from agent."}\' "$WARDMOTE_API_BASE/api/issues/$WARDMOTE_TASK_ID/comments"',
    "Never send a placeholder like {id} in a URL; substitute a real issue id from the current context.",
    "Do not copy printed tokens into comments or config; reference the environment variables.",
  ].join("\n");
}

export function wardmoteAccessGuidance(
  access: WardmoteAccessMode,
  options: { toolsets?: string; toolCount?: number | null; shellHint?: string } = {},
): string {
  return access === "mcp"
    ? wardmoteMcpGuidance(options.toolsets ?? WARDMOTE_MCP_DEFAULT_TOOLSETS, options.toolCount ?? null)
    : wardmoteRestGuidance({ shellHint: options.shellHint });
}
