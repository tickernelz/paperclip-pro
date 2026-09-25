import type { Request } from "express";
import { AGENT_COMPANY_AUTHORITY_ROLES } from "@tickernelz/paperclip-pro-shared";
import { forbidden } from "../errors.js";
import { normalizeAgentPermissions } from "./agent-permissions.js";

const AUTHORITY_PERMISSION_KEYS = ["canCreateAgents", "canCreateSkills"] as const;

export type AgentAuthorityWrite = {
  role?: unknown;
  permissions?: unknown;
  reportsTo?: unknown;
};

export type AgentAuthorityWriteTarget = {
  id: string;
  role: string | null;
  permissions?: unknown;
} | null;

function isCompanyAuthorityRole(role: unknown): boolean {
  return typeof role === "string"
    && AGENT_COMPANY_AUTHORITY_ROLES.includes(role.trim().toLowerCase());
}

function hasOwnKey(write: AgentAuthorityWrite, key: keyof AgentAuthorityWrite) {
  return Object.prototype.hasOwnProperty.call(write, key) && write[key] !== undefined;
}

export function assertNoAgentAuthorityEscalation(input: {
  req: Request;
  write: AgentAuthorityWrite;
  target: AgentAuthorityWriteTarget;
}) {
  const { req, write, target } = input;
  if (req.actor.type !== "agent") return;
  const actorAgentId = req.actor.agentId ?? null;
  if (!actorAgentId) {
    throw forbidden("Agent authentication required");
  }

  const touchesRole = hasOwnKey(write, "role");
  const touchesPermissions = hasOwnKey(write, "permissions");
  const touchesReportsTo = hasOwnKey(write, "reportsTo");
  if (!touchesRole && !touchesPermissions && !touchesReportsTo) return;

  if (target && target.id === actorAgentId) {
    throw forbidden("Agents cannot change their own role, permissions, or reporting chain", {
      code: "AGENT_SELF_ESCALATION_DENIED",
    });
  }

  const actorIsCompanyAuthority = isCompanyAuthorityRole(req.actor.agentRole ?? null);

  if (touchesRole) {
    const nextRoleIsAuthority = isCompanyAuthorityRole(write.role);
    const currentRoleIsAuthority = isCompanyAuthorityRole(target?.role ?? null);
    if ((nextRoleIsAuthority || currentRoleIsAuthority) && !actorIsCompanyAuthority) {
      throw forbidden(
        "Only a board user or a CEO agent may set or remove the ceo agent role",
        { code: "AGENT_ROLE_ESCALATION_DENIED" },
      );
    }
  }

  if (touchesReportsTo && !actorIsCompanyAuthority) {
    throw forbidden("Only a board user or a CEO agent may change an agent's reporting chain", {
      code: "AGENT_REPORTING_ESCALATION_DENIED",
    });
  }

  if (!touchesPermissions) return;

  const requested = normalizeAgentPermissions(write.permissions, { context: "create" });
  if (actorIsCompanyAuthority) return;
  const actorPermissions = normalizeAgentPermissions(req.actor.agentPermissions, {
    context: "stored",
  });
  for (const key of AUTHORITY_PERMISSION_KEYS) {
    if (requested[key] === true && actorPermissions[key] !== true) {
      throw forbidden(
        `Agents cannot grant ${key} they do not hold themselves`,
        { code: "AGENT_PERMISSION_ESCALATION_DENIED" },
      );
    }
  }
}
