import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { AdapterExecutionTarget } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { writePaperclipMcpMount } from "@tickernelz/paperclip-pro-adapter-utils/paperclip-mcp-mount";
import {
  renderPaperclipMcpConfig,
  type PaperclipMcpCommand,
} from "@tickernelz/paperclip-pro-adapter-utils/paperclip-mcp";

export {
  PAPERCLIP_MCP_BIN,
  PAPERCLIP_MCP_DEFAULT_TOOLSETS,
  PAPERCLIP_MCP_HTTP_PATH,
  PAPERCLIP_MCP_PACKAGE,
  PAPERCLIP_MCP_SERVER_NAME,
  PAPERCLIP_MCP_TOOLSETS_ENV,
  buildPaperclipMcpServerEntry,
  paperclipMcpEndpoint,
  paperclipMcpGuidance,
  paperclipMcpToolsets,
  paperclipMcpTransport,
  renderPaperclipMcpConfig,
  resolvePaperclipMcpServerCommand,
  type PaperclipMcpCommand,
} from "@tickernelz/paperclip-pro-adapter-utils/paperclip-mcp";

export const PAPERCLIP_MCP_UNAVAILABLE_CODE = "paperclip_mcp_unavailable";
export const PAPERCLIP_MCP_CONNECT_FAILURE_RE = /MCP server "paperclip" failed to connect/;
export const PAPERCLIP_MCP_CREDENTIAL_CODE = "paperclip_mcp_credential_rejected";
const PROBE_TIMEOUT_MS = 30_000;
const HTTP_PROBE_TIMEOUT_MS = 5_000;

export interface PaperclipMcpExtension {
  path: string;
  cleanup: () => Promise<void>;
}

export interface PaperclipMcpProbe {
  ok: boolean;
  detail: string;
  toolCount: number | null;
  durationMs: number;
  credentialRejected?: boolean;
}

/** POST `initialize` at the server-hosted endpoint; 401/403 is a credential fault, anything else is downtime. */
export async function probePaperclipMcpEndpoint(input: {
  url: string;
  apiKey: string;
  runId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PaperclipMcpProbe> {
  const startedAt = Date.now();
  const call = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? HTTP_PROBE_TIMEOUT_MS);
  try {
    const response = await call(input.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "X-Paperclip-Run-Id": input.runId,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "paperclip-omp-local", version: "1" },
        },
      }),
    });
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        credentialRejected: true,
        detail: `the endpoint rejected this run's credentials (HTTP ${response.status})`,
        toolCount: null,
        durationMs: Date.now() - startedAt,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        detail: `HTTP ${response.status}: ${body.slice(0, 200)}`,
        toolCount: null,
        durationMs: Date.now() - startedAt,
      };
    }
    let parsed: { result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return {
        ok: false,
        detail: `the endpoint answered with non-JSON: ${body.slice(0, 200)}`,
        toolCount: null,
        durationMs: Date.now() - startedAt,
      };
    }
    if (parsed.error || !parsed.result) {
      return {
        ok: false,
        detail: parsed.error?.message ?? "initialize returned no result",
        toolCount: null,
        durationMs: Date.now() - startedAt,
      };
    }
    return { ok: true, detail: "handshake ok", toolCount: null, durationMs: Date.now() - startedAt };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: controller.signal.aborted ? `no answer within ${input.timeoutMs ?? HTTP_PROBE_TIMEOUT_MS}ms` : reason,
      toolCount: null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
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
  transport: "http" | "stdio";
  toolsets: string;
  command: PaperclipMcpCommand;
  env: Record<string, string>;
  remoteRootDir: string | null;
  cwd: string;
  timeoutSec: number;
  graceSec: number;
}): Promise<PaperclipMcpExtension> {
  const mount = await writePaperclipMcpMount({
    runId: input.runId,
    target: input.target,
    remote: input.remote,
    content: renderPaperclipMcpConfig({
      enabled: input.enabled,
      transport: input.transport,
      command: input.command,
      toolsets: input.toolsets,
      env: input.env,
    }),
    fileName: ".mcp.json",
    localPrefix: "paperclip-omp-mcp-",
    remoteDir: path.posix.join(
      input.remoteRootDir ?? path.posix.join(input.cwd, ".paperclip-runtime", "omp"),
      "mcp-extension",
    ),
    cwd: input.cwd,
    env: input.env,
    timeoutSec: input.timeoutSec,
    graceSec: input.graceSec,
  });
  return { path: mount.dir, cleanup: mount.cleanup };
}
