import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV } from "@tickernelz/wardmote-db/test-embedded-postgres";

const require = createRequire(import.meta.url);

function prepareTemplateInChildProcess(): string | null {
  const result = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), fileURLToPath(new URL("./embedded-postgres-template.prepare.ts", import.meta.url))],
    { encoding: "utf8", env: process.env, timeout: 120_000 },
  );
  if (result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status ?? result.signal}`;
    console.warn(`[embedded-postgres-template] template preparation failed (${reason}); every test file falls back to its own initdb.\n${result.stderr ?? ""}`);
    return null;
  }
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? "";
  try {
    const { dataDir } = JSON.parse(lastLine) as { dataDir?: unknown };
    if (typeof dataDir === "string" && fs.existsSync(dataDir)) return dataDir;
    console.warn(`[embedded-postgres-template] template output names no existing data dir: ${lastLine}; every test file falls back to its own initdb.`);
    return null;
  } catch (error) {
    console.warn(`[embedded-postgres-template] template output is not JSON (${error instanceof Error ? error.message : String(error)}): ${lastLine}; every test file falls back to its own initdb.`);
    return null;
  }
}

export default function setup(): (() => void) | undefined {
  if (process.env[EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV]) return undefined;
  const dataDir = prepareTemplateInChildProcess();
  if (!dataDir) return undefined;
  process.env[EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV] = dataDir;
  return () => {
    delete process.env[EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV];
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}
