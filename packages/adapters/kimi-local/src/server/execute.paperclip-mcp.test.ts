import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@tickernelz/paperclip-pro-adapter-utils";

const runProcessMock = vi.hoisted(() => vi.fn());

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", () => ({
  adapterExecutionTargetIsRemote: () => false,
  adapterExecutionTargetRemoteCwd: (_target: unknown, cwd: string) => cwd,
  overrideAdapterExecutionTargetRemoteCwd: (target: unknown) => target,
  adapterExecutionTargetSessionIdentity: () => ({ kind: "local" }),
  adapterExecutionTargetSessionMatches: () => true,
  adapterExecutionTargetUsesManagedHome: () => false,
  adapterExecutionTargetUsesPaperclipBridge: () => false,
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: async () => {},
  ensureAdapterExecutionTargetRuntimeCommandInstalled: async () => {},
  prepareAdapterExecutionTargetRuntime: async () => ({
    workspaceRemoteDir: null,
    restoreWorkspace: async () => {},
  }),
  readAdapterExecutionTarget: () => ({ kind: "local" }),
  readAdapterExecutionTargetHomeDir: async () => null,
  resolveAdapterExecutionTargetCommandForLogs: async () => "kimi",
  resolveAdapterExecutionTargetTimeoutSec: (_target: unknown, timeoutSec: number) => timeoutSec,
  runAdapterExecutionTargetProcess: runProcessMock,
  runAdapterExecutionTargetShellCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  startAdapterExecutionTargetPaperclipBridge: async () => null,
}));

import { execute } from "./execute.js";

const tempRoots: string[] = [];
const PAPERCLIP_TOOL_NAME = /paperclip[A-Z]/;

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kimi-rest-"));
  tempRoots.push(root);
  return root;
}

function makeCtx(root: string): AdapterExecutionContext {
  return {
    runId: "run-rest",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Kimi Agent",
      adapterType: "kimi_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { cwd: root, engine: "cli" },
    context: {},
    authToken: "run-token",
    onLog: async () => {},
  } as AdapterExecutionContext;
}

describe("kimi_local CLI lane Paperclip access", () => {
  const previousApiUrl = process.env.PAPERCLIP_API_URL;

  beforeEach(() => {
    process.env.PAPERCLIP_API_URL = "https://paperclip.test";
    runProcessMock.mockReset();
  });

  afterEach(async () => {
    if (previousApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = previousApiUrl;
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("teaches the REST API and names no paperclip tool, because the CLI lane mounts no MCP server", async () => {
    const root = await makeTempRoot();
    let prompt = "";
    runProcessMock.mockImplementation(async (_runId, _target, _command, args: string[]) => {
      prompt = args[args.length - 1] ?? "";
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({ role: "assistant", content: "done" }),
        stderr: "",
      };
    });

    await execute(makeCtx(root));

    expect(prompt).not.toMatch(PAPERCLIP_TOOL_NAME);
    expect(prompt).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(prompt).toContain("X-Paperclip-Run-Id");
  });
});
