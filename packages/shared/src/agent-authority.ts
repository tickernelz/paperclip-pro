export const AGENT_AUTHORITY_CAPABILITIES = [
  "work:read",
  "work:issues",
  "work:routines",
  "company:issue_control",
  "company:agents",
  "company:projects",
  "company:settings",
  "company:members",
  "company:approvals",
  "company:owner",
] as const;

export type AgentAuthorityCapability = (typeof AGENT_AUTHORITY_CAPABILITIES)[number];

export const AGENT_WORK_AUTHORITY_CAPABILITIES: readonly AgentAuthorityCapability[] = [
  "work:read",
  "work:issues",
  "work:routines",
];

export const AGENT_COMPANY_AUTHORITY_ROLES: readonly string[] = ["ceo"];

export const COMPANY_OWNER_AGENT_INACTIVE_STATUSES: readonly string[] = ["paused", "terminated", "pending_approval"];

export type CompanyOwnerAgentCandidate = {
  type?: string | null;
  agentId?: string | null;
  agentRole?: string | null;
  agentStatus?: string | null;
  keyScope?: { kind: string } | null;
};

export const AGENT_AUTHORITY_REASONS = ["agent_role_ceo", "agent_work_authority"] as const;

export type AgentAuthorityReason = (typeof AGENT_AUTHORITY_REASONS)[number];

export const AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS: readonly string[] = [
  "users:invite",
  "joins:approve",
];

export function agentAuthorityCapabilities(
  role: string | null | undefined,
): readonly AgentAuthorityCapability[] {
  return isCompanyOwnerAgentRole(role) ? AGENT_AUTHORITY_CAPABILITIES : AGENT_WORK_AUTHORITY_CAPABILITIES;
}

export function agentAuthorityReason(role: string | null | undefined): AgentAuthorityReason {
  return isCompanyOwnerAgentRole(role) ? "agent_role_ceo" : "agent_work_authority";
}

export function agentRoleHasAuthority(
  role: string | null | undefined,
  capability: AgentAuthorityCapability,
): boolean {
  return agentAuthorityCapabilities(role).includes(capability);
}

export function isCompanyOwnerAgentRole(role: string | null | undefined): boolean {
  return AGENT_COMPANY_AUTHORITY_ROLES.includes((role ?? "").trim().toLowerCase());
}

export function isCompanyOwnerAgent(actor: CompanyOwnerAgentCandidate | null | undefined): boolean {
  if (!actor || actor.type !== "agent" || !actor.agentId) return false;
  if (!isCompanyOwnerAgentRole(actor.agentRole)) return false;
  const status = (actor.agentStatus ?? "").trim();
  if (!status || COMPANY_OWNER_AGENT_INACTIVE_STATUSES.includes(status)) return false;
  return !actor.keyScope || actor.keyScope.kind === "standard";
}
