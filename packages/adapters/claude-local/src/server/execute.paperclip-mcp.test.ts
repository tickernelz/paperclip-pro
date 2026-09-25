import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProcessResult } from "@tickernelz/paperclip-pro-adapter-utils/server-utils";

const { runChildProcess, ensureCommandResolvable, resolveCommandForLogs } = vi.hoisted(() => ({
  runChildProcess: vi.fn(async (_runId: string, _command: string, args: string[]): Promise<RunProcessResult> => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: args.includes("--version")
      ? "2.1.280 (Claude Code)\n"
      : [
          JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }),
          JSON.stringify({ type: "result", session_id: "claude-session-1", result: "ok", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }),
        ].join("\n"),
    stderr: "",
    pid: 321,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "claude"),
}));

vi.mock("@tickernelz/paperclip-pro-adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@tickernelz/paperclip-pro-adapter-utils/server-utils")>(
    "@tickernelz/paperclip-pro-adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs, runChildProcess };
});

import { execute } from "./execute.js";
import { resetClaudeCliCapabilitiesCacheForTests } from "./cli-capabilities.js";

const TOOL_NAME_RE = /\bpaperclip[A-Z]\w*/;

describe("claude-local Paperclip access surface", () => {
  const cleanupDirs: string[] = [];
  let paperclipHome = "";

  beforeEach(async () => {
    paperclipHome = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-mcp-home-"));
    cleanupDirs.push(paperclipHome);
    vi.stubEnv("PAPERCLIP_HOME", paperclipHome);
    vi.stubEnv("PAPERCLIP_API_URL", "https://paperclip.test");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetClaudeCliCapabilitiesCacheForTests();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function run(config: Record<string, unknown>) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-mcp-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    let prompt = "";
    await execute({
      runId: "run-mcp",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { engine: "cli", command: "claude", cwd: workspaceDir, ...config },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
      onLog: async () => {},
      onMeta: async (meta) => {
        prompt = String(meta.prompt ?? "");
      },
      authToken: "run-jwt",
    });
    const call = runChildProcess.mock.calls.at(-1) as unknown as [string, string, string[]];
    return { args: call[2], prompt };
  }

  it("mounts the Paperclip MCP server and names its tools in the prompt", async () => {
    const { args, prompt } = await run({});
    const configIndex = args.indexOf("--mcp-config");
    expect(configIndex).toBeGreaterThan(-1);
    expect(args).toContain("--strict-mcp-config");

    const mcpConfig = JSON.parse(await readFile(args[configIndex + 1], "utf8"));
    expect(mcpConfig.mcpServers.paperclip).toEqual({
      type: "http",
      url: "https://paperclip.test/api/mcp/paperclip?toolsets=core",
      headers: {
        Authorization: "Bearer run-jwt",
        "X-Paperclip-Run-Id": "run-mcp",
      },
    });
    expect(prompt).toContain("paperclipListIssues");
    expect(prompt).toContain("paperclipAddComment");
  });

  it("passes the configured toolsets through to the mounted endpoint", async () => {
    const { args } = await run({ paperclipMcpToolsets: " extended , core " });
    const mcpConfig = JSON.parse(await readFile(args[args.indexOf("--mcp-config") + 1], "utf8"));
    expect(mcpConfig.mcpServers.paperclip.url).toContain("toolsets=extended%2Ccore");
  });

  it("teaches the REST API and mounts nothing when the toggle is off", async () => {
    const { args, prompt } = await run({ paperclipMcp: false });
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
    expect(prompt).not.toMatch(TOOL_NAME_RE);
    expect(prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(prompt).toContain("X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID");
  });
});
