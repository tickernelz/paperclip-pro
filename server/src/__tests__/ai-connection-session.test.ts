import { describe, expect, it } from "vitest";
import { aiConnectionSessionCompatibilityInputs, managedAiSessionIdentityCompatible } from "../services/ai-connection-session.js";
import { buildEffectiveRunSessionConfigMetadata, resolveTaskSessionConfigFreshness } from "../services/heartbeat.js";

const binding = { mode: "shared" as const, provider: "openai" as const, method: "subscription" as const, connectionId: "account", grantId: "grant" };
const sessionIdentity = "grant:alice:0", credentialIdentity = "grant:alice:token";
const config = { provider: "codex", model: "gpt-5.6-sol", env: { OPENAI_API_KEY: "fixture-token" }, managedAiConnection: { ...binding, identity: credentialIdentity, sessionIdentity } };
const base = { adapterType: "paperclip_runner", effectiveAdapterConfig: config, agentRuntimeConfig: { aiConnection: binding }, agentConfigRevision: null as unknown, issueOverrides: null as unknown, workspaceConfig: {}, environment: {}, environmentEnv: null, projectEnv: null, routineEnv: null, runtimeSkills: [] };
type MetadataInput = Parameters<typeof buildEffectiveRunSessionConfigMetadata>[0];
type CompatibilityInput = Parameters<typeof aiConnectionSessionCompatibilityInputs>[0];
async function decision(previous: Partial<MetadataInput>, next: Partial<MetadataInput> = {}, compatibility: Partial<CompatibilityInput> = {}, wakeResetReason?: string) {
  const before = await buildEffectiveRunSessionConfigMetadata({ ...base, ...previous });
  const afterInput = { ...base, ...next };
  const after = await buildEffectiveRunSessionConfigMetadata(afterInput);
  const candidates = aiConnectionSessionCompatibilityInputs({ ...afterInput, storedIdentity: sessionIdentity, sessionIdentity, credentialIdentity, ...compatibility });
  const alternatives = await Promise.all(candidates.map(candidate => buildEffectiveRunSessionConfigMetadata({ ...afterInput, ...candidate })));
  return resolveTaskSessionConfigFreshness({ hasTaskSession: true, configuredModel: String(afterInput.effectiveAdapterConfig.model), taskSessionParams: { __paperclipConfiguredModel: "gpt-5.6-sol", __paperclipConfigFingerprint: before.fingerprint, __paperclipConfigFingerprintVersion: before.version, __paperclipConfigCategoryFingerprints: before.categoryFingerprints }, configMetadata: after, compatibleConfigMetadata: alternatives, wakeResetReason });
}

describe("managed AI session compatibility", () => {
  it.each([
    { effectiveAdapterConfig: { ...config, model: "gpt-5.6-terra" } },
    { effectiveAdapterConfig: { ...config, provider: "acpx", acpxAgent: "codex" } },
    { effectiveAdapterConfig: { ...config, env: { ...config.env, OTHER: "changed" } } },
    { agentRuntimeConfig: { aiConnection: binding, heartbeat: { maxConcurrentRuns: 2 } } },
    { workspaceConfig: { effectiveMode: "isolated_workspace" } },
  ])("preserves normal resets for effective settings changes: %j", async next => {
    expect((await decision({ agentRuntimeConfig: { aiConnection: binding } }, next)).reset).toBe(true);
  });
  it("preserves an explicit session reset even when a compatibility fingerprint matches", async () => {
    expect((await decision({ agentRuntimeConfig: { aiConnection: binding } }, {}, {}, "explicit session reset")).reset).toBe(true);
  });
  it("migrates a legacy token fingerprint only for the unchanged credential at epoch zero", async () => {
    const managed = { ...config.managedAiConnection } as Record<string, unknown>; delete managed.sessionIdentity;
    expect((await decision({ agentRuntimeConfig: { aiConnection: binding }, effectiveAdapterConfig: { ...config, managedAiConnection: managed } }, {}, { storedIdentity: credentialIdentity })).reset).toBe(false);
  });
  it("does not treat a changed token or a manual replacement of the same bytes as legacy-compatible", () => {
    expect(managedAiSessionIdentityCompatible("grant:alice:old-token", sessionIdentity, credentialIdentity)).toBe(false);
    expect(managedAiSessionIdentityCompatible(credentialIdentity, "grant:alice:1", credentialIdentity)).toBe(false);
    expect(managedAiSessionIdentityCompatible(sessionIdentity, "grant:alice:1", credentialIdentity)).toBe(false);
    expect(managedAiSessionIdentityCompatible(sessionIdentity, sessionIdentity, "grant:alice:refreshed-token")).toBe(true);
  });
  it("rejects compatibility candidates for a different account or responsible user", () => {
    const input = { ...base, sessionIdentity, credentialIdentity };
    expect(aiConnectionSessionCompatibilityInputs({ ...input, storedIdentity: "other-grant:alice:0" })).toEqual([]);
    expect(aiConnectionSessionCompatibilityInputs({ ...input, storedIdentity: "grant:bob:0" })).toEqual([]);
  });
});
