import path from "node:path";
import type { AdapterExecutionTarget } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { writePaperclipMcpMount } from "@tickernelz/paperclip-pro-adapter-utils/paperclip-mcp-mount";
import type { RunToolProfile } from "@tickernelz/paperclip-pro-adapter-utils/tool-profile";

export const OMP_ASYNC_BASH_TIMEOUT_SEC = 3600;
export const OMP_TOOL_GUARD_FILE_NAME = "paperclip-tool-guard.js";

export interface OmpToolGuardExtension {
  path: string;
  cleanup: () => Promise<void>;
}

export const OMP_READ_ONLY_BLOCK_REASON =
  "This run uses the read_only tool profile, so this tool cannot change files, skills, memory or agents here. Do not retry or work around it; writes need the owner's approval, so request that approval instead.";

const READ_ONLY_GATE = `const READ_ONLY_REASON = ${JSON.stringify(OMP_READ_ONLY_BLOCK_REASON)};
const READ_ONLY_DENIED_TOOLS = new Set(["edit", "apply_patch", "ast_edit", "tts", "retain", "memory_edit", "learn", "manage_skill", "vibe_spawn", "vibe_send"]);
const LSP_READ_ACTIONS = new Set(["diagnostics", "definition", "type_definition", "implementation", "references", "hover", "symbols", "status", "capabilities", "reload"]);
const GITHUB_READ_OPS = new Set(["repo_view", "file_read", "search_issues", "search_prs", "search_code", "search_commits", "search_repos", "run_watch"]);

function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function writeTargetsDevice(input) {
  return lower(input && input.path).replace(/^\\[/, "").startsWith("xd://");
}

function lspMayWrite(input) {
  const action = lower(input && input.action);
  if (LSP_READ_ACTIONS.has(action)) return false;
  if (action === "code_actions") return input.apply === true;
  if (action === "rename" || action === "rename_file") return input.apply !== false;
  return true;
}

function taskRequestsIsolation(input) {
  if (input.isolated === true) return true;
  return Array.isArray(input.tasks) && input.tasks.some((item) => item && item.isolated === true);
}

export function readOnlyBlock(event) {
  const name = event.toolName;
  const input = event.input && typeof event.input === "object" ? event.input : {};
  let blocked = READ_ONLY_DENIED_TOOLS.has(name);
  if (name === "write") blocked = !writeTargetsDevice(input);
  else if (name === "lsp") blocked = lspMayWrite(input);
  else if (name === "github") blocked = !GITHUB_READ_OPS.has(lower(input.op));
  else if (name === "hub") blocked = lower(input.op) === "send";
  else if (name === "task") blocked = taskRequestsIsolation(input);
  return blocked ? { block: true, reason: READ_ONLY_REASON } : undefined;
}

`;

export function renderOmpToolGuardExtension(profile: RunToolProfile = "full"): string {
  const readOnly = profile === "read_only";
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

${readOnly ? READ_ONLY_GATE : ""}export default function paperclipToolGuard(pi) {
  pi.on("tool_call", (event) => {
${readOnly ? "    const blocked = readOnlyBlock(event);\n    if (blocked) return blocked;\n" : ""}    if (event.toolName !== "bash") return undefined;
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
  profile: RunToolProfile;
}): Promise<OmpToolGuardExtension> {
  const mount = await writePaperclipMcpMount({
    runId: input.runId,
    target: input.target,
    remote: input.remote,
    content: renderOmpToolGuardExtension(input.profile),
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
