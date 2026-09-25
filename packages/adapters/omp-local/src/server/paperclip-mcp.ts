import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AdapterExecutionTarget,
  runAdapterExecutionTargetShellCommand,
} from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { asString } from "@tickernelz/paperclip-pro-adapter-utils/server-utils";

export const PAPERCLIP_MCP_SERVER_NAME = "paperclip";
export const PAPERCLIP_MCP_PACKAGE = "@tickernelz/paperclip-pro-mcp-server";
export const PAPERCLIP_MCP_BIN = "paperclip-mcp-server";
export const PAPERCLIP_MCP_DEFAULT_TOOLSETS = "core";
export const PAPERCLIP_MCP_TOOLSETS_ENV = "PAPERCLIP_MCP_TOOLSETS";
export const PAPERCLIP_MCP_UNAVAILABLE_CODE = "paperclip_mcp_unavailable";
export const PAPERCLIP_MCP_CONNECT_FAILURE_RE = /MCP server "paperclip" failed to connect/;
const PROBE_TIMEOUT_MS = 30_000;

const RUN_ENV_KEYS = [
  "PAPERCLIP_API_URL",
  "PAPERCLIP_API_KEY",
  "PAPERCLIP_COMPANY_ID",
  "PAPERCLIP_AGENT_ID",
  "PAPERCLIP_RUN_ID",
] as const;

export interface PaperclipMcpCommand {
  command: string;
  args: string[];
  source: "bin" | "dist" | "path";
}

export interface PaperclipMcpExtension {
  path: string;
  cleanup: () => Promise<void>;
}

export function paperclipMcpToolsets(config: Record<string, unknown>): string {
  const parts = asString(config.paperclipMcpToolsets, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(",") : PAPERCLIP_MCP_DEFAULT_TOOLSETS;
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

export function buildPaperclipMcpServerEntry(input: {
  enabled: boolean;
  command: PaperclipMcpCommand;
  toolsets: string;
  env: Record<string, string>;
}): Record<string, unknown> {
  const env: Record<string, string> = {};
  for (const key of RUN_ENV_KEYS) {
    const value = input.env[key];
    if (typeof value === "string" && value.trim()) env[key] = `\${${key}}`;
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

export function renderPaperclipMcpConfig(input: {
  enabled: boolean;
  command: PaperclipMcpCommand;
  toolsets: string;
  env: Record<string, string>;
}): string {
  const servers = { [PAPERCLIP_MCP_SERVER_NAME]: buildPaperclipMcpServerEntry(input) };
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

export function paperclipMcpGuidance(toolsets: string, toolCount: number | null): string {
  return [
    `Paperclip's API is mounted as MCP tools on the "${PAPERCLIP_MCP_SERVER_NAME}" server (toolsets: ${toolsets}${toolCount === null ? "" : `, ${toolCount} tools`}).`,
    'Every tool name starts with "paperclip", for example paperclipListIssues or paperclipAddComment.',
    "These tools are the only way to reach Paperclip; they already carry this run's identity, API key and run id.",
    `When no dedicated tool covers an endpoint, use the ${PAPERCLIP_MCP_SERVER_NAME} escape-hatch tool paperclipApiRequest instead of a shell HTTP client.`,
  ].join("\n");
}

export interface PaperclipMcpProbe {
  ok: boolean;
  detail: string;
  toolCount: number | null;
  durationMs: number;
}

/** Start the resolved server, complete the MCP handshake and list its tools. */
export async function probePaperclipMcpServer(input: {
  command: PaperclipMcpCommand;
  env: Record<string, string>;
  timeoutMs?: number;
}): Promise<PaperclipMcpProbe> {
  const startedAt = Date.now();
  let resolve!: (value: PaperclipMcpProbe) => void;
  const promise = new Promise<PaperclipMcpProbe>((resolveProbe) => {
    resolve = resolveProbe;
  });
  let child: ChildProcess;
  try {
    child = spawn(input.command.command, input.command.args, {
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      toolCount: null,
      durationMs: Date.now() - startedAt,
    };
  }

  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (result: Omit<PaperclipMcpProbe, "durationMs">) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.kill("SIGTERM");
    resolve({ ...result, durationMs: Date.now() - startedAt });
  };
  const timer = setTimeout(() => {
    finish({
      ok: false,
      detail: `no MCP handshake within ${input.timeoutMs ?? PROBE_TIMEOUT_MS}ms${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}`,
      toolCount: null,
    });
  }, input.timeoutMs ?? PROBE_TIMEOUT_MS);

  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("error", (error) => {
    finish({ ok: false, detail: error.message, toolCount: null });
  });
  child.on("exit", (code, signal) => {
    finish({
      ok: false,
      detail: `server exited early (code ${code ?? "null"}, signal ${signal ?? "null"})${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}`,
      toolCount: null,
    });
  });
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      newline = stdout.indexOf("\n");
      if (!line) continue;
      let message: { id?: unknown; result?: { tools?: unknown[] }; error?: { message?: string } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (message.error) {
        finish({ ok: false, detail: message.error.message ?? "MCP error response", toolCount: null });
        return;
      }
      if (message.id === 1) {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
        continue;
      }
      if (message.id === 2) {
        const tools = message.result?.tools;
        finish({
          ok: Array.isArray(tools) && tools.length > 0,
          detail: Array.isArray(tools) && tools.length > 0 ? "handshake ok" : "server advertised no tools",
          toolCount: Array.isArray(tools) ? tools.length : null,
        });
        return;
      }
    }
  });

  child.stdin?.on("error", () => {});
  child.stdin?.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "paperclip-omp-local", version: "1" },
      },
    })}\n`,
  );
  return await promise;
}

export async function writePaperclipMcpExtension(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  remote: boolean;
  enabled: boolean;
  toolsets: string;
  command: PaperclipMcpCommand;
  env: Record<string, string>;
  remoteRootDir: string | null;
  cwd: string;
  timeoutSec: number;
  graceSec: number;
}): Promise<PaperclipMcpExtension> {
  const content = renderPaperclipMcpConfig({
    enabled: input.enabled,
    command: input.command,
    toolsets: input.toolsets,
    env: input.env,
  });
  if (!input.remote) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-mcp-"));
    await fs.chmod(dir, 0o700);
    await fs.writeFile(path.join(dir, ".mcp.json"), content, { encoding: "utf8", mode: 0o600 });
    return {
      path: dir,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  const rootDir = input.remoteRootDir ?? path.posix.join(input.cwd, ".paperclip-runtime", "omp");
  const dir = path.posix.join(rootDir, "mcp-extension");
  const quotedDir = `'${dir.replaceAll("'", "'\\''")}'`;
  const quotedFile = `'${path.posix.join(dir, ".mcp.json").replaceAll("'", "'\\''")}'`;
  const shellOptions = {
    cwd: input.cwd,
    env: input.env,
    timeoutSec: Math.min(input.timeoutSec || 15, 15),
    graceSec: Math.min(input.graceSec, 5),
  };
  const heredoc = [
    `mkdir -p ${quotedDir}`,
    `cat > ${quotedFile} <<'PAPERCLIP_OMP_MCP'`,
    content.replace(/\n$/, ""),
    "PAPERCLIP_OMP_MCP",
    `chmod 600 ${quotedFile}`,
  ].join("\n");
  await runAdapterExecutionTargetShellCommand(input.runId, input.target, heredoc, shellOptions);
  return {
    path: dir,
    cleanup: async () => {
      await runAdapterExecutionTargetShellCommand(
        input.runId,
        input.target,
        `rm -rf ${quotedDir}`,
        shellOptions,
      ).catch(() => {});
    },
  };
}
