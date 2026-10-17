import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_ROLES, AGENT_ROLE_LABELS, type Agent, type AgentRole } from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";

export const CEO_ROLE: AgentRole = "ceo";

export const CEO_ACCESS_WARNING =
  "CEO agents get owner-level access to everything in this company, including other agents' instructions, secrets and settings.";

export const ROLE_CHANGE_CONCURRENCY = 4;

export const AGENT_ROLE_OPTIONS = AGENT_ROLES.map((role) => ({ value: role, label: AGENT_ROLE_LABELS[role] }));

export type AgentRoleTarget = Pick<Agent, "id" | "name" | "role" | "companyId"> & { urlKey?: string | null };

export type AgentRoleChangeResult =
  | { agentId: string; name: string; ok: true; role: AgentRole }
  | { agentId: string; name: string; ok: false; message: string };

export function agentRoleLabel(role: string): string {
  return (AGENT_ROLE_LABELS as Record<string, string>)[role] ?? role;
}

export function roleChangeTouchesCeo(currentRoles: readonly string[], nextRole: string): boolean {
  return nextRole === CEO_ROLE || currentRoles.includes(CEO_ROLE);
}

export function roleChangeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { code?: unknown; details?: { code?: unknown } | null } | null;
    const code =
      typeof body?.details?.code === "string"
        ? body.details.code
        : typeof body?.code === "string"
          ? body.code
          : null;
    return code && !error.message.includes(code) ? `${error.message} (${code})` : error.message;
  }
  return error instanceof Error && error.message ? error.message : "The role was not changed.";
}

async function mapBounded<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function useAgentRoleChange(companyId: string | null) {
  const queryClient = useQueryClient();

  const updateOne = useCallback(
    async (agent: AgentRoleTarget, role: AgentRole): Promise<AgentRoleChangeResult> => {
      const scope = companyId ?? agent.companyId;
      try {
        const updated = await agentsApi.update(agent.id, { role }, scope);
        const savedRole = updated?.role ?? role;
        queryClient.setQueryData<Agent[]>(queryKeys.agents.list(scope), (current) =>
          current?.map((entry) => (entry.id === agent.id ? { ...entry, role: savedRole } : entry)),
        );
        return { agentId: agent.id, name: agent.name, ok: true, role: savedRole };
      } catch (error) {
        return { agentId: agent.id, name: agent.name, ok: false, message: roleChangeErrorMessage(error) };
      }
    },
    [companyId, queryClient],
  );

  const changeRoles = useCallback(
    async (agents: readonly AgentRoleTarget[], role: AgentRole): Promise<AgentRoleChangeResult[]> => {
      const results = await mapBounded(agents, ROLE_CHANGE_CONCURRENCY, (agent) => updateOne(agent, role));
      const scopes = new Set(agents.map((agent) => companyId ?? agent.companyId));
      for (const scope of scopes) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(scope) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.org(scope) });
      }
      for (const agent of agents) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
        if (agent.urlKey) void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.urlKey) });
      }
      return results;
    },
    [companyId, queryClient, updateOne],
  );

  const changeRole = useCallback(
    async (agent: AgentRoleTarget, role: AgentRole): Promise<AgentRoleChangeResult> => (await changeRoles([agent], role))[0]!,
    [changeRoles],
  );

  return { changeRole, changeRoles };
}
