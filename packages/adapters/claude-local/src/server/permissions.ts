import type { RunToolProfile } from "@tickernelz/paperclip-pro-adapter-utils/tool-profile";

export const CLAUDE_READ_ONLY_DISALLOWED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"] as const;

interface ClaudePermissionInput {
  dangerouslySkipPermissions: boolean;
  targetIsRemote: boolean;
  localProcessUid?: number | null;
}

// Permission defaults are identical for local, remote, and connected tools.
// A tool allowlist is not equivalent to full bypass: it misses MCP tools and
// tools added by later provider releases. Let Claude enforce its own launch
// requirements rather than silently downgrading the requested permission mode.
export function buildClaudeExecutionPermissionArgs(input: ClaudePermissionInput): string[] {
  return input.dangerouslySkipPermissions ? ["--dangerously-skip-permissions"] : [];
}

export const buildClaudeProbePermissionArgs = buildClaudeExecutionPermissionArgs;

export function buildClaudeToolProfileArgs(profile: RunToolProfile): string[] {
  return profile === "read_only" ? ["--disallowedTools", CLAUDE_READ_ONLY_DISALLOWED_TOOLS.join(",")] : [];
}

/** Claude permits full bypass as root only inside an identified sandbox. */
export function claudeSandboxPermissionEnv(input: {
  dangerouslySkipPermissions: boolean;
  targetIsSandbox: boolean;
}): Record<string, string> {
  return input.dangerouslySkipPermissions && input.targetIsSandbox ? { IS_SANDBOX: "1" } : {};
}
