#!/usr/bin/env node
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";
import v8 from "node:v8";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = path.join(os.homedir(), ".cache", "paperclip-openwa-bench");
mkdirSync(path.join(scratch, "tmp"), { recursive: true });
process.env.TMPDIR = path.join(scratch, "tmp");
process.env.PAPERCLIP_HOME = path.join(scratch, "home");
process.env.PAPERCLIP_INSTANCE_ID = "openwa-bench";
process.env.PAPERCLIP_LOG_LEVEL ??= "fatal";
v8.setFlagsFromString("--expose-gc");

const runnerSource = pathToFileURL(path.join(root, "packages/paperclip-runner/src/index.ts")).href;
const resolver = `export async function resolve(specifier, context, next) {
  if (specifier === "@tickernelz/paperclip-pro-paperclip-runner") return { url: ${JSON.stringify(runnerSource)}, shortCircuit: true };
  return next(specifier, context);
}`;
register("data:text/javascript," + encodeURIComponent(resolver));
const { register: registerTsx } = await import(pathToFileURL(path.join(root, "server/node_modules/tsx/dist/esm/api/index.mjs")).href);
registerTsx();
const { runOpenwaIngestBenchmark } = await import(pathToFileURL(path.join(root, "server/src/__tests__/openwa/ingest-bench.ts")).href);
const code = await runOpenwaIngestBenchmark({ argv: process.argv.slice(2), root, scratch });
process.stdout.write("", () => process.exit(code));
