import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  OMP_ASYNC_BASH_TIMEOUT_SEC,
  OMP_READ_ONLY_BLOCK_REASON,
  OMP_TOOL_GUARD_FILE_NAME,
  renderOmpToolGuardExtension,
  writeOmpToolGuardExtension,
} from "./tool-guard.js";
import type { RunToolProfile } from "@tickernelz/paperclip-pro-adapter-utils/tool-profile";

type ToolCallHandler = (event: {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}) => { input?: Record<string, unknown>; block?: boolean; reason?: string } | undefined;

async function loadGuard(dir: string, profile: RunToolProfile): Promise<ToolCallHandler> {
  const file = path.join(dir, `${profile}-${OMP_TOOL_GUARD_FILE_NAME}`);
  await fs.writeFile(file, renderOmpToolGuardExtension(profile), "utf8");
  const module = (await import(pathToFileURL(file).href)) as {
    default: (pi: { on: (event: string, fn: ToolCallHandler) => void }) => void;
  };
  const registered: Array<{ event: string; fn: ToolCallHandler }> = [];
  module.default({ on: (event, fn) => registered.push({ event, fn }) });
  expect(registered.map((entry) => entry.event)).toEqual(["tool_call"]);
  return registered[0]!.fn;
}

describe("OMP tool guard extension", () => {
  let dir: string;
  let handler: ToolCallHandler;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-guard-test-"));
    handler = await loadGuard(dir, "full");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function call(toolName: string, input: Record<string, unknown>) {
    return handler({ type: "tool_call", toolCallId: "call-1", toolName, input });
  }

  it("gives an async bash job without a timeout the OMP maximum", () => {
    const input = { command: "pnpm test", async: true };
    expect(call("bash", input)).toEqual({
      input: { command: "pnpm test", async: true, timeout: OMP_ASYNC_BASH_TIMEOUT_SEC },
    });
    expect(input).toEqual({ command: "pnpm test", async: true });
  });

  it("drops a ready spec that carries no condition and fills the async timeout in the same call", () => {
    expect(call("bash", { command: "pnpm build", async: true, ready: {} })).toEqual({
      input: { command: "pnpm build", async: true, timeout: OMP_ASYNC_BASH_TIMEOUT_SEC },
    });
    expect(call("bash", { command: "ls", ready: { log: " ", host: "" } })).toEqual({
      input: { command: "ls" },
    });
  });

  it("keeps an explicit async timeout", () => {
    expect(call("bash", { command: "pnpm test", async: true, timeout: 600 })).toBeUndefined();
  });

  it("keeps a ready spec that carries a condition when no service name is given", () => {
    expect(call("bash", { command: "serve", ready: { port: 3000 } })).toBeUndefined();
    expect(call("bash", { command: "serve", ready: { timeout: 30 } })).toBeUndefined();
  });

  it("leaves service calls with a name untouched", () => {
    expect(call("bash", { command: "serve", name: "web", ready: {} })).toBeUndefined();
    expect(call("bash", { command: "serve", name: "web", async: true })).toBeUndefined();
  });

  it("leaves synchronous bash and other tools untouched", () => {
    expect(call("bash", { command: "ls" })).toBeUndefined();
    expect(call("bash", { command: "ls", async: false })).toBeUndefined();
    expect(call("read", { path: "a.ts", async: true, ready: {} })).toBeUndefined();
  });

  it("lets a full-profile run call write tools", () => {
    expect(call("write", { path: "x.txt", content: "hello" })).toBeUndefined();
    expect(call("edit", { path: "x.txt", input: "patch" })).toBeUndefined();
    expect(call("lsp", { action: "rename", file: "a.ts", new_name: "b" })).toBeUndefined();
  });

  it("writes the extension for the run profile with a cleanup that removes it", async () => {
    for (const profile of ["full", "read_only"] as const) {
      const extension = await writeOmpToolGuardExtension({
        runId: `run-guard-${profile}`,
        target: null,
        remote: false,
        env: {},
        remoteRootDir: null,
        cwd: dir,
        timeoutSec: 0,
        graceSec: 0,
        profile,
      });
      expect(path.basename(extension.path)).toBe(OMP_TOOL_GUARD_FILE_NAME);
      expect(await fs.readFile(extension.path, "utf8")).toBe(renderOmpToolGuardExtension(profile));
      await extension.cleanup();
      await expect(fs.access(extension.path)).rejects.toThrow();
    }
  });
});

