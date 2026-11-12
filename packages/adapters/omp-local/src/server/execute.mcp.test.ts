import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@tickernelz/wardmote-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

vi.mock("./wardmote-mcp.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, probeWardmoteMcpServer: vi.fn(), probeWardmoteMcpEndpoint: vi.fn() };
});

import { execute } from "./execute.js";
import { OMP_TOOL_GUARD_FILE_NAME } from "./tool-guard.js";
import { OMP_PYTHON_ENV_FILE_NAME, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME } from "./python-env.js";
import {
  WARDMOTE_MCP_BIN,
  WARDMOTE_MCP_PACKAGE,
  WARDMOTE_MCP_CREDENTIAL_CODE,
  WARDMOTE_MCP_SERVER_NAME,
  WARDMOTE_MCP_UNAVAILABLE_CODE,
  buildWardmoteMcpServerEntry,
  wardmoteMcpEndpoint,
  wardmoteMcpToolsets,
  probeWardmoteMcpEndpoint,
  probeWardmoteMcpServer,
  resolveWardmoteMcpServerCommand,
} from "./wardmote-mcp.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/wardmote-adapter-utils/execution-target";
import type * as WardmoteMcpModule from "./wardmote-mcp.js";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);
const probeMock = vi.mocked(probeWardmoteMcpServer);
const endpointProbeMock = vi.mocked(probeWardmoteMcpEndpoint);
const realMcp = await vi.importActual<typeof WardmoteMcpModule>("./wardmote-mcp.js");

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

