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

const PINNED_RETIRED_SCHEMA_ID_SUFFIXES: ReadonlySet<string> = new Set([ … ]);

export function retiredSchemaId(current: string): string { … }

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
export function rewriteRetiredNames(input: string, options: RetiredNameRewriteOptions = {}): RetiredNameRewrite { … }

/** Applies rewriteRetiredNames to every string leaf; object keys stay as stored. */
export function rewriteRetiredNamesInJson<T>(value: T, options: RetiredNameRewriteOptions = {}): { value: T; replacements: number } { … }

/** Retired-prefix keys an operator set in an adapter env block; they keep their names. */
export function operatorRetiredEnvKeys(adapterConfig: unknown): Set<string> { … }

[…70ln elided; re-read needed ranges, e.g. pp-zha5833-r10/packages/shared/src/retired-names.ts:27-54,56-59]
