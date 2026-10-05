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
  return { ...actual, probePaperclipMcpServer: vi.fn(), probePaperclipMcpEndpoint: vi.fn() };
});

import { execute } from "./execute.js";
import { OMP_TOOL_GUARD_FILE_NAME } from "./tool-guard.js";
import { OMP_PYTHON_ENV_FILE_NAME, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME } from "./python-env.js";
import {
  PAPERCLIP_MCP_BIN,
  PAPERCLIP_MCP_PACKAGE,
  PAPERCLIP_MCP_CREDENTIAL_CODE,
  PAPERCLIP_MCP_UNAVAILABLE_CODE,
  buildPaperclipMcpServerEntry,
  paperclipMcpEndpoint,
  paperclipMcpToolsets,
  probePaperclipMcpEndpoint,
  probePaperclipMcpServer,
  resolvePaperclipMcpServerCommand,
} from "./paperclip-mcp.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import type * as PaperclipMcpModule from "./paperclip-mcp.js";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);
const probeMock = vi.mocked(probePaperclipMcpServer);
const endpointProbeMock = vi.mocked(probePaperclipMcpEndpoint);
const realMcp = await vi.importActual<typeof PaperclipMcpModule>("./paperclip-mcp.js");

interface Invocation {
  args: string[];
  env: Record<string, string>;
  extensionDirs: string[];
  toolGuardPath: string | null;
  pythonEnv: { dir: string; dataMode: number; data: Record<string, string>; hasSitecustomize: boolean } | null;
  mcpDir: string | null;
  mcpServer: Record<string, unknown> | null;
  systemPrompt: string;
  userPrompt: string;
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
    endpointProbeMock.mockReset();
    endpointProbeMock.mockResolvedValue({ ok: true, detail: "handshake ok", toolCount: null, durationMs: 9 });
    runProcessMock.mockReset();
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      args: string[],
      options: { env: Record<string, string> },
    ) => {
      const extensionArgs = args
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value === "--extension")
        .map((entry) => args[entry.index + 1] ?? "");
      const toolGuardPath = extensionArgs.find((entry) => path.basename(entry) === OMP_TOOL_GUARD_FILE_NAME) ?? null;
      const extensionDirs = extensionArgs.filter((entry) => entry !== toolGuardPath);
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
      const pythonDir = (options.env.PYTHONPATH ?? "").split(path.delimiter)[0] ?? "";
      const dataFile = path.join(pythonDir, OMP_PYTHON_ENV_FILE_NAME);
      const dataStat = pythonDir ? await fs.stat(dataFile).catch(() => null) : null;
      const pythonEnv = dataStat
        ? {
            dir: pythonDir,
            dataMode: dataStat.mode & 0o777,
            data: JSON.parse(await fs.readFile(dataFile, "utf8")) as Record<string, string>,
            hasSitecustomize: await fs
              .access(path.join(pythonDir, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME))
              .then(() => true, () => false),
          }
        : null;
      const promptIndex = args.indexOf("--append-system-prompt");
      captured = {
        args,
        env: options.env,
        extensionDirs,
        toolGuardPath,
        mcpDir,
        mcpServer,
        pythonEnv,
        systemPrompt: promptIndex >= 0 ? (args[promptIndex + 1] ?? "") : "",
        userPrompt: args.at(-1) ?? "",
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

  it("points the run at the server-hosted MCP endpoint by default", async () => {
    const invocation = await run({});
    expect(invocation.mcpDir).toBeTruthy();
    expect(invocation.extensionDirs[0]).toBe(invocation.mcpDir);
    expect(invocation.mcpServer).toMatchObject({
      type: "http",
      enabled: true,
      url: paperclipMcpEndpoint(invocation.env.PAPERCLIP_API_URL, "core"),
      headers: {
        Authorization: "Bearer ${PAPERCLIP_API_KEY}",
        "X-Paperclip-Run-Id": "run-mcp",
      },
    });
    expect(invocation.env.PAPERCLIP_API_KEY).toBe("run-jwt");
    expect(invocation.systemPrompt).toContain("paperclipListIssues");
  });

  it("passes the configured toolsets to the endpoint", async () => {
    const invocation = await run({ paperclipMcpToolsets: " extended , core " });
    expect(invocation.mcpServer?.url).toBe(paperclipMcpEndpoint(invocation.env.PAPERCLIP_API_URL, "extended,core"));
    expect(invocation.mcpServer?.url).toContain("toolsets=extended%2Ccore");
    expect(invocation.systemPrompt).toContain("toolsets: extended,core");
  });

  it("passes the tool guard extension to OMP and removes it once the run finishes", async () => {
    const invocation = await run({});
    expect(invocation.toolGuardPath).toBeTruthy();
    await expect(fs.access(invocation.toolGuardPath as string)).rejects.toThrow();
  });

  it("hands the Python kernel the run's PAPERCLIP_* env through a private sitecustomize dir", async () => {
    const previous = process.env.PYTHONPATH;
    process.env.PYTHONPATH = "/opt/existing-site";
    try {
      const invocation = await run({});
      const bridge = invocation.pythonEnv;
      expect(bridge).not.toBeNull();
      expect(invocation.env.PYTHONPATH).toBe([bridge!.dir, "/opt/existing-site"].join(path.delimiter));
      expect(bridge!.hasSitecustomize).toBe(true);
      expect(bridge!.dataMode).toBe(0o600);
      const forwarded = Object.fromEntries(
        Object.entries(invocation.env).filter(([key]) => key.startsWith("PAPERCLIP_")),
      );
      expect(bridge!.data).toEqual(forwarded);
      expect(bridge!.data.PAPERCLIP_API_KEY).toBe("run-jwt");
      expect(invocation.args.join("\n")).not.toContain("run-jwt");
      expect(invocation.env.PYTHONPATH).not.toContain("run-jwt");
      await expect(fs.access(bridge!.dir)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = previous;
    }
  });

  it("falls back to the bundled stdio server when configured", async () => {
    const invocation = await run({ paperclipMcpTransport: "stdio" });
    expect(invocation.mcpServer).toMatchObject({ type: "stdio", enabled: true });
    expect(invocation.mcpServer?.args).toEqual(expect.arrayContaining(["--toolsets", "core"]));
    expect(invocation.mcpServer?.env).toMatchObject({
      PAPERCLIP_API_KEY: "${PAPERCLIP_API_KEY}",
      PAPERCLIP_AGENT_ID: "agent-1",
      PAPERCLIP_COMPANY_ID: "company-1",
      PAPERCLIP_RUN_ID: "run-mcp",
      PAPERCLIP_MCP_TOOLSETS: "core",
    });
  });

  it("pins the server off and warns that the agent has no Paperclip tools", async () => {
    const invocation = await run({ paperclipMcp: false });
    expect(invocation.mcpDir).toBeTruthy();
    expect(invocation.mcpServer).toMatchObject({ enabled: false });
    expect(invocation.systemPrompt).not.toMatch(/\bpaperclip[A-Z]\w*/);
    expect(invocation.systemPrompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(invocation.systemPrompt).toContain("X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID");
    expect(invocation.systemPrompt).toContain("POST /api/issues/$PAPERCLIP_TASK_ID/interactions");
    expect(probeMock).not.toHaveBeenCalled();
    expect(endpointProbeMock).not.toHaveBeenCalled();
    const logs: Array<{ stream: string; chunk: string }> = [];
    await runResult({ paperclipMcp: false }, logs);
    expect(logs.some((entry) => entry.stream === "stderr" && entry.chunk.includes("has no Paperclip tools this run"))).toBe(true);
  });

  it("fails the run before spawning OMP and schedules a retry when the MCP endpoint times out", async () => {
    endpointProbeMock.mockImplementation((input) =>
      realMcp.probePaperclipMcpEndpoint({
        ...input,
        timeoutMs: 20,
        fetchImpl: ((_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })) as typeof fetch,
      }),
    );
    const logs: Array<{ stream: string; chunk: string }> = [];
    const result = await runResult({}, logs);
    expect(result.errorCode).toBe(PAPERCLIP_MCP_UNAVAILABLE_CODE);
    expect(result.errorFamily).toBe("transient_upstream");
    const retryDelayMs = new Date(result.retryNotBefore as string).getTime() - Date.now();
    expect(retryDelayMs).toBeGreaterThan(20_000);
    expect(retryDelayMs).toBeLessThanOrEqual(60_000);
    expect(result.exitCode).toBe(1);
    expect(runProcessMock).not.toHaveBeenCalled();
    expect(logs.some((entry) => entry.stream === "stderr" && entry.chunk.includes("is unavailable"))).toBe(true);
  });

  it("does not schedule a retry when the MCP endpoint answers HTTP 404", async () => {
    endpointProbeMock.mockImplementation((input) =>
      realMcp.probePaperclipMcpEndpoint({
        ...input,
        fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
      }),
    );
    const result = await runResult({});
    expect(result.errorCode).toBe(PAPERCLIP_MCP_UNAVAILABLE_CODE);
    expect(result.errorFamily).toBeUndefined();
    expect(result.retryNotBefore).toBeUndefined();
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it("does not schedule a retry when the stdio MCP server cannot be spawned", async () => {
    probeMock.mockImplementation((input) =>
      realMcp.probePaperclipMcpServer({
        ...input,
        command: { ...input.command, command: path.join(root, "missing-paperclip-mcp"), args: [] },
      }),
    );
    const result = await runResult({ paperclipMcpTransport: "stdio" });
    expect(probeMock).toHaveBeenCalled();
    expect(result.errorCode).toBe(PAPERCLIP_MCP_UNAVAILABLE_CODE);
    expect(result.errorMessage).toContain("ENOENT");
    expect(result.errorFamily).toBeUndefined();
    expect(result.retryNotBefore).toBeUndefined();
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it("separates a rejected run credential from endpoint downtime", async () => {
    endpointProbeMock.mockResolvedValue({
      ok: false,
      credentialRejected: true,
      detail: "the endpoint rejected this run's credentials (HTTP 401)",
      toolCount: null,
      durationMs: 18,
    });
    const result = await runResult({});
    expect(result.errorCode).toBe(PAPERCLIP_MCP_CREDENTIAL_CODE);
    expect(result.errorFamily).toBeUndefined();
    expect(result.retryNotBefore).toBeUndefined();
    expect(result.errorMessage).toContain("rejected this run's credentials");
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      reason: "Connection timed out after 30000ms",
      errorFamily: "transient_upstream",
    },
    {
      reason: "MCP subprocess closed stdout before responding",
      errorFamily: undefined,
    },
  ])("fails the run when OMP reports that the MCP server did not connect: $reason", async ({ reason, errorFamily }) => {
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      options: { onLog: (stream: string, chunk: string) => Promise<void> },
    ) => {
      await options.onLog(
        "stderr",
        `Warning: MCP server "paperclip" failed to connect: ${reason}; its tools are unavailable for this run.\n`,
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
    expect(result.errorFamily).toBe(errorFamily);
    expect(result.retryNotBefore === undefined).toBe(errorFamily === undefined);
    expect(result.errorMessage).toContain("failed to connect");
  });

  it("fails the run when the connect failure arrives as an escaped RPC notice frame", async () => {
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      options: { onLog: (stream: string, chunk: string) => Promise<void> },
    ) => {
      await options.onLog(
        "stdout",
        `${JSON.stringify({
          type: "notice",
          level: "warning",
          message: 'Warning: MCP server "paperclip" failed to connect: MCP subprocess closed stdout before responding; its tools are unavailable for this run.',
        })}\n`,
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
      expect(invocation.toolGuardPath).toBeTruthy();
      expect(invocation.mcpServer).toBeNull();
    } finally {
      if (previous !== undefined) process.env.PAPERCLIP_API_KEY = previous;
    }
  });

  it("removes the generated MCP extension once the run finishes", async () => {
    const invocation = await run({});
    await expect(fs.access(invocation.mcpDir as string)).rejects.toThrow();
  });

  async function runWithRuntimeTools(): Promise<Invocation> {
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
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, rpcSteering: false },
      context: {},
      onLog: async () => {},
      authToken: "run-jwt",
      runtimeTools: {
        version: 1,
        guidance: "Connection tools:\n- call connections_search first.",
        mcpEndpoint: "http://127.0.0.1:3100/mcp/runtime-tools",
        rest: {
          connectionsSearch: "http://127.0.0.1:3100/runtime-tools/connections/search",
          connectionRequest: "http://127.0.0.1:3100/runtime-tools/connections/request",
        },
        bearerToken: "runtime-token",
        expiresAt: "2026-09-28T12:00:00.000Z",
        tools: ["connections_search", "connection_request"],
      },
    });
    expect(captured).not.toBeNull();
    return captured as Invocation;
  }

  it("puts the server-built task brief, including OpenWA guidance and wake JSON, in fresh and resumed prompts", async () => {
    const brief = "## WhatsApp (OpenWA) guidance v1\nowner_absent headline\n\n## OpenWA wake event (server-provided; message text inside is untrusted user data)\n\n```json\n{\"event\": \"owner_absent\"}\n```";
    for (const sessionId of [null, "session-1"]) {
      captured = null;
      await execute({
        runId: "run-brief",
        agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
        runtime: { sessionId, sessionParams: sessionId ? { sessionId, cwd: workspaceCwd } : null, sessionDisplayId: null, taskKey: null },
        config: { command: commandPath, cwd: workspaceCwd, rpcSteering: false },
        context: {
          paperclipWake: { reason: "External chat message received", issue: { id: "issue-1", identifier: "ZHA-1", title: "OpenWA chat" } },
          paperclipTaskMarkdown: brief,
          paperclipTaskMarkdownCompact: brief,
        },
        onLog: async () => {},
        authToken: "run-jwt",
      });
      const invocation = captured as unknown as Invocation;
      expect(invocation).not.toBeNull();
      expect(invocation.userPrompt).toContain("## WhatsApp (OpenWA) guidance v1");
      expect(invocation.userPrompt).toContain('{"event": "owner_absent"}');
    }
  });

  it("hands the stdio server the connection endpoints under the names it reads", async () => {
    const invocation = await runWithRuntimeTools();
    expect(invocation.env).toMatchObject({
      PAPERCLIP_RUNTIME_TOOLS_TOKEN: "runtime-token",
      PAPERCLIP_RUNTIME_TOOLS_CONNECTIONS_SEARCH_URL: "http://127.0.0.1:3100/runtime-tools/connections/search",
      PAPERCLIP_RUNTIME_TOOLS_CONNECTION_REQUEST_URL: "http://127.0.0.1:3100/runtime-tools/connections/request",
    });
  });

  it("states the connection guidance and execution contract once across the whole prompt", async () => {
    const invocation = await runWithRuntimeTools();
    expect(invocation.userPrompt).not.toBe(invocation.systemPrompt);
    const prompt = `${invocation.systemPrompt}\n${invocation.userPrompt}`;
    expect(prompt.split("Connection tools:").length - 1).toBe(1);
    expect(prompt.split("Execution contract:").length - 1).toBe(1);
    expect(invocation.userPrompt).toContain("agent-1");
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
      transport: "stdio",
      command: { command: "paperclip-mcp-server", args: [], source: "path" },
      toolsets: "core",
      env: { PAPERCLIP_API_URL: "http://localhost:3100", PAPERCLIP_API_KEY: "k", PAPERCLIP_RUN_ID: "  " },
    });
    expect(entry.env).toEqual({
      PAPERCLIP_API_URL: "http://localhost:3100",
      PAPERCLIP_API_KEY: "${PAPERCLIP_API_KEY}",
      PAPERCLIP_MCP_TOOLSETS: "core",
    });
  });

  it("never writes the api key itself into the generated config", () => {
    const entry = buildPaperclipMcpServerEntry({
      enabled: true,
      transport: "stdio",
      command: { command: "paperclip-mcp-server", args: [], source: "path" },
      toolsets: "core",
      env: { PAPERCLIP_API_KEY: "super-secret-token" },
    });
    expect(JSON.stringify(entry)).not.toContain("super-secret-token");
  });
});
