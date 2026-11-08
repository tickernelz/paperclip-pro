import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV } from "@tickernelz/paperclip-pro-db/test-embedded-postgres";

const require = createRequire(import.meta.url);

function prepareTemplateInChildProcess(): string | null {
  const result = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), fileURLToPath(new URL("./embedded-postgres-template.prepare.ts", import.meta.url))],
    { encoding: "utf8", env: process.env, timeout: 120_000 },
  );
  if (result.status !== 0) return null;
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? "";
  try {
    const { dataDir } = JSON.parse(lastLine) as { dataDir?: unknown };
    return typeof dataDir === "string" && fs.existsSync(dataDir) ? dataDir : null;
  } catch {
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
