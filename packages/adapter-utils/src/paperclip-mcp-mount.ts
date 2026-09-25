import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AdapterExecutionTarget,
  runAdapterExecutionTargetShellCommand,
} from "./execution-target.js";
import {
  PAPERCLIP_MCP_SERVER_NAME,
  paperclipMcpEndpoint,
  paperclipMcpHttpHeaders,
} from "./paperclip-mcp.js";

export interface PaperclipMcpMount {
  dir: string;
  filePath: string;
  cleanup: () => Promise<void>;
}

export interface PaperclipMcpHttpTarget {
  url: string;
  headers: Record<string, string>;
}

/** Resolve the run's server-hosted MCP endpoint and the headers that authenticate it. */
export function paperclipMcpHttpTarget(input: {
  env: Record<string, string | undefined>;
  toolsets: string;
}): PaperclipMcpHttpTarget {
  return {
    url: paperclipMcpEndpoint(input.env.PAPERCLIP_API_URL ?? "", input.toolsets),
    headers: paperclipMcpHttpHeaders({
      apiKey: (input.env.PAPERCLIP_API_KEY ?? "").trim(),
      runId: input.env.PAPERCLIP_RUN_ID ?? "",
    }),
  };
}

/** Gemini CLI settings.json: streamable HTTP servers use `httpUrl`. */
export function renderPaperclipGeminiSettings(target: PaperclipMcpHttpTarget): string {
  const settings = {
    mcpServers: {
      [PAPERCLIP_MCP_SERVER_NAME]: { httpUrl: target.url, headers: target.headers },
    },
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** OpenCode config: remote servers live under `mcp` with `type: "remote"`. */
export function renderPaperclipOpenCodeConfig(target: PaperclipMcpHttpTarget): string {
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      [PAPERCLIP_MCP_SERVER_NAME]: {
        type: "remote",
        url: target.url,
        enabled: true,
        oauth: false,
        headers: target.headers,
      },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Grok CLI config overlay: `[mcp_servers.<name>]` with an inline headers table. */
export function renderPaperclipGrokConfig(target: PaperclipMcpHttpTarget): string {
  const headers = Object.entries(target.headers)
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ");
  return [
    `[mcp_servers.${tomlString(PAPERCLIP_MCP_SERVER_NAME)}]`,
    `url = ${tomlString(target.url)}`,
    "enabled = true",
    `headers = { ${headers} }`,
    "",
  ].join("\n");
}

function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Write a run-scoped config file locally or on the execution target, with a cleanup that removes it. */
export async function writePaperclipMcpMount(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  remote: boolean;
  content: string;
  fileName: string;
  localPrefix: string;
  remoteDir: string | null;
  cwd: string;
  env: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
}): Promise<PaperclipMcpMount> {
  if (!input.remote) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), input.localPrefix));
    await fs.chmod(dir, 0o700);
    const filePath = path.join(dir, input.fileName);
    await fs.writeFile(filePath, input.content, { encoding: "utf8", mode: 0o600 });
    return {
      dir,
      filePath,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  const dir = input.remoteDir ?? path.posix.join(input.cwd, ".paperclip-runtime", "mcp");
  const filePath = path.posix.join(dir, input.fileName);
  const quotedDir = shellQuoteSingle(dir);
  const quotedFile = shellQuoteSingle(filePath);
  const shellOptions = {
    cwd: input.cwd,
    env: input.env,
    timeoutSec: Math.min(input.timeoutSec || 15, 15),
    graceSec: Math.min(input.graceSec, 5),
  };
  const heredoc = [
    `mkdir -p ${quotedDir}`,
    `cat > ${quotedFile} <<'PAPERCLIP_MCP_MOUNT'`,
    input.content.replace(/\n$/, ""),
    "PAPERCLIP_MCP_MOUNT",
    `chmod 600 ${quotedFile}`,
  ].join("\n");
  await runAdapterExecutionTargetShellCommand(input.runId, input.target, heredoc, shellOptions);
  return {
    dir,
    filePath,
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
