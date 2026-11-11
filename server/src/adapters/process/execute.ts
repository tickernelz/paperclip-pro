import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  asString,
  asNumber,
  asStringArray,
  parseObject,
  buildWardmoteEnv,
  buildRuntimeToolsEnv,
  isForbiddenConfigEnvKey,
  isWardmoteRuntimeEnvKey,
  buildInvocationEnvForLogs,
  ensurePathInEnv,
  resolveCommandForLogs,
  runChildProcess,
} from "../utils.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  let spawned = false;
  try {
    return await executeProcess({ ...ctx, onSpawn: async (meta) => {
      // Set this before metadata persistence: a failed callback cannot prove
      // that the already-created process did no billable work.
      spawned = true;
      await ctx.onSpawn?.(meta);
    } });
  } catch (error) {
    if (spawned) throw error;
    return { exitCode: 1, signal: null, timedOut: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
    };
  }
}

async function executeProcess(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, onLog, onMeta, authToken } = ctx;
  const command = asString(config.command, "");
  if (!command) throw new Error("Process adapter missing command");

  const args = asStringArray(config.args);
  const cwd = asString(config.cwd, process.cwd());
  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {
    ...buildWardmoteEnv(agent, { sameHost: true }, ctx.agentIdentity),
    ...buildRuntimeToolsEnv(ctx.runtimeTools),
  };
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v !== "string") continue;
    if (isForbiddenConfigEnvKey(k)) continue;
    if (isWardmoteRuntimeEnvKey(k) && k in env) continue;
    env[k] = v;
  }
  env.WARDMOTE_RUN_ID = runId;
  if (authToken) env.WARDMOTE_API_KEY = authToken;
  // runtimeEnv is only used to resolve the command path and log HOME below;
  // the child env is built inside runChildProcess from
  // sanitizeInheritedWardmoteEnv(process.env) + env, so a WARDMOTE_API_KEY
  // on the server process never reaches the child.
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 15);

  if (onMeta) {
    await onMeta({
      adapterType: "process",
      command: resolvedCommand,
      cwd,
      commandArgs: args,
      env: loggedEnv,
    });
  }

  const instructions = parseObject(ctx.context.connectionInstructions);
  let instructionsDirectory: string | undefined;
  // Override configured/inherited paths even when the connection was removed.
  env.WARDMOTE_CONNECTION_INSTRUCTIONS_FILE = "";
  let proc: Awaited<ReturnType<typeof runChildProcess>>;
  try {
    if (typeof instructions.text === "string" && instructions.text) {
      instructionsDirectory = await mkdtemp(join(tmpdir(), "wardmote-connection-instructions-"));
      const instructionsFile = join(instructionsDirectory, "instructions.json");
      await writeFile(instructionsFile, JSON.stringify(instructions), { mode: 0o600 });
      env.WARDMOTE_CONNECTION_INSTRUCTIONS_FILE = instructionsFile;
    }
    proc = await runChildProcess(runId, command, args, {
      cwd, env, timeoutSec, graceSec, onLog, onSpawn: ctx.onSpawn,
    });
  } finally {
    if (instructionsDirectory) await rm(instructionsDirectory, { recursive: true, force: true });
  }

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
    };
  }

  if ((proc.exitCode ?? 0) !== 0) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: `Process exited with code ${proc.exitCode ?? -1}`,
      resultJson: {
        stdout: proc.stdout,
        stderr: proc.stderr,
      },
    };
  }

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
  };
}
