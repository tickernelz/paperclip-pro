import { useQuery } from "@tanstack/react-query";
import {
  OMP_CONTROL_PATHS,
  OMP_LIMIT_CHOICES,
  OMP_SETTINGS_KEY,
  OMP_SETTINGS_PATH_PREFIX,
  OMP_STYLE_PRESETS,
  OMP_THINKING_CHOICES,
  OMP_TOOLS_CHOICES,
  readOmpChoices,
  sameAgentSettingValue,
  readAgentSetting,
  type AgentSettingsPatch,
  type AgentSettingsValues,
  type OmpChoiceModel,
  type OmpControlId,
} from "@tickernelz/paperclip-pro-shared";
import { agentDefaultsApi } from "@/api/agentDefaults";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";

export const OMP_ADAPTER_TYPE = "omp_local";

export const CONTROL_LABELS: Record<OmpControlId, { label: string; help: string }> = {
  style: { label: "Style", help: "Sets how hard agents think and check" },
  model: { label: "Model", help: "From the models OMP reports" },
  thinking: { label: "Thinking", help: "More thinking is slower and costs more" },
  backup: { label: "Backup models", help: "Used when the model is busy or down" },
  tools: { label: "Tools", help: "What agents may do on the machine" },
  limit: { label: "Stop a run after", help: "One value sets OMP's deadline and the process timeout" },
};

export function settingsValuesFromConfig(config: Record<string, unknown>): AgentSettingsValues {
  const values: AgentSettingsValues = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (key === OMP_SETTINGS_KEY && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [setting, item] of Object.entries(value as Record<string, unknown>)) {
        if (item !== undefined) values[OMP_SETTINGS_PATH_PREFIX + setting] = item;
      }
      continue;
    }
    values[key] = value;
  }
  return values;
}

export function omitUndefined(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

export function changedControls(base: Record<string, unknown>, next: Record<string, unknown>): OmpControlId[] {
  return (Object.keys(OMP_CONTROL_PATHS) as OmpControlId[]).filter((control) =>
    OMP_CONTROL_PATHS[control].some((path) => !sameAgentSettingValue(readAgentSetting(base, path), readAgentSetting(next, path))),
  );
}

export function changedPaths(base: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const a = settingsValuesFromConfig(base);
  const b = settingsValuesFromConfig(next);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((path) => !sameAgentSettingValue(a[path], b[path]));
}

function modelLabel(id: string, models: readonly OmpChoiceModel[]): string {
  return models.find((model) => model.id === id)?.label ?? id;
}

export function describeChoice(control: OmpControlId, config: Record<string, unknown>, models: readonly OmpChoiceModel[]): string {
  const choice = readOmpChoices(config)[control];
  switch (control) {
    case "style":
      return choice ? OMP_STYLE_PRESETS[choice as keyof typeof OMP_STYLE_PRESETS].label : "OMP default";
    case "model":
      return choice ? modelLabel(choice, models) : "OMP default";
    case "thinking":
      return choice ? OMP_THINKING_CHOICES[choice as keyof typeof OMP_THINKING_CHOICES].label : typeof config.thinking === "string" ? config.thinking : "OMP default";
    case "backup": {
      const list = Array.isArray(config.fallbackModels) ? (config.fallbackModels as string[]) : [];
      if (list.length === 0) return "None";
      return `${choice === "automatic" ? "Automatic" : "Custom"}: ${list.map((id) => modelLabel(id, models)).join(", then ")}`;
    }
    case "tools":
      return choice ? OMP_TOOLS_CHOICES[choice as keyof typeof OMP_TOOLS_CHOICES].label : "Custom";
    case "limit":
      return choice ? OMP_LIMIT_CHOICES[choice as keyof typeof OMP_LIMIT_CHOICES].label : "OMP default (12 hours)";
  }
}

export function patchSize(patch: AgentSettingsPatch): number {
  return Object.keys(patch).length;
}

export function useOmpModels(companyId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agents.adapterModels(companyId ?? "", OMP_ADAPTER_TYPE),
    queryFn: () => agentsApi.adapterModels(companyId!, OMP_ADAPTER_TYPE),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}

export function useAgentDefaults(companyId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentDefaults.values(companyId ?? ""),
    queryFn: () => agentDefaultsApi.get(companyId!),
    enabled: Boolean(companyId),
  });
}

export function useOmpSettingsCatalog(companyId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentDefaults.ompSettings(companyId ?? ""),
    queryFn: () => agentDefaultsApi.ompSettings(companyId!),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
  });
}
