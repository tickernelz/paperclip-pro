import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localTerminalFiles } from "./files.js";
import { TerminalSessionManager } from "./manager.js";
import { buildLocalTerminalEnv, spawnLocalTerminal } from "./process.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("local terminal process", () => {
  let workDir: string;
  let manager: TerminalSessionManager;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), "terminal-proc-"));
    manager = new TerminalSessionManager({ reapIntervalMs: 0 });
  });

  afterEach(() => {
    manager.shutdown();
    rmSync(workDir, { recursive: true, force: true });
  });

  it.each([
    ["in the shell's process group", "sleep 300 & echo SLEEPPID=$!; wait"],
    ["in a separate job-control process group", "set -m; sleep 300 & echo SLEEPPID=$!; wait"],
    ["that ignore SIGHUP", "trap '' HUP; sleep 300 & echo SLEEPPID=$!; wait"],
  ])("kills background children %s when the session is destroyed", async (_label, script) => {
    const child = spawnLocalTerminal({
      cwd: workDir,
      cols: 80,
      rows: 24,
      shell: "/bin/sh",
      args: ["-c", script],
    });
    let output = "";
    child.onData((data) => {
      output += data;
    });
    const session = manager.register({
      companyId: "company-a",
      kind: "local",
      title: "sh",
      cwd: workDir,
      issueId: null,
      environmentId: null,
      cols: 80,
      rows: 24,
      createdByUserId: "user-1",
      process: child,
      files: localTerminalFiles(workDir),
    });
    await waitUntil(() => /SLEEPPID=\d+/.test(output));
    const sleepPid = Number(/SLEEPPID=(\d+)/.exec(output)![1]);
    expect(isAlive(sleepPid)).toBe(true);
    expect(isAlive(child.pid)).toBe(true);

    manager.kill("company-a", session.id);
    expect(manager.get("company-a", session.id)).toMatchObject({ status: "exited" });

    await waitUntil(() => !isAlive(sleepPid));
    expect(() => process.kill(sleepPid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    await waitUntil(() => manager.get("company-a", session.id) === null);
  });

  it("hands the ssh agent socket to the shell but not server secrets", () => {
    const env = buildLocalTerminalEnv("/bin/sh", {
      PATH: "/usr/bin",
      HOME: "/home/u",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      DATABASE_URL: "postgres://secret",
      BETTER_AUTH_SECRET: "secret",
    });
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/u",
      SHELL: "/bin/sh",
      TERM: "xterm-256color",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
  });
});
