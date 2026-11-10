export type WardmoteRunnerProvider =
  "codex" | "opencode" | "claude_managed" | "aws_agentcore" | "acpx" | "openai_dot";

export type CodexPermissionMode = "never" | "on-request" | "untrusted";
export type OpenCodePermissionMode = "allow" | "ask" | "deny";
export type AcpxPermissionMode = "approve-all" | "approve-paperclip" | "approve-reads" | "deny-all";

export type WardmoteRunnerPermissionMode =
  CodexPermissionMode | OpenCodePermissionMode | AcpxPermissionMode;

export const WARDMOTE_RUNNER_IDLE_TIMEOUT_DEFAULT_MS = 300_000;
export const WARDMOTE_RUNNER_IDLE_TIMEOUT_MAX_MS = 86_400_000;
export const WARDMOTE_RUNNER_DEFAULT_MODELS = {
  codex: "gpt-5.6-sol",
  acpx: "claude-sonnet-5",
  opencode: "openrouter/deepseek/deepseek-v4-flash-0731",
} as const;

export interface WardmoteRunnerPermissionOption<
  TMode extends string = string,
> {
  value: TMode;
  label: string;
  description: string;
}

export type WardmoteRunnerPermissionCapability =
  | {
      configurable: true;
      configKey:
        "codexPermissionMode" | "opencodePermissionMode" | "acpxPermissionMode";
      defaultMode: WardmoteRunnerPermissionMode;
      options: readonly WardmoteRunnerPermissionOption<WardmoteRunnerPermissionMode>[];
      description: string;
    }
  | {
      configurable: false;
      defaultMode: "provider-managed";
      options: readonly [];
      description: string;
    };

/**
 * Control-plane catalog for Paperclip Runner permission UX and validation.
 * Runtime contracts validate the same native values again at the process
 * boundary; this catalog must remain browser-safe.
 */
export const WARDMOTE_RUNNER_PERMISSION_CAPABILITIES = {
  codex: {
    configurable: true,
    configKey: "codexPermissionMode",
    defaultMode: "never",
    // `never` disables provider approval pauses; it does not disable the
    // runner's independent security boundary. Native Codex may use this mode
    // only through the root-denied, workspace-scoped, network-disabled, and
    // environment-allowlisted profile assembled by codex-security-config.ts.
    description:
      "Codex runs automatically inside a root-denied, workspace-scoped, network-disabled Wardmote environment.",
    options: [
      {
        value: "never",
        label: "Automatic (isolated)",
        description:
          "Run without Codex approval pauses while Wardmote keeps its independent workspace, network, and environment restrictions.",
      },
    ],
  },
  opencode: {
    configurable: true,
    configKey: "opencodePermissionMode",
    defaultMode: "allow",
    description:
      "Controls OpenCode tool permissions inside the assigned Wardmote environment.",
    options: [
      {
        value: "allow",
        label: "Full auto (allow)",
        description: "Allow OpenCode operations without approval pauses.",
      },
      {
        value: "ask",
        label: "Ask for permission",
        description: "Prompt before protected OpenCode operations.",
      },
      {
        value: "deny",
        label: "Deny operations",
        description: "Reject protected OpenCode operations.",
      },
    ],
  },
  claude_managed: {
    configurable: false,
    defaultMode: "provider-managed",
    options: [],
    description:
      "Claude Managed runs non-interactively under its qualified provider profile and Wardmote policy.",
  },
  aws_agentcore: {
    configurable: false,
    defaultMode: "provider-managed",
    options: [],
    description:
      "AWS AgentCore runs non-interactively under its qualified harness profile and Wardmote policy.",
  },
  openai_dot: { configurable: false, defaultMode: "provider-managed", options: [], description: "Dot uses the admitted Wardmote tool catalog. OpenAI manages its model and other tools; provider usage and global interruption are unavailable." },
  acpx: {
    configurable: true,
    configKey: "acpxPermissionMode",
    defaultMode: "approve-all",
    description:
      "Controls ACPX agent operations inside the assigned Wardmote environment.",
    options: [
      {
        value: "approve-all",
        label: "Full auto (approve all)",
        description: "Approve ACPX operations without approval pauses.",
      },
      {
        value: "approve-paperclip",
        label: "Automatic Wardmote actions",
        description:
          "Automatically run assigned Wardmote planning and task tools, including reassignment. Company permissions and approval requirements still apply. Other operations require permission.",
      },
      {
        value: "approve-reads",
        label: "Allow Wardmote reads",
        description:
          "Automatically allow assigned Wardmote read tools. Other operations request a supported permission decision. Company permissions and execution boundaries still apply.",
      },
      {
        value: "deny-all",
        label: "Deny all",
        description: "Reject harness permission requests.",
      },
    ],
  },
} as const satisfies Record<
  WardmoteRunnerProvider,
  WardmoteRunnerPermissionCapability
