import { describe, expect, it, vi } from "vitest";
import { AGENT_ADAPTER_TYPES } from "@paperclipai/shared";
import { adapterSupportsRemoteManagedEnvironments } from "@paperclipai/shared/environment-support";
import { getAdapterSessionManagement } from "@paperclipai/adapter-utils";
import { isConversationAdapter } from "../services/conversation-continuation.js";
import { BUILTIN_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import { listServerAdapters, requireServerAdapter } from "./registry.js";

const { probeInstallation } = vi.hoisted(() => ({ probeInstallation: vi.fn() }));
vi.mock("@paperclipai/paperclip-runner/live", () => ({ probeAcpxClaudeInstallation: probeInstallation }));

vi.mock("./plugin-loader.js", () => ({
  buildExternalAdapters: vi.fn(async () => []),
  loadExternalAdapterPackage: vi.fn(async () => null),
  reloadExternalAdapter: vi.fn(async () => null),
  getUiParserSource: vi.fn(async () => null),
  getOrExtractUiParserSource: vi.fn(async () => null),
}));

describe("omp_local builtin adapter registration", () => {
  it("is a recognised builtin adapter type", () => {
    expect(BUILTIN_ADAPTER_TYPES.has("omp_local")).toBe(true);
    expect([...AGENT_ADAPTER_TYPES]).toContain("omp_local");
  });

  it("resolves from the server registry with the local-agent contract", () => {
    const adapter = requireServerAdapter("omp_local");
    expect(adapter.type).toBe("omp_local");
    expect(typeof adapter.execute).toBe("function");
    expect(typeof adapter.testEnvironment).toBe("function");
    expect(typeof adapter.listModels).toBe("function");
    expect(typeof adapter.getConfigSchema).toBe("function");
    expect(adapter.runtimeToolDelivery).toBe("environment");
    expect(adapter.supportsLocalAgentJwt).toBe(true);
    expect(adapter.supportsInstructionsBundle).toBe(true);
    expect(adapter.instructionsPathKey).toBe("instructionsFilePath");
    expect(adapter.sessionCodec).toBeDefined();
    expect(adapter.sessionManagement?.supportsSessionResume).toBe(true);
    expect(listServerAdapters().map((entry) => entry.type)).toContain("omp_local");
  });

  it("keeps the declared runtime-skill contract distinct from the materialising adapters", () => {
    expect(requireServerAdapter("omp_local").requiresMaterializedRuntimeSkills).toBe(false);
  });

  it("participates in conversation continuation, remote environments and adapter-managed compaction", () => {
    expect(isConversationAdapter("omp_local")).toBe(true);
    expect(adapterSupportsRemoteManagedEnvironments("omp_local")).toBe(true);
    const management = getAdapterSessionManagement("omp_local");
    expect(management?.nativeContextManagement).toBe("confirmed");
    expect(management?.defaultSessionCompaction).toEqual({
      enabled: true,
      maxSessionRuns: 0,
      maxRawInputTokens: 0,
      maxSessionAgeHours: 0,
    });
  });
});
