export {};

import type {
  AgentApiKeyScope,
  AgentAuthorityCapability,
  AgentAuthorityReason,
} from "@tickernelz/paperclip-pro-shared";

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "board" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        agentRole?: string | null;
        agentPermissions?: Record<string, unknown> | null;
        companyId?: string;
        exercisedAgentAuthority?: {
          capability: AgentAuthorityCapability;
          reason: AgentAuthorityReason;
          companyId: string;
        } | null;
        companyIds?: string[];
        sessionId?: string | null;
        memberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        onBehalfOfMemberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        isInstanceAdmin?: boolean;
        keyId?: string;
        keyScope?: AgentApiKeyScope;
        runId?: string;
        onBehalfOfUserId?: string | null;
        identityContextId?: string | null;
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "cloud_tenant" | "cloud_control" | "none";
      };
      agentAuthority?: {
        capability: AgentAuthorityCapability;
        reason: AgentAuthorityReason;
        companyId: string;
        agentId: string;
        runId: string | null;
      };
    }
  }
}
