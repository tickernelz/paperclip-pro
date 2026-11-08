import { retiredAdapterMessage } from "@tickernelz/wardmote-shared";
import type { ServerAdapterModule } from "./types.js";

const retiredAdapters = new WeakSet<ServerAdapterModule>();

export function isRetiredAdapterModule(adapter: ServerAdapterModule | null | undefined): boolean {
  return adapter != null && retiredAdapters.has(adapter);
}

export function createRetiredAdapter(type: string): ServerAdapterModule {
  const message = retiredAdapterMessage(type);
  const adapter: ServerAdapterModule = {
    type,
    runtimeToolDelivery: "environment",
    async execute(ctx) {
      await ctx.onLog("stderr", `${message}\n`);
      await ctx.onMeta?.({ adapterType: type, command: `${type}-retired`, commandNotes: [message] });
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: message,
        errorCode: "adapter_retired",
        summary: message,
      };
    },
    async testEnvironment() {
      return {
        adapterType: type,
        status: "fail",
        testedAt: new Date().toISOString(),
        checks: [{ code: "adapter_retired", level: "error", message, hint: "Set the agent adapter to omp_local." }],
      };
    },
    models: [],
    supportsLocalAgentJwt: false,
    supportsInstructionsBundle: false,
    requiresMaterializedRuntimeSkills: false,
    agentConfigurationDoc: `# ${type} retired\n\n${message}\n`,
    getConfigSchema: () => ({ fields: [] }),
  };
  retiredAdapters.add(adapter);
  return adapter;
}
