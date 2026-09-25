import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type * as ExecutionTargetModule from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import type * as ServerUtilsModule from "@tickernelz/paperclip-pro-adapter-utils/server-utils";

const {
  capture,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  readPaperclipRuntimeSkillEntries,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
} = vi.hoisted(() => {
  const capture: { env: Record<string, string>; settings: string | null } = { env: {}, settings: null };
  return {
    capture,
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
    ensureAdapterExecutionTargetRuntimeCommandInstalled: vi.fn(async () => undefined),
    readPaperclipRuntimeSkillEntries: vi.fn(async () => []),
    resolveAdapterExecutionTargetCommandForLogs: vi.fn(async () => "gemini"),
    runAdapterExecutionTargetProcess: vi.fn(async (...args: unknown[]) => {
      const options = args[4] as { env?: Record<string, string> } | undefined;
      capture.env = { ...(options?.env ?? {}) };
      const settingsPath = capture.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      capture.settings = settingsPath ? await fs.readFile(settingsPath, "utf8") : null;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "init", session_id: "gemini-session-1" }),
          JSON.stringify({ type: "result", status: "success", stats: {} }),
        ].join("\n"),
        stderr: "",
        pid: 123,
        startedAt: new Date().toISOString(),
      };
    }),
  };
});

vi.mock("./acp.js", () => ({
  createGeminiAcpExecutor: () => vi.fn(async () => {
    throw new Error("ACP must not run in this test");
  }),
  resolveGeminiExecutionEngineForRun: async () => ({ engine: "cli", explicit: true }),
}));

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof ExecutionTargetModule>(
    "@tickernelz/paperclip-pro-adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetCommandResolvable,
    ensureAdapterExecutionTargetRuntimeCommandInstalled,
    resolveAdapterExecutionTargetCommandForLogs,
    runAdapterExecutionTargetProcess,
  };
});

vi.mock("@tickernelz/paperclip-pro-adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof ServerUtilsModule>(
    "@tickernelz/paperclip-pro-adapter-utils/server-utils",
  );
  return { ...actual, readPaperclipRuntimeSkillEntries };
});

import { execute } from "./execute.js";

const MCP_TOOL_NAME_RE = /\bpaperclip[A-Z]\w+/;

async function runGemini(config: Record<string, unknown>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-gemini-mcp-test-"));
  let prompt = "";
  try {
    await execute({
      runId: "run-mcp-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Gemini Coder",
        adapterType: "gemini_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { engine: "cli", cwd, command: "gemini", env: { GEMINI_API_KEY: "test-key" }, ...config },
      context: {},
      authToken: "run-token",
      onLog: async () => {},
      onMeta: async (meta: { prompt?: string }) => {
        prompt = String(meta.prompt ?? "");
      },
    } as never);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
  return prompt;
}

describe("gemini_local Paperclip MCP coherence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.env = {};
    capture.settings = null;
  });

  it("mounts the Paperclip MCP server through system settings and names the tools in the prompt", async () => {
    const prompt = await runGemini({});

    const settingsPath = capture.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    expect(settingsPath).toBeTruthy();
    const settings = JSON.parse(String(capture.settings)) as {
      mcpServers: Record<string, { httpUrl: string; headers: Record<string, string> }>;
    };
    expect(Object.keys(settings)).toEqual(["mcpServers"]);
    expect(settings.mcpServers.paperclip.httpUrl).toContain("/mcp/paperclip");
    expect(settings.mcpServers.paperclip.headers.Authorization).toBe("Bearer run-token");
    expect(settings.mcpServers.paperclip.headers["X-Paperclip-Run-Id"]).toBe("run-mcp-1");
    expect(prompt).toMatch(MCP_TOOL_NAME_RE);
    await expect(fs.access(String(settingsPath))).rejects.toThrow();
  });

  it("teaches the REST surface and mounts nothing when the paperclipMcp toggle is off", async () => {
    const prompt = await runGemini({ paperclipMcp: false });

    expect(capture.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBeUndefined();
    expect(capture.settings).toBeNull();
    expect(prompt).not.toMatch(MCP_TOOL_NAME_RE);
    expect(prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(prompt).toContain("X-Paperclip-Run-Id");
  });

  it("uses the configured toolsets in the mounted endpoint", async () => {
    await runGemini({ paperclipMcpToolsets: "all" });

    const settings = JSON.parse(String(capture.settings)) as {
      mcpServers: Record<string, { httpUrl: string }>;
    };
    expect(settings.mcpServers.paperclip.httpUrl).toContain("toolsets=all");
  });
});
