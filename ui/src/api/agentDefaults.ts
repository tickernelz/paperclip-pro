import type { AgentSettingsValues, OmpSettingsCatalogEntry } from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export interface AgentDefaultsSaveResult {
  values: AgentSettingsValues;
  changedPaths: string[];
  following: number;
  ownValues: number;
  sessionKept: boolean;
}

export interface PresetUsageRow {
  preset: string;
  runs: number;
  costCents: number;
  avgDurationSec: number | null;
}

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`;

export const agentDefaultsApi = {
  get: (companyId: string) => api.get<{ values: AgentSettingsValues }>(`${base(companyId)}/agent-defaults`),
  save: (companyId: string, values: AgentSettingsValues) =>
    api.put<AgentDefaultsSaveResult>(`${base(companyId)}/agent-defaults`, { values }),
  presetUsage: (companyId: string) =>
    api.get<{ days: number; rows: PresetUsageRow[] }>(`${base(companyId)}/agent-defaults/preset-usage`),
  ompSettings: (companyId: string) =>
    api.get<{ settings: OmpSettingsCatalogEntry[] }>(`${base(companyId)}/omp/settings`),
};
