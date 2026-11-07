function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function managedAiSessionIdentityCompatible(
  stored: unknown,
  sessionIdentity: string,
  credentialIdentity: string,
): boolean {
  // Legacy token identities can migrate only before any manual replacement.
  // Replacing even the same credential bytes increments the epoch.
  return stored === sessionIdentity || (sessionIdentity.endsWith(":0") && stored === credentialIdentity);
}

/** Exact alternative fingerprints, never a category-level exemption. The caller
 * has already authorized the selected account and prepared its credential. */
export function aiConnectionSessionCompatibilityInputs(input: {
  effectiveAdapterConfig: Record<string, unknown>;
  agentRuntimeConfig: unknown;
  agentConfigRevision: unknown;
  issueOverrides: unknown;
  storedIdentity: unknown;
  sessionIdentity: string;
  credentialIdentity: string;
}) {
  if (!managedAiSessionIdentityCompatible(input.storedIdentity, input.sessionIdentity, input.credentialIdentity)) return [];
  const configs = [input.effectiveAdapterConfig];
  if (input.storedIdentity === input.credentialIdentity && input.sessionIdentity.endsWith(":0")) {
    const managed = { ...record(input.effectiveAdapterConfig.managedAiConnection) };
    delete managed.sessionIdentity;
    managed.identity = input.credentialIdentity;
    configs.push({ ...input.effectiveAdapterConfig, managedAiConnection: managed });
  }
  const mode = record(input.effectiveAdapterConfig.managedAiConnection).mode;
  return configs.map(config => ({
    agentRuntimeConfig: input.agentRuntimeConfig,
    agentConfigRevision: input.agentConfigRevision,
    effectiveAdapterConfig: { ...config, managedAiConnection: { ...record(config.managedAiConnection), mode } },
    issueOverrides: input.issueOverrides,
  }));
}
