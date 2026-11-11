import type { AiConnectionList, AiConnectionUsage, CreateAiConnection, AiConnectionLoginIntent } from "@tickernelz/wardmote-shared";
import { api } from "./client";
export const aiConnectionsApi = {
  probeUsage: (companyId: string, connectionId: string, grantId?: string) => api.get<AiConnectionUsage>(`/companies/${companyId}/ai-connections/${connectionId}/usage${grantId ? `?grantId=${encodeURIComponent(grantId)}` : ""}`),
  activeRuns: (companyId: string, connectionId: string) => api.get<Array<{ id: string; agentId: string; agentName: string; status: string }>>(`/companies/${companyId}/ai-connections/${connectionId}/active-runs`),
  list: (companyId: string, agentId?: string) => api.get<AiConnectionList>(`/companies/${companyId}/ai-connections${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`),
  create: (companyId: string, input: CreateAiConnection) => api.post<{ connectionId: string; grantId: string }>(`/companies/${companyId}/ai-connections`, input),
  setDefault: (companyId: string, grantId: string) => api.put(`/companies/${companyId}/ai-connections/default`, { grantId }),
  loginResult: (companyId: string, sessionId: string) => api.get<{ connectionId: string; grantId: string }>(`/companies/${companyId}/ai-connections/login/${encodeURIComponent(sessionId)}`),
};