describe("OMP local Wardmote MCP wiring", () => {
  let root: string;
  let commandPath: string;
  let workspaceCwd: string;
  let captured: Invocation | null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-mcp-test-"));
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
          .mcpServers.wardmote ?? null;
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

  async function run(config: Record<string, unknown>, authToken: string | null = "run-jwt", context: Record<string, unknown> = {}): Promise<Invocation> {
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
      context,
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
      url: wardmoteMcpEndpoint(invocation.env.WARDMOTE_API_URL, "core"),
      headers: {
        Authorization: "Bearer ${WARDMOTE_API_KEY}",
        "X-Wardmote-Run-Id": "run-mcp",
      },
    });
    expect(invocation.env.WARDMOTE_API_KEY).toBe("run-jwt");
    expect(invocation.systemPrompt).toContain("wardmoteListIssues");
  });

  it("passes the configured toolsets to the endpoint", async () => {
    const invocation = await run({ wardmoteMcpToolsets: " extended , core " });
    expect(invocation.mcpServer?.url).toBe(wardmoteMcpEndpoint(invocation.env.WARDMOTE_API_URL, "extended,core"));
    expect(invocation.mcpServer?.url).toContain("toolsets=extended%2Ccore");
    expect(invocation.systemPrompt).toContain("toolsets: extended,core");
  });

  it("mentions the todo tool once in the system prompt and never in the wake prompt", async () => {
    const invocation = await run({});
    expect(invocation.systemPrompt.match(/\btodo tool\b/g)).toHaveLength(1);
    expect(invocation.userPrompt).not.toMatch(/\btodo tool\b/);
  });

  it("passes the tool guard extension to OMP and removes it once the run finishes", async () => {
    const invocation = await run({});
    expect(invocation.toolGuardPath).toBeTruthy();
    await expect(fs.access(invocation.toolGuardPath as string)).rejects.toThrow();
  });

  it("keeps a large wake payload out of the process environment so OMP can start", async () => {
    const body = "x".repeat(140_000);
    const invocation = await run({}, "run-jwt", {
      taskId: "issue-1",
      wakeReason: "issue_commented",
      wardmoteWake: { reason: "issue_commented", issue: { id: "issue-1", identifier: "ZHA-1", title: "Big" }, comments: [{ id: "c1", body }] },
    });
    expect(invocation.env).not.toHaveProperty("WARDMOTE_WAKE_PAYLOAD_JSON");
    expect(invocation.env.WARDMOTE_TASK_ID).toBe("issue-1");
    expect(invocation.env.WARDMOTE_WAKE_REASON).toBe("issue_commented");
    expect(Math.max(...Object.values(invocation.env).map((value) => String(value).length))).toBeLessThan(131_072);
  });

  it("hands the Python kernel the run's WARDMOTE_* env through a private sitecustomize dir", async () => {
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
        Object.entries(invocation.env).filter(([key]) => key.startsWith("WARDMOTE_")),
      );
      expect(bridge!.data).toEqual(forwarded);
      expect(bridge!.data.WARDMOTE_API_KEY).toBe("run-jwt");
      expect(invocation.args.join("\n")).not.toContain("run-jwt");
      expect(invocation.env.PYTHONPATH).not.toContain("run-jwt");
      await expect(fs.access(bridge!.dir)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = previous;
    }
  });

  it("falls back to the bundled stdio server when configured", async () => {
    const invocation = await run({ wardmoteMcpTransport: "stdio" });
    expect(invocation.mcpServer).toMatchObject({ type: "stdio", enabled: true });
    expect(invocation.mcpServer?.args).toEqual(expect.arrayContaining(["--toolsets", "core"]));
    expect(invocation.mcpServer?.env).toMatchObject({
      WARDMOTE_API_KEY: "${WARDMOTE_API_KEY}",
      WARDMOTE_AGENT_ID: "agent-1",
      WARDMOTE_COMPANY_ID: "company-1",
      WARDMOTE_RUN_ID: "run-mcp",
      WARDMOTE_MCP_TOOLSETS: "core",
    });
  });

  it("pins the server off and warns that the agent has no Wardmote tools", async () => {
    const invocation = await run({ wardmoteMcp: false });
    expect(invocation.mcpDir).toBeTruthy();
    expect(invocation.mcpServer).toMatchObject({ enabled: false });
    expect(invocation.systemPrompt).not.toMatch(/\bpaperclip[A-Z]\w*/);
    expect(invocation.systemPrompt).toContain("Authorization: Bearer $WARDMOTE_API_KEY");
    expect(invocation.systemPrompt).toContain("X-Wardmote-Run-Id: $WARDMOTE_RUN_ID");
    expect(invocation.systemPrompt).toContain("POST /api/issues/$WARDMOTE_TASK_ID/interactions");
    expect(probeMock).not.toHaveBeenCalled();
    expect(endpointProbeMock).not.toHaveBeenCalled();
    const logs: Array<{ stream: string; chunk: string }> = [];
    await runResult({ wardmoteMcp: false }, logs);
    expect(logs.some((entry) => entry.stream === "stderr" && entry.chunk.includes("has no Wardmote tools this run"))).toBe(true);
  });

  it("fails the run before spawning OMP and schedules a retry when the MCP endpoint times out", async () => {
    endpointProbeMock.mockImplementation((input) =>
      realMcp.probeWardmoteMcpEndpoint({
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
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
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
      realMcp.probeWardmoteMcpEndpoint({
        ...input,
        fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
      }),
    );
    const result = await runResult({});
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
    expect(result.errorFamily).toBeUndefined();
    expect(result.retryNotBefore).toBeUndefined();
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it("does not schedule a retry when the stdio MCP server cannot be spawned", async () => {
    probeMock.mockImplementation((input) =>
      realMcp.probeWardmoteMcpServer({
        ...input,
        command: { ...input.command, command: path.join(root, "missing-wardmote-mcp"), args: [] },
      }),
    );
    const result = await runResult({ wardmoteMcpTransport: "stdio" });
    expect(probeMock).toHaveBeenCalled();
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
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
    expect(result.errorCode).toBe(WARDMOTE_MCP_CREDENTIAL_CODE);
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
        `Warning: MCP server "${WARDMOTE_MCP_SERVER_NAME}" failed to connect: ${reason}; its tools are unavailable for this run.\n`,
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
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
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
          message: `Warning: MCP server "${WARDMOTE_MCP_SERVER_NAME}" failed to connect: MCP subprocess closed stdout before responding; its tools are unavailable for this run.`,
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
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
    expect(result.errorMessage).toContain("failed to connect");
  });

  function streamChunks(chunks: Array<{ stream: "stdout" | "stderr"; chunk: string }>): void {
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      options: { onLog: (stream: string, chunk: string) => Promise<void> },
    ) => {
      for (const entry of chunks) await options.onLog(entry.stream, entry.chunk);
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
  }

  const connectFailureText = `Warning: MCP server "${WARDMOTE_MCP_SERVER_NAME}" failed to connect: spawn ENOENT; its tools are unavailable for this run.`;
  const adapterFailureText = `MCP server "${WARDMOTE_MCP_SERVER_NAME}" failed to connect; the agent had no tools.`;

  it.each([
    {
      label: "a user prompt echoed back by OMP",
      frame: {
        type: "message_start",
        messageId: "msg-2",
        message: { role: "user", content: [{ type: "text", text: `Latest run error: ${adapterFailureText}\n${connectFailureText}` }] },
      },
    },
    {
      label: "a tool result that quotes the warning",
      frame: {
        type: "tool_execution_end",
        toolCallId: "call-1",
        result: { content: [{ type: "text", text: `stderr: ${connectFailureText}` }] },
      },
    },
    {
      label: "an assistant message that quotes the warning",
      frame: {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: connectFailureText }] },
      },
    },
    {
      label: "a notice frame that only mentions the warning in passing",
      frame: { type: "notice", level: "info", message: `diagnostic copy: ${connectFailureText}` },
    },
  ])("does not fail the run when stdout merely carries $label", async ({ frame }) => {
    streamChunks([{ stream: "stdout", chunk: `${JSON.stringify(frame)}\n` }]);
    const logs: Array<{ stream: string; chunk: string }> = [];
    const result = await runResult({}, logs);
    expect(result.errorCode).not.toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
    expect(result.errorMessage ?? "").not.toContain("failed to connect");
    expect(logs.some((entry) => entry.chunk.includes("did not connect"))).toBe(false);
  });

  it("does not fail the run when stderr only quotes the warning mid-line", async () => {
    streamChunks([{ stream: "stderr", chunk: `[tool] saw: ${connectFailureText}\n` }]);
    const logs: Array<{ stream: string; chunk: string }> = [];
    const result = await runResult({}, logs);
    expect(result.errorCode).not.toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
    expect(result.errorMessage ?? "").not.toContain("failed to connect");
    expect(logs.some((entry) => entry.chunk.includes("did not connect"))).toBe(false);
  });

  it("fails the run when a genuine notice frame arrives split across stdout chunks", async () => {
    const line = `${JSON.stringify({ type: "notice", level: "warning", message: connectFailureText })}\n`;
    const cut = Math.floor(line.length / 2);
    streamChunks([
      { stream: "stdout", chunk: line.slice(0, cut) },
      { stream: "stdout", chunk: line.slice(cut) },
    ]);
    const result = await runResult({});
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
  });

  it("fails the run when a genuine stderr warning arrives split across chunks", async () => {
    const line = `${connectFailureText}\n`;
    const cut = Math.floor(line.length / 2);
    streamChunks([
      { stream: "stderr", chunk: line.slice(0, cut) },
      { stream: "stderr", chunk: line.slice(cut) },
    ]);
    const result = await runResult({});
    expect(result.errorCode).toBe(WARDMOTE_MCP_UNAVAILABLE_CODE);
  });

  it("keeps configured extensions after the generated one", async () => {
    const userExtension = path.join(root, "user-extension");
    await fs.mkdir(userExtension, { recursive: true });
    const invocation = await run({ extensions: userExtension });
    expect(invocation.extensionDirs).toHaveLength(2);
    expect(invocation.extensionDirs[0]).toBe(invocation.mcpDir);
    expect(invocation.extensionDirs[1]).toBe(userExtension);
  });

  it("declares nothing when the run has no Wardmote API key", async () => {
    const previous = process.env.WARDMOTE_API_KEY;
    delete process.env.WARDMOTE_API_KEY;
    try {
      const invocation = await run({}, null);
      expect(invocation.extensionDirs).toHaveLength(0);
      expect(invocation.toolGuardPath).toBeTruthy();
      expect(invocation.mcpServer).toBeNull();
    } finally {
      if (previous !== undefined) process.env.WARDMOTE_API_KEY = previous;
    }
  });

  it("never takes the API key or agent identity from config under either name", async () => {
    const previous = process.env.WARDMOTE_API_KEY;
    delete process.env.WARDMOTE_API_KEY;
    try {
      const invocation = await run({
        env: { WARDMOTE_API_KEY: "config-key", WARDMOTE_AGENT_PRIVATE_KEY: "config-identity", WARDMOTE_CUSTOM: "kept" },
      }, null);
      expect(invocation.env.WARDMOTE_API_KEY).toBeUndefined();
      expect(invocation.env.WARDMOTE_AGENT_PRIVATE_KEY).toBeUndefined();
      expect(invocation.env.WARDMOTE_CUSTOM).toBe("kept");
      expect(invocation.mcpServer).toBeNull();
    } finally {
      if (previous !== undefined) process.env.WARDMOTE_API_KEY = previous;
    }
  });

  it("removes the generated MCP extension once the run finishes", async () => {
    const invocation = await run({});
    await expect(fs.access(invocation.mcpDir as string)).rejects.toThrow();
  });

  async function runWithRuntimeTools(
    overrides: { runId?: string; expiresAt?: string; config?: Record<string, unknown> } = {},
  ): Promise<Invocation> {
    await execute({
      runId: overrides.runId ?? "run-mcp",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, rpcSteering: false, ...overrides.config },
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
        expiresAt: overrides.expiresAt ?? "2026-09-28T12:00:00.000Z",
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
          wardmoteWake: { reason: "External chat message received", issue: { id: "issue-1", identifier: "ZHA-1", title: "OpenWA chat" } },
          wardmoteTaskMarkdown: brief,
          wardmoteTaskMarkdownCompact: brief,
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
      WARDMOTE_RUNTIME_TOOLS_TOKEN: "runtime-token",
      WARDMOTE_RUNTIME_TOOLS_CONNECTIONS_SEARCH_URL: "http://127.0.0.1:3100/runtime-tools/connections/search",
      WARDMOTE_RUNTIME_TOOLS_CONNECTION_REQUEST_URL: "http://127.0.0.1:3100/runtime-tools/connections/request",
    });
  });

  it("keeps the system prompt byte-identical across runs so a resumed session reuses the provider prompt cache", async () => {
    const runs = [
      { runId: "run-a", expiresAt: "2026-11-12T01:00:00.000Z" },
      { runId: "run-b", expiresAt: "2026-11-12T02:00:00.000Z" },
    ];
    const invocations: Invocation[] = [];
    for (const { runId, expiresAt } of runs) {
      const instructionsDir = path.join(root, "file-sync", "runs", runId, "live");
      await fs.mkdir(instructionsDir, { recursive: true });
      await fs.writeFile(path.join(instructionsDir, "AGENTS.md"), "You are the probe agent.\n", "utf8");
      captured = null;
      invocations.push(
        await runWithRuntimeTools({
          runId,
          expiresAt,
          config: { instructionsFilePath: path.join(instructionsDir, "AGENTS.md") },
        }),
      );
    }
    const [first, second] = invocations;
    expect(first.systemPrompt).toContain("You are the probe agent.");
    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(first.env.WARDMOTE_RUNTIME_TOOLS_EXPIRES_AT).toBe("2026-11-12T01:00:00.000Z");
    expect(second.env.WARDMOTE_RUNTIME_TOOLS_EXPIRES_AT).toBe("2026-11-12T02:00:00.000Z");
    expect(first.userPrompt).toContain(path.join(root, "file-sync", "runs", "run-a", "live", "AGENTS.md"));
    expect(second.userPrompt).toContain(path.join(root, "file-sync", "runs", "run-b", "live", "AGENTS.md"));
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

describe("Wardmote MCP server resolution", () => {
  const root = path.join("/opt", "paperclip", "node_modules", "@tickernelz", "adapter", "dist", "server");

  it("prefers the nearest bin shim", () => {
    const bin = path.join("/opt", "paperclip", "node_modules", ".bin", WARDMOTE_MCP_BIN);
    const resolved = resolveWardmoteMcpServerCommand({
      searchFrom: root,
      exists: (candidate) => candidate === bin,
    });
    expect(resolved).toEqual({ command: bin, args: [], source: "bin" });
  });

  it("falls back to the package entry point when no shim exists", () => {
    const dist = path.join("/opt", "paperclip", "node_modules", WARDMOTE_MCP_PACKAGE, "dist", "stdio.js");
    const resolved = resolveWardmoteMcpServerCommand({
      searchFrom: root,
      exists: (candidate) => candidate === dist,
      nodePath: "/usr/bin/node",
    });
    expect(resolved).toEqual({ command: "/usr/bin/node", args: [dist], source: "dist" });
  });

  it("falls back to PATH when the package is absent", () => {
    const resolved = resolveWardmoteMcpServerCommand({ searchFrom: root, exists: () => false });
    expect(resolved).toEqual({ command: WARDMOTE_MCP_BIN, args: [], source: "path" });
  });

  it("uses the package entry that ships with an install", () => {
    const resolved = resolveWardmoteMcpServerCommand({
      searchFrom: path.join("/opt", "paperclip", "node_modules", "@tickernelz", "adapter"),
      exists: (candidate) => candidate.endsWith(path.join("dist", "stdio.js")),
      nodePath: "/usr/bin/node",
    });
    expect(resolved.source).toBe("dist");
    expect(resolved.args[0]).toContain(WARDMOTE_MCP_PACKAGE);
  });
});

describe("Wardmote MCP server entry", () => {
  it("defaults to the core toolset and omits env the run does not carry", () => {
    expect(wardmoteMcpToolsets({})).toBe("core");
    expect(wardmoteMcpToolsets({ wardmoteMcpToolsets: " , " })).toBe("core");
    const entry = buildWardmoteMcpServerEntry({
      enabled: true,
      transport: "stdio",
      command: { command: "wardmote-mcp-server", args: [], source: "path" },
      toolsets: "core",
      env: { WARDMOTE_API_URL: "http://localhost:3100", WARDMOTE_API_KEY: "k", WARDMOTE_RUN_ID: "  " },
    });
    expect(entry.env).toEqual({
      WARDMOTE_API_URL: "http://localhost:3100",
      WARDMOTE_API_KEY: "${WARDMOTE_API_KEY}",
      WARDMOTE_MCP_TOOLSETS: "core",
    });
  });

  it("never writes the api key itself into the generated config", () => {
    const entry = buildWardmoteMcpServerEntry({
      enabled: true,
      transport: "stdio",
      command: { command: "wardmote-mcp-server", args: [], source: "path" },
      toolsets: "core",
      env: { WARDMOTE_API_KEY: "super-secret-token" },
    });
    expect(JSON.stringify(entry)).not.toContain("super-secret-token");
  });
});
