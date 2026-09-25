import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@tickernelz/paperclip-pro-adapter-utils";

const mocks = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
}));

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", () => ({
  adapterExecutionTargetIsRemote: () => false,
  adapterExecutionTargetRemoteCwd: (_target: unknown, cwd: string) => cwd,
  overrideAdapterExecutionTargetRemoteCwd: (target: unknown) => target,
  adapterExecutionTargetSessionIdentity: () => ({ kind: "local" }),
  adapterExecutionTargetSessionMatches: () => true,
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: async () => {},
  ensureAdapterExecutionTargetRuntimeCommandInstalled: async () => {},
  prepareAdapterExecutionTargetRuntime: async () => ({
    workspaceRemoteDir: null,
    assetDirs: {},
    restoreWorkspace: async () => {},
  }),
  readAdapterExecutionTarget: () => ({ kind: "local" }),
  resolveAdapterExecutionTargetCommandForLogs: async () => "grok",
  resolveAdapterExecutionTargetTimeoutSec: (_target: unknown, timeoutSec: number) => timeoutSec,
  runAdapterExecutionTargetProcess: (...args: unknown[]) =>
    (mocks.runProcessMock as (...args: unknown[]) => unknown)(...args),
}));

import { execute } from "./execute.js";

const tempRoots: string[] = [];
const PAPERCLIP_TOOL_NAME = /paperclip[A-Z]/;

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-grok-mcp-"));
  tempRoots.push(root);
  return root;
}

function makeCtx(runId: string, cwd: string, config: Record<string, unknown> = {}): AdapterExecutionContext {
  return {
    runId,
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Grok Agent",
      adapterType: "grok_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { cwd, ...config },
    context: {},
    authToken: "run-token",
    onLog: async () => {},
  } as AdapterExecutionContext;
}

type Captured = { prompt: string; env: Record<string, string>; mcpConfig: string | null };

function captureRun(): Captured {
  const captured: Captured = { prompt: "", env: {}, mcpConfig: null };
  mocks.runProcessMock.mockImplementation(
    async (
      _runId: string,
      _target: unknown,
      _command: string,
      args: string[],
      options: { env: Record<string, string> },
    ) => {
      captured.prompt = args[args.length - 1] ?? "";
      captured.env = options.env;
      const configPath = options.env.GROK_CONFIG_PATH;
      captured.mcpConfig = configPath ? await fs.readFile(configPath, "utf8") : null;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1" }),
        stderr: "",
      };
    },
  );
  return captured;
}

describe("grok_local Paperclip MCP coherence", () => {
  const previousApiUrl = process.env.PAPERCLIP_API_URL;

  beforeEach(() => {
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    mocks.runProcessMock.mockReset();
  });

  afterEach(async () => {
    if (previousApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = previousApiUrl;
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("mounts the Paperclip MCP server through GROK_CONFIG_PATH and names the tools in the prompt", async () => {
    const root = await makeTempRoot();
    const captured = captureRun();

    await execute(makeCtx("mcp-armed", root));

    expect(captured.env.GROK_CONFIG_PATH).toMatch(/paperclip-grok-mcp-/);
    expect(captured.mcpConfig).toContain('[mcp_servers."paperclip"]');
    expect(captured.mcpConfig).toContain('url = "https://paperclip.test/api/mcp/paperclip?toolsets=core"');
    expect(captured.mcpConfig).toContain('"Authorization" = "Bearer run-token"');
    expect(captured.mcpConfig).toContain('"X-Paperclip-Run-Id" = "mcp-armed"');
    expect(captured.prompt).toContain("paperclipListIssues");
    expect(captured.prompt).toContain("paperclipApiRequest");
  });

  it("removes the mounted config file after the run", async () => {
    const root = await makeTempRoot();
    const captured = captureRun();

    await execute(makeCtx("mcp-cleanup", root));

    await expect(fs.access(captured.env.GROK_CONFIG_PATH)).rejects.toThrow();
  });

  it("teaches the REST API and mounts nothing when the paperclipMcp toggle is off", async () => {
    const root = await makeTempRoot();
    const captured = captureRun();

    await execute(makeCtx("mcp-off", root, { paperclipMcp: false }));

    expect(captured.env.GROK_CONFIG_PATH).toBeUndefined();
    expect(captured.mcpConfig).toBeNull();
    expect(captured.prompt).not.toMatch(PAPERCLIP_TOOL_NAME);
    expect(captured.prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(captured.prompt).toContain("X-Paperclip-Run-Id");
  });

  it("teaches the REST API when the run carries no Paperclip credential", async () => {
    const root = await makeTempRoot();
    const captured = captureRun();
    const ctx = makeCtx("mcp-no-token", root);
    ctx.authToken = undefined;

    await execute(ctx);

    expect(captured.env.GROK_CONFIG_PATH).toBeUndefined();
    expect(captured.prompt).not.toMatch(PAPERCLIP_TOOL_NAME);
    expect(captured.prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
  });
});
