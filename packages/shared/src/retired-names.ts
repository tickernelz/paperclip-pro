export const RETIRED_IRREGULAR_TOOL_RENAMES: Readonly<Record<string, string>> = {
  paperclipCancelChatEndpointApproval: "wardmoteCancelChatEndpointOpenwaApproval",
  paperclipCreateIssueDecomposition: "wardmoteCreateIssueAcceptedDecomposition",
  paperclipCreateIssueExternalSummary: "wardmoteCreateIssueExternalObjectSummary",
  paperclipCreateToolAppFinalizeAccess: "wardmoteCreateToolAppFinalizeOauthAccess",
  paperclipCreateToolInstallation: "wardmoteCreateToolConnectionInstallation",
  paperclipGetEnvironmentCustomSession: "wardmoteGetEnvironmentCustomImageSession",
  paperclipListBrowserUseCloudProfiles: "wardmoteListBrowserUseCloudGrantProfiles",
  paperclipListBrowserUseCloudSettings: "wardmoteListBrowserUseCloudGrantSettings",
  paperclipListCaseDocumentRevisionsByKey: "wardmoteListCaseDocumentRevisionsByIdKey",
  paperclipListConnectionIntentOptions: "wardmoteListConnectionIntentSetupOptions",
  paperclipListEnvironmentDeleteRadius: "wardmoteListEnvironmentDeleteBlastRadius",
  paperclipListExecutionOperations: "wardmoteListExecutionWorkspaceOperations",
  paperclipListToolConnectionApps: "wardmoteListToolConnectionAggregatorApps",
  paperclipRefreshToolApp: "wardmoteRefreshToolConnectionComposioApp",
  paperclipStartToolConnection: "wardmoteStartAuthorizationToolConnection",
  paperclipUpdatePipelineStageEnv: "wardmoteUpdatePipelineStageAutomationEnv",
  paperclipValidatePluginCompanyFolder: "wardmoteValidatePluginCompanyLocalFolder",
};

const IRREGULAR_LOWER = new Map(
  Object.entries(RETIRED_IRREGULAR_TOOL_RENAMES).map(([before, after]) => [before.toLowerCase(), after.toLowerCase()]),
);

const PINNED_RETIRED_ENV_SUFFIXES: ReadonlySet<string> = new Set([
  "ACPX_ISOLATED_CONTEXT",
  "PI_AGENT_HOME",
  "PI_ENTRYPOINT",
  "PI_EXTENSION_PATH",
  "PI_MODULE_GUARD_PATH",
  "PI_NODE_EXECUTABLE",
  "PI_PROTECTED_ROOTS",
  "PI_READ_ONLY",
  "PI_READ_ROOTS",
  "PI_RUNTIME_CONFIGURATION",
  "PI_SYSTEM_INSTRUCTIONS",
]);

export type RetiredNameRewriteOptions = {
  keepEnvKeys?: ReadonlySet<string>;
};

export type RetiredNameRewrite = { text: string; replacements: number };

function renameTool(name: string): string {
  return RETIRED_IRREGULAR_TOOL_RENAMES[name] ?? `wardmote${name.slice("paperclip".length)}`;
}

function renameLowerTool(name: string): string {
  return IRREGULAR_LOWER.get(name) ?? `wardmote${name.slice("paperclip".length)}`;
}

/** Rewrites retired env, MCP tool, header, route and bundled-skill names in agent-facing text. */
export function rewriteRetiredNames(input: string, options: RetiredNameRewriteOptions = {}): RetiredNameRewrite {
  let replacements = 0;
  const count = (next: string) => {
    replacements += 1;
    return next;
  };
  const text = input
    .replace(/mcp__paperclip(-assigned)?(__|_)(paperclip[a-z0-9]*)?/g, (_whole, assigned: string | undefined, separator: string, tool: string | undefined) =>
      count(`mcp__wardmote${assigned ?? ""}${separator}${tool ? renameLowerTool(tool) : ""}`))
    .replace(/\bpaperclip[A-Z][A-Za-z0-9]*\b/g, (name) => count(renameTool(name)))
    .replace(/\bPAPERCLIP_[A-Z0-9_]+\b/g, (name) => {
      const suffix = name.slice("PAPERCLIP_".length);
      return options.keepEnvKeys?.has(name) || PINNED_RETIRED_ENV_SUFFIXES.has(suffix) ? name : count(`WARDMOTE_${suffix}`);
    })
    .replace(/\b(X|x)-(Paperclip|paperclip|PAPERCLIP)-/g, (_whole, x: string, word: string) =>
      count(`${x}-${word === "Paperclip" ? "Wardmote" : word === "paperclip" ? "wardmote" : "WARDMOTE"}-`))
    .replace(/\/(mcp|api\/skills)\/paperclip(?![\w-])/g, (_whole, base: string) => count(`/${base}/wardmote`))
    .replace(/(skill:\/\/|(?<![\w.-])skills\/)paperclip(-board|-converting-plans-to-tasks|-create-agent)?(?![\w-])/g,
      (_whole, prefix: string, suffix: string | undefined) => count(`${prefix}wardmote${suffix ?? ""}`))
    .replace(/(?<![\w/.-])paperclip(-board|-converting-plans-to-tasks|-create-agent)(?![\w-])/g,
      (_whole, suffix: string) => count(`wardmote${suffix}`))
    .replace(/(?<![\w-])paperclip-(upload-artifact|issue-update)(?=\.sh\b)/g, (_whole, script: string) => count(`wardmote-${script}`));
  return { text, replacements };
}

/** Applies rewriteRetiredNames to every string leaf; object keys stay as stored. */
export function rewriteRetiredNamesInJson<T>(value: T, options: RetiredNameRewriteOptions = {}): { value: T; replacements: number } {
  let replacements = 0;
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      const result = rewriteRetiredNames(node, options);
      replacements += result.replacements;
      return result.text;
    }
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, child]) => [key, visit(child)]));
    }
    return node;
  };
  const next = visit(value) as T;
  return { value: next, replacements };
}

/** Retired-prefix keys an operator set in an adapter env block; they keep their names. */
export function operatorRetiredEnvKeys(adapterConfig: unknown): Set<string> {
  const env = adapterConfig && typeof adapterConfig === "object" ? (adapterConfig as Record<string, unknown>).env : null;
  if (!env || typeof env !== "object" || Array.isArray(env)) return new Set();
  return new Set(Object.keys(env).filter((key) => key.startsWith("PAPERCLIP_")));
}
