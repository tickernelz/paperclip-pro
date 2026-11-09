/** Names minted by the controller from the resolved task configuration.
 * Values remain in the process environment, never in argv or this manifest.
 * Do not mint this projection from ambient process.env.
 */
export const CONFIGURED_ENVIRONMENT_KEYS = "WARDMOTE_CONFIGURED_ENV_KEYS";

export const GENERATED_RUNTIME_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set([
  CONFIGURED_ENVIRONMENT_KEYS,
  "WARDMOTE_AGENT_ID", "WARDMOTE_AGENT_KEY_ID", "WARDMOTE_AGENT_PUBLIC_KEY", "WARDMOTE_AGENT_PRIVATE_KEY",
  "WARDMOTE_API_KEY", "WARDMOTE_API_URL", "WARDMOTE_API_BRIDGE_MODE", "WARDMOTE_COMPANY_ID", "WARDMOTE_INSTANCE_ID",
  "WARDMOTE_RUN_ID", "WARDMOTE_NORMALIZED_SESSION_ID", "WARDMOTE_RUNNER_INSTANCE_ID", "WARDMOTE_RUNNER_BOOTSTRAP_TICKET", "WARDMOTE_TASK_ID", "WARDMOTE_APPROVAL_ID", "WARDMOTE_APPROVAL_STATUS", "WARDMOTE_LINKED_ISSUE_IDS",
  "WARDMOTE_WAKE_REASON", "WARDMOTE_WAKE_COMMENT_ID", "WARDMOTE_WAKE_PAYLOAD_JSON", "WARDMOTE_EXECUTION_MODE",
  "WARDMOTE_WORKSPACES_JSON", "WARDMOTE_WORKSPACE_ID", "WARDMOTE_WORKSPACE_CWD", "WARDMOTE_WORKSPACE_SOURCE",
  "WARDMOTE_WORKSPACE_REPO_URL", "WARDMOTE_WORKSPACE_REPO_REF", "WARDMOTE_WORKSPACE_BRANCH",
  "WARDMOTE_WORKSPACE_WORKTREE_PATH", "WARDMOTE_WORKSPACE_REALIZATION_MODE", "WARDMOTE_WORKSPACE_AUTHORITATIVE_ROOT",
  "WARDMOTE_RUNTIME_PRIMARY_URL", "WARDMOTE_RUNTIME_SERVICES_JSON", "WARDMOTE_RUNTIME_SERVICE_INTENTS_JSON",
  "WARDMOTE_AGENT_MESSAGE_KEY", "WARDMOTE_HARNESS_CHECKOUT_KEY", "WARDMOTE_EXTERNAL_CHAT_EXECUTION_BOUND_KEY",
  "WARDMOTE_NATIVE_MCP_NAME", "WARDMOTE_NATIVE_MCP_URL", "WARDMOTE_NATIVE_MCP_TOKEN", "WARDMOTE_AI_PROVIDER_KEY",
  "WARDMOTE_PROVIDER_TRACE_PATH", "WARDMOTE_PROVIDER_TRACE_MAX_BYTES", "WARDMOTE_ACPX_CREDENTIAL_BINDING",
  "WARDMOTE_RUNNER_NETWORK_ACCESS", "WARDMOTE_RUNNER_NETWORK_ROOTS", "WARDMOTE_RUNNER_EXTERNAL_SANDBOX",
  "WARDMOTE_GITHUB_AUTH_MODE", "WARDMOTE_GITHUB_HOST_HOME", "WARDMOTE_GIT_METADATA_ROOTS",
  "WARDMOTE_GITHUB_BROKER_TOKEN", "WARDMOTE_GITHUB_BROKER_URL", "WARDMOTE_GITHUB_BRIDGE_TOKEN", "WARDMOTE_GITHUB_LAUNCHER_DIR",
]);

const RESERVED_KEYS = new Set([
  "PATH", "HOME", "USERPROFILE", "CODEX_HOME", "AGENT_HOME", "SHELL", "NODE_OPTIONS", "NODE_PATH",
  "PYTHONPATH", "PYTHONHOME", "RUBYOPT", "RUBYLIB", "PERL5OPT", "PERL5LIB", "BASH_ENV", "ENV",
  "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK", "OPENROUTER_API_KEY", "XAI_API_KEY", "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN",
  "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "WARDMOTE_GIT_TOKEN",
]);

function eligibleKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
    && !GENERATED_RUNTIME_ENVIRONMENT_KEYS.has(upper)
    && !RESERVED_KEYS.has(upper)
    && !/^(?:LD_|DYLD_|GIT_CONFIG_|WARDMOTE_(?:RUNNER_|NATIVE_|GITHUB_|ACPX_|VERIFIED_))/.test(upper);
}

function checkedNames(names: unknown): string[] {
  if (!Array.isArray(names) || names.length > 128 || names.some(name => typeof name !== "string" || !eligibleKey(name))
    || new Set(names).size !== names.length) throw new Error("Invalid configured environment projection");
  return (names as string[]).sort();
}

/** Mint at the server's resolved configuration boundary, before host inheritance. */
export function configuredEnvironmentProjection(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = checkedNames(Object.keys(source).filter(key => source[key] !== undefined && eligibleKey(key)));
  return configuredEnvironment({ ...source, [CONFIGURED_ENVIRONMENT_KEYS]: JSON.stringify(names) });
}

/** Accept only an explicitly supplied, controller-minted projection. */
export function configuredEnvironment(source: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const raw = source?.[CONFIGURED_ENVIRONMENT_KEYS];
  if (raw === undefined) return {};
  if (Buffer.byteLength(raw) > 20_000) throw new Error("Invalid configured environment projection");
  let names: string[];
  try { names = checkedNames(JSON.parse(raw)); } catch { throw new Error("Invalid configured environment projection"); }
  const result: NodeJS.ProcessEnv = {};
  let bytes = 0;
  for (const name of names) {
    const value = source?.[name];
    if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid configured environment value");
    const size = Buffer.byteLength(name) + Buffer.byteLength(value);
    bytes += size;
    if (size > 65_536 || bytes > 262_144) throw new Error("Configured environment exceeds its bounded launch size");
    result[name] = value;
  }
  result[CONFIGURED_ENVIRONMENT_KEYS] = JSON.stringify(names);
  return result;
}

export function configuredEnvironmentKeys(source: NodeJS.ProcessEnv | undefined): string[] {
  return Object.keys(configuredEnvironment(source)).filter(key => key !== CONFIGURED_ENVIRONMENT_KEYS).sort();
}
