export type RunToolProfile = "full" | "read_only";

export type ReadOnlyToolProfileSupport = "enforced" | "instruction_only";

export const RUN_TOOL_PROFILE_CONTEXT_KEY = "paperclipToolProfile";

export function runToolProfile(context: Record<string, unknown> | null | undefined): RunToolProfile {
  return context?.[RUN_TOOL_PROFILE_CONTEXT_KEY] === "read_only" ? "read_only" : "full";
}