describe("OMP tool guard extension in a read_only run", () => {
  let dir: string;
  let handler: ToolCallHandler;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-guard-ro-test-"));
    handler = await loadGuard(dir, "read_only");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function call(toolName: string, input: Record<string, unknown>) {
    return handler({ type: "tool_call", toolCallId: "call-1", toolName, input });
  }

  const blocked = { block: true, reason: OMP_READ_ONLY_BLOCK_REASON };

  it.each([
    ["write", { path: "x.txt", content: "hello" }],
    ["write", { path: "[x.txt#ABCD]", content: "hello" }],
    ["edit", { path: "x.txt", input: "patch" }],
    ["apply_patch", { input: "*** Begin Patch" }],
    ["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: ["src"] }],
    ["lsp", { action: "rename", file: "a.ts", symbol: "a", new_name: "b" }],
    ["lsp", { action: "rename_file", file: "a.ts", new_name: "b.ts" }],
    ["lsp", { action: "code_actions", file: "a.ts", apply: true, query: "fix" }],
    ["lsp", { action: "request", query: "workspace/executeCommand" }],
    ["github", { op: "pr_create", title: "t" }],
    ["github", { op: "pr_push" }],
    ["hub", { op: "send", to: "peer", message: "do it" }],
    ["task", { agent: "task", task: "edit", isolated: true }],
    ["task", { context: "c", tasks: [{ agent: "task", task: "edit", isolated: true }] }],
    ["tts", { text: "hi", output_path: "a.wav" }],
    ["retain", { items: [] }],
    ["memory_edit", { op: "forget", id: "m" }],
    ["learn", { lesson: "x" }],
    ["manage_skill", { op: "create" }],
    ["vibe_spawn", { task: "x" }],
    ["vibe_send", { id: "x", message: "y" }],
  ])("blocks %s with the read-only reason (%j)", (toolName, input) => {
    expect(call(toolName, input)).toEqual(blocked);
  });

  it.each([
    ["read", { path: "a.ts" }],
    ["grep", { pattern: "x" }],
    ["glob", { pattern: "*.ts" }],
    ["ast_grep", { pat: "x" }],
    ["bash", { command: "cat a.ts" }],
    ["eval", { language: "py", code: "1" }],
    ["web_search", { query: "x" }],
    ["browser", { action: "open" }],
    ["write", { path: "xd://resolve", content: "reason" }],
    ["write", { path: "xd://lsp", content: "{}" }],
    ["lsp", { action: "references", file: "a.ts", symbol: "a" }],
    ["lsp", { action: "diagnostics", file: "a.ts" }],
    ["lsp", { action: "rename", file: "a.ts", symbol: "a", new_name: "b", apply: false }],
    ["lsp", { action: "code_actions", file: "a.ts" }],
    ["github", { op: "file_read", path: "README.md" }],
    ["hub", { op: "inbox" }],
    ["task", { agent: "scout", task: "find the bug" }],
    ["recall", { query: "x" }],
  ])("lets %s through (%j)", (toolName, input) => {
    expect(call(toolName, input)).toBeUndefined();
  });

  it("keeps the async bash timeout fix in a read_only run", () => {
    expect(call("bash", { command: "pnpm test", async: true })).toEqual({
      input: { command: "pnpm test", async: true, timeout: OMP_ASYNC_BASH_TIMEOUT_SEC },
    });
  });
});
