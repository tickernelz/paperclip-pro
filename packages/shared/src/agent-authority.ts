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
] as const;

export type AgentAuthorityCapability = (typeof AGENT_AUTHORITY_CAPABILITIES)[number];

export const AGENT_WORK_AUTHORITY_CAPABILITIES: readonly AgentAuthorityCapability[] = [
  "work:read",
  "work:issues",
  "work:routines",
];

export const AGENT_COMPANY_AUTHORITY_ROLES: readonly string[] = ["ceo"];

export const AGENT_AUTHORITY_REASONS = ["agent_role_ceo", "agent_work_authority"] as const;

export type AgentAuthorityReason = (typeof AGENT_AUTHORITY_REASONS)[number];

export const AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS: readonly string[] = [
  "users:invite",
  "joins:approve",
];

export function agentAuthorityCapabilities(
  role: string | null | undefined,
): readonly AgentAuthorityCapability[] {
  return AGENT_COMPANY_AUTHORITY_ROLES.includes((role ?? "").trim().toLowerCase())
    ? AGENT_AUTHORITY_CAPABILITIES
    : AGENT_WORK_AUTHORITY_CAPABILITIES;
}

export function agentAuthorityReason(role: string | null | undefined): AgentAuthorityReason {
  return AGENT_COMPANY_AUTHORITY_ROLES.includes((role ?? "").trim().toLowerCase())
    ? "agent_role_ceo"
    : "agent_work_authority";
}

export function agentRoleHasAuthority(
  role: string | null | undefined,
  capability: AgentAuthorityCapability,
): boolean {
  return agentAuthorityCapabilities(role).includes(capability);
}
