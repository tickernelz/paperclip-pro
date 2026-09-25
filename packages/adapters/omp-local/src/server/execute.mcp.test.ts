import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

vi.mock("./paperclip-mcp.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, probePaperclipMcpServer: vi.fn() };
});

import { execute } from "./execute.js";
import {
  PAPERCLIP_MCP_BIN,
  PAPERCLIP_MCP_PACKAGE,
  PAPERCLIP_MCP_UNAVAILABLE_CODE,
  buildPaperclipMcpServerEntry,
  paperclipMcpToolsets,
  probePaperclipMcpServer,
  resolvePaperclipMcpServerCommand,
} from "./paperclip-mcp.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);
const probeMock = vi.mocked(probePaperclipMcpServer);

interface Invocation {
  args: string[];
  env: Record<string, string>;
  extensionDirs: string[];
  mcpDir: string | null;
  mcpServer: Record<string, unknown> | null;
  systemPrompt: string;
}

describe("OMP local Paperclip MCP wiring", () => {
  let root: string;
  let commandPath: string;
  let workspaceCwd: string;
  let captured: Invocation | null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-mcp-test-"));
    workspaceCwd = path.join(root, "workspace");
    commandPath = path.join(root, "fake-omp");
    await fs.mkdir(workspaceCwd, { recursive: true });
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    captured = null;
    probeMock.mockReset();
    probeMock.mockResolvedValue({ ok: true, detail: "handshake ok", toolCount: 61, durationMs: 42 });
    runProcessMock.mockReset();
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      args: string[],
      options: { env: Record<string, string> },
    ) => {
      const extensionDirs = args
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value === "--extension")
        .map((entry) => args[entry.index + 1] ?? "");
      let mcpDir: string | null = null;
      let mcpServer: Record<string, unknown> | null = null;
      for (const dir of extensionDirs) {
        const candidate = path.join(dir, ".mcp.json");
        const raw = await fs.readFile(candidate, "utf8").catch(() => null);
        if (raw === null) continue;
        mcpDir = dir;
        mcpServer = (JSON.parse(raw) as { mcpServers: Record<string, Record<string, unknown>> })
          .mcpServers.paperclip ?? null;
      }
      const promptIndex = args.indexOf("--append-system-prompt");
      captured = {
        args,
        env: options.env,
        extensionDirs,
        mcpDir,
        mcpServer,
        systemPrompt: promptIndex >= 0 ? (args[promptIndex + 1] ?? "") : "",
      };
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function run(config: Record<string, unknown>, authToken: string | null = "run-jwt"): Promise<Invocation> {
    await execute({
      runId: "run-mcp",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, ...config },
      context: {},
      onLog: async () => {},
      ...(authToken ? { authToken } : {}),
    });
    expect(captured).not.toBeNull();
    return captured as Invocation;
  }

  async function runResult(
    config: Record<string, unknown>,
    logs: Array<{ stream: string; chunk: string }> = [],
  ) {
    return await execute({
      runId: "run-mcp",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, ...config },
      context: {},
      onLog: async (stream: string, chunk: string) => {
        logs.push({ stream, chunk });
      },
      authToken: "run-jwt",
    });
  }

  it("arms the paperclip MCP server for the run by default", async () => {
    const invocation = await run({});
    expect(invocation.mcpDir).toBeTruthy();
    expect(invocation.extensionDirs[0]).toBe(invocation.mcpDir);
    expect(invocation.mcpServer).toMatchObject({ type: "stdio", enabled: true });
    expect(invocation.mcpServer?.args).toEqual(expect.arrayContaining(["--toolsets", "core"]));
    expect(invocation.mcpServer?.env).toMatchObject({
      PAPERCLIP_API_URL: "${PAPERCLIP_API_URL}",
      PAPERCLIP_API_KEY: "${PAPERCLIP_API_KEY}",
      PAPERCLIP_AGENT_ID: "${PAPERCLIP_AGENT_ID}",
      PAPERCLIP_COMPANY_ID: "${PAPERCLIP_COMPANY_ID}",
      PAPERCLIP_RUN_ID: "${PAPERCLIP_RUN_ID}",
      PAPERCLIP_MCP_TOOLSETS: "core",
    });
    expect(invocation.env.PAPERCLIP_API_KEY).toBe("run-jwt");
    expect(invocation.systemPrompt).toContain("paperclipListIssues");
  });

  it("passes the configured toolsets to the server", async () => {
    const invocation = await run({ paperclipMcpToolsets: " extended , core " });
    expect(invocation.mcpServer?.args).toEqual(expect.arrayContaining(["--toolsets", "extended,core"]));
    expect(invocation.mcpServer?.env).toMatchObject({ PAPERCLIP_MCP_TOOLSETS: "extended,core" });
    expect(invocation.systemPrompt).toContain("toolsets: extended,core");
  });

  it("pins the server off and warns that the agent has no Paperclip tools", async () => {
    const invocation = await run({ paperclipMcp: false });
    expect(invocation.mcpDir).toBeTruthy();
    expect(invocation.mcpServer).toMatchObject({ enabled: false });
    expect(invocation.systemPrompt).not.toContain("paperclipListIssues");
    expect(probeMock).not.toHaveBeenCalled();
    const logs: Array<{ stream: string; chunk: string }> = [];
    await runResult({ paperclipMcp: false }, logs);
    expect(logs.some((entry) => entry.stream === "stderr" && entry.chunk.includes("has no Paperclip tools this run"))).toBe(true);
  });

  it("fails the run before spawning OMP when the MCP server cannot start", async () => {
    probeMock.mockResolvedValue({
      ok: false,
      detail: "server exited early (code 1, signal null): Missing PAPERCLIP_API_URL",
      toolCount: null,
      durationMs: 120,
    });
    const logs: Array<{ stream: string; chunk: string }> = [];
    const result = await runResult({}, logs);
    expect(result.errorCode).toBe(PAPERCLIP_MCP_UNAVAILABLE_CODE);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("Missing PAPERCLIP_API_URL");
    expect(runProcessMock).not.toHaveBeenCalled();
    expect(logs.some((entry) => entry.stream === "stderr" && entry.chunk.includes("is unavailable"))).toBe(true);
  });

  it("fails the run when OMP reports that the MCP server did not connect", async () => {
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      options: { onLog: (stream: string, chunk: string) => Promise<void> },
    ) => {
      await options.onLog(
        "stderr",
        'Warning: MCP server "paperclip" failed to connect: MCP subprocess closed stdout before responding; its tools are unavailable for this run.\n',
      );
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);
    const result = await runResult({});
    expect(result.errorCode).toBe(PAPERCLIP_MCP_UNAVAILABLE_CODE);
    expect(result.errorMessage).toContain("failed to connect");
  });

  it("keeps configured extensions after the generated one", async () => {
    const userExtension = path.join(root, "user-extension");
    await fs.mkdir(userExtension, { recursive: true });
    const invocation = await run({ extensions: userExtension });
    expect(invocation.extensionDirs).toHaveLength(2);
    expect(invocation.extensionDirs[0]).toBe(invocation.mcpDir);
    expect(invocation.extensionDirs[1]).toBe(userExtension);
  });

  it("declares nothing when the run has no Paperclip API key", async () => {
    const previous = process.env.PAPERCLIP_API_KEY;
    delete process.env.PAPERCLIP_API_KEY;
    try {
      const invocation = await run({}, null);
      expect(invocation.extensionDirs).toHaveLength(0);
      expect(invocation.mcpServer).toBeNull();
    } finally {
      if (previous !== undefined) process.env.PAPERCLIP_API_KEY = previous;
    }
  });

  it("removes the generated MCP extension once the run finishes", async () => {
    const invocation = await run({});
    await expect(fs.access(invocation.mcpDir as string)).rejects.toThrow();
  });
});

