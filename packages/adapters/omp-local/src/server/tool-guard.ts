import path from "node:path";
import type { AdapterExecutionTarget } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { writePaperclipMcpMount } from "@tickernelz/paperclip-pro-adapter-utils/paperclip-mcp-mount";

export const OMP_ASYNC_BASH_TIMEOUT_SEC = 3600;
export const OMP_TOOL_GUARD_FILE_NAME = "paperclip-tool-guard.js";

export interface OmpToolGuardExtension {
  path: string;
  cleanup: () => Promise<void>;
}

export function renderOmpToolGuardExtension(): string {
  return `const ASYNC_TIMEOUT_SEC = ${OMP_ASYNC_BASH_TIMEOUT_SEC};

function filled(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

function readyHasCondition(ready) {
  if (!ready || typeof ready !== "object") return false;
  return filled(ready.log) || filled(ready.host) || filled(ready.port) || filled(ready.timeout);
}

export function guardBashInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (typeof input.name === "string" && input.name.trim().length > 0) return null;
  const next = { ...input };
  let changed = false;
  if (next.async === true && next.timeout == null) {
    next.timeout = ASYNC_TIMEOUT_SEC;
    changed = true;
  }
  if ("ready" in next && !readyHasCondition(next.ready)) {
    delete next.ready;
    changed = true;
  }
  return changed ? next : null;
}

export default function paperclipToolGuard(pi) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return undefined;
    const input = guardBashInput(event.input);
    return input ? { input } : undefined;
  });
}
`;
}

export async function writeOmpToolGuardExtension(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  remote: boolean;
  env: Record<string, string>;
  remoteRootDir: string | null;
  cwd: string;
  timeoutSec: number;
  graceSec: number;
}): Promise<OmpToolGuardExtension> {
  const mount = await writePaperclipMcpMount({
    runId: input.runId,
    target: input.target,
    remote: input.remote,
    content: renderOmpToolGuardExtension(),
    fileName: OMP_TOOL_GUARD_FILE_NAME,
    localPrefix: "paperclip-omp-guard-",
    remoteDir: path.posix.join(
      input.remoteRootDir ?? path.posix.join(input.cwd, ".paperclip-runtime", "omp"),
      "tool-guard",
    ),
    cwd: input.cwd,
    env: input.env,
    timeoutSec: input.timeoutSec,
    graceSec: input.graceSec,
  });
  return { path: mount.filePath, cleanup: mount.cleanup };
}
