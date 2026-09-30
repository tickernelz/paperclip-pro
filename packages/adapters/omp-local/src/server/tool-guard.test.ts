import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  OMP_ASYNC_BASH_TIMEOUT_SEC,
  OMP_TOOL_GUARD_FILE_NAME,
  renderOmpToolGuardExtension,
  writeOmpToolGuardExtension,
} from "./tool-guard.js";

type ToolCallHandler = (event: {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}) => { input?: Record<string, unknown> } | undefined;

describe("OMP tool guard extension", () => {
  let dir: string;
  let handler: ToolCallHandler;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-guard-test-"));
    const file = path.join(dir, OMP_TOOL_GUARD_FILE_NAME);
    await fs.writeFile(file, renderOmpToolGuardExtension(), "utf8");
    const module = (await import(pathToFileURL(file).href)) as {
      default: (pi: { on: (event: string, fn: ToolCallHandler) => void }) => void;
    };
    const registered: Array<{ event: string; fn: ToolCallHandler }> = [];
    module.default({ on: (event, fn) => registered.push({ event, fn }) });
    expect(registered.map((entry) => entry.event)).toEqual(["tool_call"]);
    handler = registered[0]!.fn;
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

  it("writes the extension as a single file with a cleanup that removes it", async () => {
    const extension = await writeOmpToolGuardExtension({
      runId: "run-guard",
      target: null,
      remote: false,
      env: {},
      remoteRootDir: null,
      cwd: dir,
      timeoutSec: 0,
      graceSec: 0,
    });
    expect(path.basename(extension.path)).toBe(OMP_TOOL_GUARD_FILE_NAME);
    expect(await fs.readFile(extension.path, "utf8")).toBe(renderOmpToolGuardExtension());
    await extension.cleanup();
    await expect(fs.access(extension.path)).rejects.toThrow();
  });
});
