import { AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS } from "@tickernelz/paperclip-pro-shared";
import type { GeneratedToolSpec } from "./generated-tools.js";

export const AGENT_ADMITTING_GUARDS: Readonly<Record<string, true>> = {
  assertBoardCanManageAgentsForCompany: true,
  assertBoardOrAgent: true,
  assertBoardOrAgentAuthority: true,
  assertBoardOrgOrAgentAuthority: true,
  assertCanGenerateOpenClawInvitePrompt: true,
  assertCanReadConfigurations: true,
  assertCanResolveProposal: true,
  assertCompanyAccess: true,
  assertCompanyPermission: true,
  assertIssueThreadInteractionWithdrawalAllowed: true,
  assertIssueWriteInfluenceAllowed: true,
  assertPendingReviewInteractionVerdictAllowed: true,
  assertSameCompanyCeoAgentOrBoard: true,
  assertScopedApiAuth: true,
  assertSuggestedTaskEffectsAllowed: true,
  hasAgentAuthority: true,
  hasCompanyAccess: true,
  requirePluginConfigCompanyId: true,
};

export const BOARD_ONLY_GUARDS: Readonly<Record<string, true>> = {
  assertAgentAuditPermission: true,
  assertAiConnectionCreateAccess: true,
  assertBoard: true,
  assertBoardAnyToolPermission: true,
  assertBoardMutationAccess: true,
  assertBoardOrgAccess: true,
  assertBoardPermission: true,
  assertCanAccessInstanceEnvironments: true,
  assertCanManageCompanyMember: true,
  assertCanManageInstanceSettings: true,
  assertCanReadInstanceEnvironments: true,
  assertConnectionManager: true,
  assertEndpointAccess: true,
  assertEndpointManagementAccess: true,
  assertIdentityLinkAccess: true,
  assertImportTargetAccess: true,
  assertInstanceAdmin: true,
  assertLocalOperator: true,
  assertPluginBridgeScope: true,
  assertToolAppMutationAccess: true,
  assertToolConnectionAccess: true,
  assertToolConnectionConfigureAccess: true,
  assertToolsAdmin: true,
  assertToolsRuntimeManage: true,
  requireBoardUser: true,
  requireBoardUserId: true,
};

export const ACTOR_NEUTRAL_GUARDS: Readonly<Record<string, true>> = {
  assertAccessAdminVisible: true,
  assertAdapterCodeInstallAllowed: true,
  assertAdapterManagementVisible: true,
  assertAuthenticated: true,
  assertCanTestAsAgent: true,
  assertCompanyScopeReadAllowed: true,
  assertEnvironmentSelectionForCompany: true,
  assertLocalLoginAvailable: true,
  assertNoHiddenSettingChanges: true,
  assertPluginManagementVisible: true,
  assertQueueMutationTarget: true,
  assertRuntimeManageAllowed: true,
  getActorInfo: true,
  requireEnabled: true,
  requireImportTransferRun: true,
  requireLocalFolderDeclaration: true,
};

export function classifiedGuards(): string[] {
  return [
    ...Object.keys(AGENT_ADMITTING_GUARDS),
    ...Object.keys(BOARD_ONLY_GUARDS),
    ...Object.keys(ACTOR_NEUTRAL_GUARDS),
  ].sort();
}

export type BoardSurfaceContext = {
  capabilities: readonly string[];
  permissionKeys: ReadonlySet<string>;
};

const IMPLICIT_MEMBER_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS,
);

function permissionHeld(key: string, context: BoardSurfaceContext): boolean {
  if (context.permissionKeys.has(key)) return true;
  return IMPLICIT_MEMBER_PERMISSION_KEYS.has(key) && context.capabilities.includes("company:members");
}

export function boardToolAdvertised(
  spec: Pick<
    GeneratedToolSpec,
    "authority" | "authorityCapability" | "guards" | "permissions" | "boardGuard"
  >,
  context: BoardSurfaceContext,
): boolean {
  if (spec.authority !== "board") return true;
  if (spec.boardGuard !== null) return false;
  if (spec.guards.some((guard) => BOARD_ONLY_GUARDS[guard] === true)) return false;
  if (!spec.guards.some((guard) => AGENT_ADMITTING_GUARDS[guard] === true)) return false;
  if (spec.authorityCapability !== null && !context.capabilities.includes(spec.authorityCapability)) {
    return false;
  }
  return spec.permissions.every((key) => permissionHeld(key, context));
}
