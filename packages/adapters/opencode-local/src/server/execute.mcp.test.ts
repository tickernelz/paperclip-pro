import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type * as ExecutionTargetModule from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const { capture, runAdapterExecutionTargetProcess } = vi.hoisted(() => {
  const capture: { env: Record<string, string>; config: string | null } = { env: {}, config: null };
  return {
    capture,
    runAdapterExecutionTargetProcess: vi.fn(async (...args: unknown[]) => {
      const options = args[4] as { env?: Record<string, string> } | undefined;
      capture.env = { ...(options?.env ?? {}) };
      const configPath = capture.env.OPENCODE_CONFIG;
      capture.config = configPath ? await fs.readFile(configPath, "utf8") : null;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({ type: "text", sessionID: "opencode-session-1", part: { text: "done" } }),
        stderr: "",
        pid: 321,
        startedAt: new Date().toISOString(),
      };
    }),
  };
});

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof ExecutionTargetModule>(
    "@tickernelz/paperclip-pro-adapter-utils/execution-target",
  );
  return { ...actual, runAdapterExecutionTargetProcess };
});

import { execute } from "./execute.js";

const MCP_TOOL_NAME_RE = /\bpaperclip[A-Z]\w+/;

describe("opencode_local Paperclip MCP coherence", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-mcp-test-"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "xdg"));
    capture.env = {};
    capture.config = null;
    runAdapterExecutionTargetProcess.mockClear();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function runOpenCode(config: Record<string, unknown>): Promise<string> {
    const commandPath = path.join(root, "fake-opencode");
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    let prompt = "";
    await execute({
      runId: "run-mcp-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OpenCode Coder",
        adapterType: "opencode_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: {
        command: commandPath,
        cwd: workspace,
        model: "openai/gpt-5",
        env: { OPENCODE_ALLOW_ALL_MODELS: "1" },
        ...config,
      },
      context: {},
      authToken: "run-token",
      onLog: async () => {},
      onMeta: async (meta: { prompt?: string }) => {
        prompt = String(meta.prompt ?? "");
      },
    } as never);
    return prompt;
  }

  it("mounts the Paperclip MCP server through OPENCODE_CONFIG and names the tools in the prompt", async () => {
    const prompt = await runOpenCode({});

    const configPath = capture.env.OPENCODE_CONFIG;
    expect(configPath).toBeTruthy();
    const mounted = JSON.parse(String(capture.config)) as {
      mcp: Record<string, { type: string; url: string; enabled: boolean; oauth: boolean; headers: Record<string, string> }>;
    };
    expect(mounted.mcp.paperclip.type).toBe("remote");
    expect(mounted.mcp.paperclip.enabled).toBe(true);
    expect(mounted.mcp.paperclip.url).toContain("/mcp/paperclip");
    expect(mounted.mcp.paperclip.headers.Authorization).toBe("Bearer run-token");
    expect(mounted.mcp.paperclip.headers["X-Paperclip-Run-Id"]).toBe("run-mcp-1");
    expect(capture.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");
    expect(prompt).toMatch(MCP_TOOL_NAME_RE);
    await expect(fs.access(String(configPath))).rejects.toThrow();
  });

  it("teaches the REST surface and mounts nothing when the paperclipMcp toggle is off", async () => {
    const prompt = await runOpenCode({ paperclipMcp: false });

    expect(capture.env.OPENCODE_CONFIG).toBeUndefined();
    expect(capture.config).toBeNull();
    expect(prompt).not.toMatch(MCP_TOOL_NAME_RE);
    expect(prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(prompt).toContain("X-Paperclip-Run-Id");
  });

  it("uses the configured toolsets in the mounted endpoint", async () => {
    await runOpenCode({ paperclipMcpToolsets: "all" });

    const mounted = JSON.parse(String(capture.config)) as { mcp: Record<string, { url: string }> };
    expect(mounted.mcp.paperclip.url).toContain("toolsets=all");
  });
});