describe("Paperclip MCP server resolution", () => {
  const root = path.join("/opt", "paperclip", "node_modules", "@tickernelz", "adapter", "dist", "server");

  it("prefers the nearest bin shim", () => {
    const bin = path.join("/opt", "paperclip", "node_modules", ".bin", PAPERCLIP_MCP_BIN);
    const resolved = resolvePaperclipMcpServerCommand({
      searchFrom: root,
      exists: (candidate) => candidate === bin,
    });
    expect(resolved).toEqual({ command: bin, args: [], source: "bin" });
  });

  it("falls back to the package entry point when no shim exists", () => {
    const dist = path.join("/opt", "paperclip", "node_modules", PAPERCLIP_MCP_PACKAGE, "dist", "stdio.js");
    const resolved = resolvePaperclipMcpServerCommand({
      searchFrom: root,
      exists: (candidate) => candidate === dist,
      nodePath: "/usr/bin/node",
    });
    expect(resolved).toEqual({ command: "/usr/bin/node", args: [dist], source: "dist" });
  });

  it("falls back to PATH when the package is absent", () => {
    const resolved = resolvePaperclipMcpServerCommand({ searchFrom: root, exists: () => false });
    expect(resolved).toEqual({ command: PAPERCLIP_MCP_BIN, args: [], source: "path" });
  });

  it("uses the package entry that ships with an install", () => {
    const resolved = resolvePaperclipMcpServerCommand({
      searchFrom: path.join("/opt", "paperclip", "node_modules", "@tickernelz", "adapter"),
      exists: (candidate) => candidate.endsWith(path.join("dist", "stdio.js")),
      nodePath: "/usr/bin/node",
    });
    expect(resolved.source).toBe("dist");
    expect(resolved.args[0]).toContain(PAPERCLIP_MCP_PACKAGE);
  });
});

describe("Paperclip MCP server entry", () => {
  it("defaults to the core toolset and omits env the run does not carry", () => {
    expect(paperclipMcpToolsets({})).toBe("core");
    expect(paperclipMcpToolsets({ paperclipMcpToolsets: " , " })).toBe("core");
    const entry = buildPaperclipMcpServerEntry({
      enabled: true,
      command: { command: "paperclip-mcp-server", args: [], source: "path" },
      toolsets: "core",
      env: { PAPERCLIP_API_URL: "http://localhost:3100", PAPERCLIP_API_KEY: "k", PAPERCLIP_RUN_ID: "  " },
    });
    expect(entry.env).toEqual({
      PAPERCLIP_API_URL: "${PAPERCLIP_API_URL}",
      PAPERCLIP_API_KEY: "${PAPERCLIP_API_KEY}",
      PAPERCLIP_MCP_TOOLSETS: "core",
    });
  });

  it("never writes the api key itself into the generated config", () => {
    const entry = buildPaperclipMcpServerEntry({
      enabled: true,
      command: { command: "paperclip-mcp-server", args: [], source: "path" },
      toolsets: "core",
      env: { PAPERCLIP_API_KEY: "super-secret-token" },
    });
    expect(JSON.stringify(entry)).not.toContain("super-secret-token");
  });
});
