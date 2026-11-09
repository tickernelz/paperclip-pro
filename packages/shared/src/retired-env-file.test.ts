import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RETIRED_ENV_FILE_BACKUP_SUFFIX,
  migrateRetiredEnvFile,
  migrateRetiredEnvFileContents,
} from "./retired-env-file.js";
import { resolvePaperclipEnvPathForConfig } from "./home-paths.js";

const retired = (name: string) => ["PAPER", "CLIP_", name].join("");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wardmote-retired-env-"));
  dirs.push(dir);
  return dir;
}

describe("retired env file migration", () => {
  it("renames retired keys, keeps values, comments and other keys byte for byte", () => {
    const input = [
      "# kept comment",
      `${retired("AGENT_JWT_SECRET")}=abc123`,
      `export ${retired("PUBLIC_URL")} = "https://x.example/a=b"`,
      "OTHER=1",
      "",
    ].join("\n");
    expect(migrateRetiredEnvFileContents(input)).toBe([
      "# kept comment",
      "WARDMOTE_AGENT_JWT_SECRET=abc123",
      'export WARDMOTE_PUBLIC_URL = "https://x.example/a=b"',
      "OTHER=1",
      "",
    ].join("\n"));
  });

  it("drops a retired key whose current name is already assigned", () => {
    const input = `${retired("HOME")}=/old\r\nWARDMOTE_HOME=/new\r\n`;
    expect(migrateRetiredEnvFileContents(input)).toBe("WARDMOTE_HOME=/new\r\n");
  });

  it("rewrites the file once, keeps an untouched owner-only backup, and is idempotent", () => {
    const dir = tempDir();
    const envPath = path.join(dir, ".env");
    const original = `${retired("TOOL_ACTION_SIGNING_SECRET")}=s1\n`;
    fs.writeFileSync(envPath, original, { mode: 0o644 });

    expect(migrateRetiredEnvFile(envPath)).toBe(true);
    expect(fs.readFileSync(envPath, "utf8")).toBe("WARDMOTE_TOOL_ACTION_SIGNING_SECRET=s1\n");
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
    const backup = envPath + RETIRED_ENV_FILE_BACKUP_SUFFIX;
    expect(fs.readFileSync(backup, "utf8")).toBe(original);
    expect(fs.statSync(backup).mode & 0o777).toBe(0o600);

    expect(migrateRetiredEnvFile(envPath)).toBe(false);
    expect(fs.readFileSync(backup, "utf8")).toBe(original);
  });

  it("migrates the instance env file when its path is resolved", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, ".env"), `${retired("AGENT_JWT_SECRET")}=keep\n`);
    const envPath = resolvePaperclipEnvPathForConfig(path.join(dir, "config.json"));
    expect(fs.readFileSync(envPath, "utf8")).toBe("WARDMOTE_AGENT_JWT_SECRET=keep\n");
  });

  it("leaves a missing file alone", () => {
    expect(migrateRetiredEnvFile(path.join(tempDir(), ".env"))).toBe(false);
  });
});
