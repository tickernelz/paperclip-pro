import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { paperclipConfigSchema } from "../config/schema.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tsxEntry = path.join(repoRoot, "cli", "node_modules", "tsx", "dist", "cli.mjs");
const cliEntry = path.join(repoRoot, "cli", "src", "index.ts");

function createIsolatedHome(instanceId: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-exit-code-"));
  const instanceDir = path.join(home, "instances", instanceId);
  fs.mkdirSync(instanceDir, { recursive: true });
  const config = paperclipConfigSchema.parse({
    $meta: { version: 1, updatedAt: new Date().toISOString(), source: "onboard" },
    llm: { provider: "claude" },
    database: {},
    logging: { mode: "file" },
    server: { host: "127.0.0.1", port: 59_231 },
  });
  fs.writeFileSync(path.join(instanceDir, "config.json"), JSON.stringify(config, null, 2));
  return home;
}

async function runServiceCommand(args: string[], home: string): Promise<{ code: number; stderr: string; stdout: string }> {
  try {
    const result = await execFileAsync(process.execPath, [tsxEntry, cliEntry, ...args], {
      cwd: home,
      env: {
        PATH: "/nonexistent-paperclip-test-path",
        HOME: home,
        PAPERCLIP_HOME: home,
        PAPERCLIP_TELEMETRY_DISABLED: "1",
        DO_NOT_TRACK: "1",
      },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe.runIf(process.platform === "linux")("service command exit codes", () => {
  it("fails loudly when no service manager can be detected", async () => {
    const home = createIsolatedHome("exitcode");
    try {
      const result = await runServiceCommand(["service", "stop", "--instance", "exitcode"], home);
      expect(result.code).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toContain("systemd");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it("fails loudly when the guard cannot reach the instance", async () => {
    const home = createIsolatedHome("exitcode");
    fs.writeFileSync(
      path.join(home, "instances", "exitcode", "runtime-info.json"),
      JSON.stringify({
        schemaVersion: 1,
        instanceId: "exitcode",
        pid: process.pid,
        host: "127.0.0.1",
        port: 59_231,
        dashboardUrl: "http://127.0.0.1:59231",
        startedAt: new Date().toISOString(),
      }),
    );
    try {
      const result = await runServiceCommand(["service", "restart", "--instance", "exitcode"], home);
      expect(result.code).not.toBe(0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
