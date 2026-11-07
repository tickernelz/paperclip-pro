/** Creation policy shared by the picker and direct setup links. */
export function isNewAgentAdapterAllowed(
  type: string,
  {
    cloud,
    nativeRunnerEnabled,
    openAiDotEnabled = false,
    runnerProvider,
  }: { cloud: boolean; nativeRunnerEnabled: boolean; openAiDotEnabled?: boolean; runnerProvider?: string },
) {
  if (type === "openai_dot" || (type === "paperclip_runner" && runnerProvider === "openai_dot")) {
    return openAiDotEnabled;
  }
  if (type === "paperclip_runner") return nativeRunnerEnabled;
  if (cloud) return false;
  return true;
}
