import { existsSync } from "node:fs";
import path from "node:path";

export const PAPERCLIP_MCP_SERVER_NAME = "paperclip";
export const PAPERCLIP_MCP_PACKAGE = "@tickernelz/paperclip-pro-mcp-server";
export const PAPERCLIP_MCP_BIN = "paperclip-mcp-server";
export const PAPERCLIP_MCP_DEFAULT_TOOLSETS = "core";
export const PAPERCLIP_MCP_TOOLSETS_ENV = "PAPERCLIP_MCP_TOOLSETS";
export const PAPERCLIP_MCP_HTTP_PATH = "/mcp/paperclip";
export const PAPERCLIP_MCP_RUN_ID_HEADER = "X-Paperclip-Run-Id";

const RUN_ENV_KEYS = [
  "PAPERCLIP_API_URL",
  "PAPERCLIP_API_KEY",
  "PAPERCLIP_COMPANY_ID",
  "PAPERCLIP_AGENT_ID",
  "PAPERCLIP_RUN_ID",
] as const;

/** Which Paperclip access surface an adapter arms for a run. */
export type PaperclipAccessMode = "mcp" | "rest";

export type PaperclipMcpTransportKind = "http" | "stdio";

export interface PaperclipMcpCommand {
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

export function paperclipMcpToolsets(config: Record<string, unknown>): string {
  const parts = (typeof config.paperclipMcpToolsets === "string" ? config.paperclipMcpToolsets : "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(",") : PAPERCLIP_MCP_DEFAULT_TOOLSETS;
}

export function paperclipMcpTransport(config: Record<string, unknown>): PaperclipMcpTransportKind {
  return config.paperclipMcpTransport === "stdio" ? "stdio" : "http";
}

/** Server-hosted MCP endpoint for this run, mirroring the API base the REST path uses. */
export function paperclipMcpEndpoint(apiUrl: string, toolsets: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  const base = trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  return `${base}${PAPERCLIP_MCP_HTTP_PATH}?toolsets=${encodeURIComponent(toolsets)}`;
}

/** MCP needs the `paperclipMcp` toggle on plus an API base and a run credential; everything else is REST. */
export function paperclipAccessMode(
  config: Record<string, unknown>,
  env: Record<string, string | undefined>,
): PaperclipAccessMode {
  if (!readToggle(config.paperclipMcp, true)) return "rest";
  if (!(env.PAPERCLIP_API_URL ?? "").trim()) return "rest";
  if (!(env.PAPERCLIP_API_KEY ?? "").trim()) return "rest";
  return "mcp";
}

export function paperclipMcpHttpHeaders(input: {
  apiKey: string;
  runId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${input.apiKey}` };
  const runId = (input.runId ?? "").trim();
  if (runId) headers[PAPERCLIP_MCP_RUN_ID_HEADER] = runId;
  return headers;
}

/** Locate the stdio MCP server shipped with this install: nearest `.bin` shim, then `dist/stdio.js`, then PATH. */
export function resolvePaperclipMcpServerCommand(options: {
  searchFrom?: string;
  exists?: (candidate: string) => boolean;
  nodePath?: string;
} = {}): PaperclipMcpCommand {
  const exists = options.exists ?? existsSync;
  const nodePath = options.nodePath ?? process.execPath;
  let dir = path.resolve(options.searchFrom ?? import.meta.dirname);
  for (;;) {
    const modules = path.join(dir, "node_modules");
    const bin = path.join(modules, ".bin", PAPERCLIP_MCP_BIN);
    if (exists(bin)) return { command: bin, args: [], source: "bin" };
    const dist = path.join(modules, PAPERCLIP_MCP_PACKAGE, "dist", "stdio.js");
    if (exists(dist)) return { command: nodePath, args: [dist], source: "dist" };
    const parent = path.dirname(dir);
    if (parent === dir) return { command: PAPERCLIP_MCP_BIN, args: [], source: "path" };
    dir = parent;
  }
}

export interface PaperclipMcpServerEntryInput {
  enabled: boolean;
  transport: PaperclipMcpTransportKind;
  command: PaperclipMcpCommand;
  toolsets: string;
  env: Record<string, string>;
  /** `placeholder` emits `${PAPERCLIP_API_KEY}` for runtimes that expand env references; `literal` writes the token. */
  credential?: "placeholder" | "literal";
}

export function buildPaperclipMcpServerEntry(
  input: PaperclipMcpServerEntryInput,
): Record<string, unknown> {
  const literal = input.credential === "literal";
  const apiKey = (input.env.PAPERCLIP_API_KEY ?? "").trim();
  if (input.transport === "http") {
    return {
      type: "http",
      enabled: input.enabled,
      url: paperclipMcpEndpoint(input.env.PAPERCLIP_API_URL ?? "", input.toolsets),
      headers: paperclipMcpHttpHeaders({
        apiKey: literal ? apiKey : "${PAPERCLIP_API_KEY}",
        runId: input.env.PAPERCLIP_RUN_ID ?? "",
      }),
    };
  }
  const env: Record<string, string> = {};
  for (const key of RUN_ENV_KEYS) {
    const value = input.env[key];
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = key === "PAPERCLIP_API_KEY" && !literal ? `\${${key}}` : value.trim();
  }
  env[PAPERCLIP_MCP_TOOLSETS_ENV] = input.toolsets;
  return {
    type: "stdio",
    enabled: input.enabled,
    command: input.command.command,
    args: [...input.command.args, "--toolsets", input.toolsets],
    env,
  };
}

export function renderPaperclipMcpConfig(input: PaperclipMcpServerEntryInput): string {
  const servers = { [PAPERCLIP_MCP_SERVER_NAME]: buildPaperclipMcpServerEntry(input) };
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

export function paperclipMcpGuidance(toolsets: string, toolCount: number | null = null): string {
  const lines = [
    `Paperclip's API is mounted as MCP tools on the "${PAPERCLIP_MCP_SERVER_NAME}" server (toolsets: ${toolsets}${toolCount === null ? "" : `, ${toolCount} tools`}).`,
    'Every tool name starts with "paperclip", for example paperclipListIssues or paperclipAddComment.',
    "These tools are the only way to reach Paperclip; they already carry this run's identity, API key and run id.",
    `When no dedicated tool covers an endpoint, use the ${PAPERCLIP_MCP_SERVER_NAME} escape-hatch tool paperclipApiRequest instead of a shell HTTP client.`,
  ];
  if (/\b(extended|all)\b/i.test(toolsets)) {
    lines.push(
      `For a one-off call the escape hatch is cheaper than carrying the extended surface, and paperclipApiRequest is always available.`,
    );
  }
  return lines.join("\n");
}

/** Guidance for runtimes without the Paperclip MCP: reach the board over REST with the run credentials in env. */
export function paperclipRestGuidance(options: { shellHint?: string } = {}): string {
  const shell = options.shellHint?.trim();
  return [
    "This runtime has no paperclip* tools. Reach Paperclip over its REST API instead.",
    shell
      ? `Use ${shell} with curl; normalize the base URL first: PAPERCLIP_API_BASE="\${PAPERCLIP_API_URL%/}"; PAPERCLIP_API_BASE="\${PAPERCLIP_API_BASE%/api}".`
      : 'Use a terminal with curl; normalize the base URL first: PAPERCLIP_API_BASE="${PAPERCLIP_API_URL%/}"; PAPERCLIP_API_BASE="${PAPERCLIP_API_BASE%/api}".',
    'Send `Authorization: Bearer $PAPERCLIP_API_KEY` on every request and `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on every mutation.',
    "GET example:",
    '  curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_BASE/api/agents/me"',
    "Write example:",
    '  curl -s -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "Content-Type: application/json" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -d \'{"body":"Status update from agent."}\' "$PAPERCLIP_API_BASE/api/issues/$PAPERCLIP_TASK_ID/comments"',
    "Never send a placeholder like {id} in a URL; substitute a real issue id from the current context.",
    "Do not copy printed tokens into comments or config; reference the environment variables.",
  ].join("\n");
}

export function paperclipAccessGuidance(
  access: PaperclipAccessMode,
  options: { toolsets?: string; toolCount?: number | null; shellHint?: string } = {},
): string {
  return access === "mcp"
    ? paperclipMcpGuidance(options.toolsets ?? PAPERCLIP_MCP_DEFAULT_TOOLSETS, options.toolCount ?? null)
    : paperclipRestGuidance({ shellHint: options.shellHint });
}
