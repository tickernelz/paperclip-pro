import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runChildProcess, ensureCommandResolvable, resolveCommandForLogs } = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 654,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "/usr/bin/codex"),
}));

vi.mock("@tickernelz/paperclip-pro-adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@tickernelz/paperclip-pro-adapter-utils/server-utils")>(
    "@tickernelz/paperclip-pro-adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs, runChildProcess };
});

import { execute } from "./execute.js";

const TOOL_NAME_RE = /\bpaperclip[A-Z]\w*/;

describe("codex-local Paperclip access surface", () => {
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    vi.stubEnv("PAPERCLIP_API_URL", "https://paperclip.test");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function run(config: Record<string, unknown>) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-codex-mcp-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHome = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    let prompt = "";
    await execute({
      runId: "run-mcp",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "codex", engine: "cli", env: { CODEX_HOME: codexHome }, ...config },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
      onLog: async () => {},
      onMeta: async (meta) => {
        prompt = String(meta.prompt ?? "");
      },
      authToken: "run-jwt",
    });
    return { prompt, codexConfig: await readFile(path.join(codexHome, "config.toml"), "utf8") };
  }

  it("writes the Paperclip MCP server into the Codex config and names its tools", async () => {
    const { prompt, codexConfig } = await run({});
    expect(codexConfig).toContain('[mcp_servers."paperclip"]');
    expect(codexConfig).toContain('url = "https://paperclip.test/api/mcp/paperclip?toolsets=core"');
    expect(codexConfig).toContain('Authorization = "Bearer run-jwt"');
    expect(codexConfig).toContain('X-Paperclip-Run-Id = "run-mcp"');
    expect(prompt).toContain("paperclipListIssues");
    expect(prompt).toContain("paperclipAddComment");
  });

  it("teaches the REST API and writes no server when the toggle is off", async () => {
    const { prompt, codexConfig } = await run({ paperclipMcp: false });
    expect(codexConfig).not.toContain("mcp_servers.");
    expect(prompt).not.toMatch(TOOL_NAME_RE);
    expect(prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(prompt).toContain("X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID");
  });
});