>;

export function isWardmoteRunnerProvider(
  value: unknown,
): value is WardmoteRunnerProvider {
  return (
    value === "codex" ||
    value === "opencode" ||
    value === "claude_managed" ||
    value === "aws_agentcore" ||
    value === "acpx" || value === "openai_dot"
  );
}

export function resolveWardmoteRunnerPermissionMode(
  provider: WardmoteRunnerProvider,
  value: unknown,
): WardmoteRunnerPermissionMode | "provider-managed" {
  const capability = WARDMOTE_RUNNER_PERMISSION_CAPABILITIES[provider];
  if (!capability.configurable) return capability.defaultMode;
  return capability.options.some((option) => option.value === value)
    ? (value as WardmoteRunnerPermissionMode)
    : capability.defaultMode;
}

/** Native session behavior is independent of tool permission policy. */
export function resolveWardmoteRunnerCursorMode(
  provider: unknown,
  agent: unknown,
  value: unknown,
): "agent" | "plan" | "ask" | undefined {
  if (provider !== "acpx" || agent !== "cursor") {
    if (value !== undefined) throw new Error("acpxSessionMode is supported only for Cursor");
    return undefined;
  }
  if (value === undefined) return "agent";
  if (value === "agent" || value === "plan" || value === "ask") return value;
  throw new Error("Cursor session mode must be agent, plan, or ask");
}

export function resolveWardmoteRunnerModel(
  provider: keyof typeof WARDMOTE_RUNNER_DEFAULT_MODELS,
  value: unknown,
): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : WARDMOTE_RUNNER_DEFAULT_MODELS[provider];
}

export function resolveWardmoteRunnerIdleTimeoutMs(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= WARDMOTE_RUNNER_IDLE_TIMEOUT_MAX_MS
    ? value
    : WARDMOTE_RUNNER_IDLE_TIMEOUT_DEFAULT_MS;
}

/** Defaults for converting a local adapter; the operator may override the provider. */
export function paperclipRunnerTransitionConfig(
  previousAdapterType: string,
  previousModel: unknown,
  providerOverride?: unknown,
): Record<string, unknown> {
  const previousProvider =
    previousAdapterType === "claude_local"
      ? "acpx"
      : previousAdapterType === "opencode_local"
        ? "opencode"
        : "codex";
  const provider =
    providerOverride === "codex" ||
    providerOverride === "opencode" ||
    providerOverride === "acpx"
      ? providerOverride
      : previousProvider;
  return {
    provider,
    model: resolveWardmoteRunnerModel(
      provider,
      provider === previousProvider ? previousModel : undefined,
    ),
    ...(provider === "acpx" ? { acpxAgent: "claude" } : {}),
    [WARDMOTE_RUNNER_PERMISSION_CAPABILITIES[provider].configKey]:
      WARDMOTE_RUNNER_PERMISSION_CAPABILITIES[provider].defaultMode,
    lifecycleMode: "per_turn",
  };
}

/** Old ACPX Codex agent settings use native Codex on their next configuration write. */
export function normalizeLegacyRunnerProvider(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.provider !== "acpx" || config.acpxAgent !== "codex") return config;
  const {
    acpxAgent: _agent,
    acpxPermissionMode: _permission,
    ...rest
  } = config;
  return { ...rest, provider: "codex", codexPermissionMode: "never" };
}

/** Qualification is a release property, never an operator-configurable bypass. */
export const WARDMOTE_RUNNER_ACPX_PROFILES = Object.freeze([
  { value: "grok", label: "Grok Build", qualified: true, credentialEnvironment: ["XAI_API_KEY"] },
  { value: "claude", label: "Claude", qualified: true, credentialEnvironment: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] },
  { value: "cursor", label: "Cursor", qualified: true, credentialEnvironment: ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"] },
  { value: "copilot", label: "GitHub Copilot", qualified: false, credentialEnvironment: ["COPILOT_GITHUB_TOKEN"] },
  { value: "pi", label: "Pi", qualified: true, credentialEnvironment: ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] },
] as const);

/** Exact Pi native thinking levels; aliases that silently clamp are not configuration. */
export type WardmoteRunnerPiThinkingLevel = "off" | "low" | "high" | "max";
export function resolveWardmoteRunnerPiThinkingLevel(provider: unknown, agent: unknown, value: unknown): WardmoteRunnerPiThinkingLevel | undefined {
  if (provider !== "acpx" || agent !== "pi") {
    if (value !== undefined) throw new Error("piThinkingLevel is supported only for Pi");
    return undefined;
  }
  if (value === undefined) return "low";
  if (value === "off" || value === "low" || value === "high" || value === "max") return value;
  throw new Error("Pi thinking level must be off, low, high, or max");
}
