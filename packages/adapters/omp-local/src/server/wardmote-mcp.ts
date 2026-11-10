import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { AdapterExecutionTarget } from "@tickernelz/wardmote-adapter-utils/execution-target";
import { writeWardmoteMcpMount } from "@tickernelz/wardmote-adapter-utils/wardmote-mcp-mount";
import {
  WARDMOTE_MCP_SERVER_NAME,
  renderWardmoteMcpConfig,
  type WardmoteMcpCommand,
} from "@tickernelz/wardmote-adapter-utils/wardmote-mcp";

export {
  WARDMOTE_MCP_BIN,
  WARDMOTE_MCP_DEFAULT_TOOLSETS,
  WARDMOTE_MCP_HTTP_PATH,
  WARDMOTE_MCP_PACKAGE,
  WARDMOTE_MCP_SERVER_NAME,
  WARDMOTE_MCP_TOOLSETS_ENV,
  buildWardmoteMcpServerEntry,
  wardmoteMcpEndpoint,
  wardmoteMcpGuidance,
  wardmoteMcpToolsets,
  wardmoteMcpTransport,
  renderWardmoteMcpConfig,
  resolveWardmoteMcpServerCommand,
  type WardmoteMcpCommand,
} from "@tickernelz/wardmote-adapter-utils/wardmote-mcp";

export const WARDMOTE_MCP_UNAVAILABLE_CODE = "paperclip_mcp_unavailable";
const MCP_CONNECT_FAILURE_LINE_MAX_CHARS = 16_384;

export interface McpConnectFailureDetector {
  push(stream: "stdout" | "stderr", chunk: string): string | null;
}

export function createMcpConnectFailureDetector(serverName: string = WARDMOTE_MCP_SERVER_NAME): McpConnectFailureDetector {
  const prefix = `Warning: MCP server "${serverName}" failed to connect`;
  const pending = {
    stdout: { text: "", overflow: false },
    stderr: { text: "", overflow: false },
  };

  const matchLine = (stream: "stdout" | "stderr", line: string): string | null => {
    const trimmed = line.trimEnd();
    if (stream === "stderr") return trimmed.startsWith(prefix) ? trimmed : null;
    if (!trimmed.startsWith("{")) return null;
    let frame: unknown;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (typeof frame !== "object" || frame === null) return null;
    const { type, message } = frame as { type?: unknown; message?: unknown };
    return type === "notice" && typeof message === "string" && message.startsWith(prefix) ? message : null;
  };

  return {
    push(stream, chunk) {
      const state = pending[stream];
      let rest = chunk;
      for (;;) {
        const newline = rest.indexOf("\n");
        if (newline < 0) {
          if (!state.overflow) {
            state.text += rest;
            if (state.text.length > MCP_CONNECT_FAILURE_LINE_MAX_CHARS) {
              state.text = "";
              state.overflow = true;
            }
          }
          return null;
        }
        const tooLong = state.overflow || state.text.length + newline > MCP_CONNECT_FAILURE_LINE_MAX_CHARS;
        const line = tooLong ? null : state.text + rest.slice(0, newline);
        state.text = "";
        state.overflow = false;
        rest = rest.slice(newline + 1);
        const hit = line === null ? null : matchLine(stream, line);
        if (hit !== null) return hit;
      }
    },
  };
}
export const WARDMOTE_MCP_CREDENTIAL_CODE = "paperclip_mcp_credential_rejected";
const PROBE_TIMEOUT_MS = 30_000;
const HTTP_PROBE_TIMEOUT_MS = 5_000;
export const WARDMOTE_MCP_UNAVAILABLE_RETRY_DELAY_MS = 45_000;

export function wardmoteMcpUnavailableRecovery(now: number = Date.now()): {
  errorFamily: "transient_upstream";
  retryNotBefore: string;
} {
  return {
    errorFamily: "transient_upstream",
    retryNotBefore: new Date(now + WARDMOTE_MCP_UNAVAILABLE_RETRY_DELAY_MS).toISOString(),
  };
}

