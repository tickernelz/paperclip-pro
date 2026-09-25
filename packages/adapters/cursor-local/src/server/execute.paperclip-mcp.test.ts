import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@tickernelz/paperclip-pro-adapter-utils";
import type * as ExecutionTargetModule from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const mocks = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
}));

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof ExecutionTargetModule>(
    "@tickernelz/paperclip-pro-adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetCommandResolvable: async () => {},
    ensureAdapterExecutionTargetRuntimeCommandInstalled: async () => {},
    resolveAdapterExecutionTargetCommandForLogs: async () => "agent",
    startAdapterExecutionTargetPaperclipBridge: async () => null,
    runAdapterExecutionTargetProcess: (...args: unknown[]) =>
      (mocks.runProcessMock as (...args: unknown[]) => unknown)(...args),
  };
});

vi.mock("./remote-command.js", () => ({
  prepareCursorSandboxCommand: async (input: { command: string; env: Record<string, string> }) => ({
    command: input.command,
    env: input.env,
    remoteSystemHomeDir: null,
    addedPathEntry: null,
    preferredCommandPath: null,
  }),
}));

import { execute } from "./execute.js";

const tempRoots: string[] = [];
const PAPERCLIP_TOOL_NAME = /paperclip[A-Z]/;

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cursor-mcp-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  await fs.mkdir(path.join(root, "home"), { recursive: true });
  return root;
}

function makeCtx(runId: string, root: string, config: Record<string, unknown> = {}): AdapterExecutionContext {
  return {
    runId,
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Cursor Coder",
      adapterType: "cursor",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { cwd: path.join(root, "workspace"), env: { HOME: path.join(root, "home") }, ...config },
    context: {},
    authToken: "run-token",
    onLog: async () => {},
  } as AdapterExecutionContext;
}

type Captured = { prompt: string; args: string[]; mcpConfig: string | null };

function captureRun(mcpFilePath: string): Captured {
  const captured: Captured = { prompt: "", args: [], mcpConfig: null };
  mocks.runProcessMock.mockImplementation(
    async (
      _runId: string,
      _target: unknown,
      _command: string,
      args: string[],
      options: { stdin?: string },
    ) => {
      captured.args = args;
      captured.prompt = options.stdin ?? "";
      captured.mcpConfig = await fs.readFile(mcpFilePath, "utf8").catch(() => null);
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "sess-1", result: "ok" }),
        stderr: "",
      };
    },
  );
  return captured;
}

describe("cursor_local Paperclip MCP coherence", () => {
  const previousApiUrl = process.env.PAPERCLIP_API_URL;
  const previousHome = process.env.HOME;

  beforeEach(() => {
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    mocks.runProcessMock.mockReset();
  });

  afterEach(async () => {
    if (previousApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = previousApiUrl;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("writes the workspace mcp.json, approves it and names the paperclip tools in the prompt", async () => {
    const root = await makeTempRoot();
    const mcpFilePath = path.join(root, "workspace", ".cursor", "mcp.json");
    const captured = captureRun(mcpFilePath);

    await execute(makeCtx("mcp-armed", root));

    expect(captured.mcpConfig).not.toBeNull();
    expect(JSON.parse(captured.mcpConfig!)).toEqual({
      mcpServers: {
        paperclip: {
          url: "https://paperclip.test/api/mcp/paperclip?toolsets=core",
          headers: {
            Authorization: "Bearer run-token",
            "X-Paperclip-Run-Id": "mcp-armed",
          },
        },
      },
    });
    expect(captured.args).toContain("--approve-mcps");
    expect(captured.prompt).toContain("paperclipListIssues");
    expect(captured.prompt).toContain("paperclipApiRequest");
    await expect(fs.access(mcpFilePath)).rejects.toThrow();
  });

  it("teaches the REST API and adds no flag when the paperclipMcp toggle is off", async () => {
    const root = await makeTempRoot();
    const mcpFilePath = path.join(root, "workspace", ".cursor", "mcp.json");
    const captured = captureRun(mcpFilePath);

    await execute(makeCtx("mcp-off", root, { paperclipMcp: false }));

    expect(captured.mcpConfig).toBeNull();
    expect(captured.args).not.toContain("--approve-mcps");
    expect(captured.prompt).not.toMatch(PAPERCLIP_TOOL_NAME);
    expect(captured.prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(captured.prompt).toContain("X-Paperclip-Run-Id");
  });

  it("keeps a user-owned mcp.json and falls back to the REST prompt", async () => {
    const root = await makeTempRoot();
    const mcpFilePath = path.join(root, "workspace", ".cursor", "mcp.json");
    await fs.mkdir(path.dirname(mcpFilePath), { recursive: true });
    await fs.writeFile(mcpFilePath, '{"mcpServers":{"mine":{"url":"https://example.test"}}}\n', "utf8");
    const captured = captureRun(mcpFilePath);

    await execute(makeCtx("mcp-user-owned", root));

    expect(captured.mcpConfig).toContain('"mine"');
    expect(captured.args).not.toContain("--approve-mcps");
    expect(captured.prompt).not.toMatch(PAPERCLIP_TOOL_NAME);
    expect(captured.prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    await expect(fs.readFile(mcpFilePath, "utf8")).resolves.toContain('"mine"');
  });
});