const TRANSIENT_NETWORK_CODES: Record<string, true> = {
  ECONNREFUSED: true,
  ECONNRESET: true,
  ENOTFOUND: true,
  EAI_AGAIN: true,
  ETIMEDOUT: true,
  UND_ERR_CONNECT_TIMEOUT: true,
};
export const WARDMOTE_MCP_TRANSIENT_FAILURE_RE =
  /\b(?:timed out|timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed)\b|\b(?:HTTP|status)\s*(?:5\d\d|429)\b/i;

function isTransientNetworkError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    if ("code" in current && typeof current.code === "string" && TRANSIENT_NETWORK_CODES[current.code]) return true;
    if (current instanceof TypeError && current.message === "fetch failed") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export interface WardmoteMcpExtension {
  path: string;
  cleanup: () => Promise<void>;
}

export interface WardmoteMcpProbe {
  ok: boolean;
  detail: string;
  toolCount: number | null;
  durationMs: number;
  credentialRejected?: boolean;
  transient?: boolean;
}

/** POST `initialize` at the server-hosted endpoint; 401/403 is a credential fault, anything else is downtime. */
export async function probeWardmoteMcpEndpoint(input: {
  url: string;
  apiKey: string;
  runId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<WardmoteMcpProbe> {
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
        "X-Wardmote-Run-Id": input.runId,
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
        transient: response.status >= 500 || response.status === 429,
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
      transient: controller.signal.aborted || isTransientNetworkError(error),
      detail: controller.signal.aborted ? `no answer within ${input.timeoutMs ?? HTTP_PROBE_TIMEOUT_MS}ms` : reason,
      toolCount: null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Start the resolved server, complete the MCP handshake and list its tools. */
export async function probeWardmoteMcpServer(input: {
  command: WardmoteMcpCommand;
  env: Record<string, string>;
  timeoutMs?: number;
}): Promise<WardmoteMcpProbe> {
  const startedAt = Date.now();
  let resolve!: (value: WardmoteMcpProbe) => void;
  const promise = new Promise<WardmoteMcpProbe>((resolveProbe) => {
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
  const finish = (result: Omit<WardmoteMcpProbe, "durationMs">) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.kill("SIGTERM");
    resolve({ ...result, durationMs: Date.now() - startedAt });
  };
  const timer = setTimeout(() => {
    finish({
      ok: false,
      transient: true,
      detail: `no MCP handshake within ${input.timeoutMs ?? PROBE_TIMEOUT_MS}ms${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}`,
      toolCount: null,
    });
  }, input.timeoutMs ?? PROBE_TIMEOUT_MS);

  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("error", (error) => {
    finish({ ok: false, transient: isTransientNetworkError(error), detail: error.message, toolCount: null });
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

export async function writeWardmoteMcpExtension(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  remote: boolean;
  enabled: boolean;
  transport: "http" | "stdio";
  toolsets: string;
  command: WardmoteMcpCommand;
  env: Record<string, string>;
  remoteRootDir: string | null;
  cwd: string;
  timeoutSec: number;
  graceSec: number;
}): Promise<WardmoteMcpExtension> {
  const mount = await writeWardmoteMcpMount({
    runId: input.runId,
    target: input.target,
    remote: input.remote,
    content: renderWardmoteMcpConfig({
      enabled: input.enabled,
      transport: input.transport,
      command: input.command,
      toolsets: input.toolsets,
      env: input.env,
    }),
    fileName: ".mcp.json",
    localPrefix: "paperclip-omp-mcp-",
    remoteDir: path.posix.join(
      input.remoteRootDir ?? path.posix.join(input.cwd, ".wardmote-runtime", "omp"),
      "mcp-extension",
    ),
    cwd: input.cwd,
    env: input.env,
    timeoutSec: input.timeoutSec,
    graceSec: input.graceSec,
  });
  return { path: mount.dir, cleanup: mount.cleanup };
}
