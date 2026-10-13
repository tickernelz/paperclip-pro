import { useCallback, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  AGENT_FALLBACK_EFFORTS_KEY,
  AGENT_FALLBACK_MODELS_KEY,
  fitAgentFallbackEfforts,
  fitAgentFallbackModels,
  readAgentFallbackEfforts,
  readAgentFallbackModels,
  type Agent,
  type AgentAdapterConfigBatchFailure,
  type AgentAdapterConfigBatchField,
  type IssueRunModelOverrideOption,
} from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import { ApiError } from "@/api/client";
import { modelPickerOption } from "@/adapters/model-picker-fields";
import { describeModelValue, modelValueText } from "@/components/task-chat/model-option-display";
import { useToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";

export const AGENT_EFFORT_KEY = "thinking";

export type AgentModelSettingKey =
  | "model"
  | typeof AGENT_FALLBACK_MODELS_KEY
  | typeof AGENT_EFFORT_KEY
  | typeof AGENT_FALLBACK_EFFORTS_KEY;
export type AgentModelSettingValue = string | string[] | Record<string, string> | null;
export type AgentModelSettingValues = Partial<Record<AgentModelSettingKey, AgentModelSettingValue>>;

export interface AgentModelSettings {
  modelField: AgentAdapterConfigBatchField | null;
  fallbackField: AgentAdapterConfigBatchField | null;
  effortField: AgentAdapterConfigBatchField | null;
  modelOptions: readonly IssueRunModelOverrideOption[];
  model: string | null;
  fallbacks: string[];
  effort: string | null;
  fallbackEfforts: Record<string, string>;
}

export interface AgentModelSettingsController {
  settingsFor: (agent: Agent) => AgentModelSettings;
  isPending: (agentId: string, key: AgentModelSettingKey) => boolean;
  save: (agent: Agent, key: AgentModelSettingKey, value: AgentModelSettingValue) => void;
  saveMany: (agent: Agent, key: AgentModelSettingKey, values: AgentModelSettingValues) => void;
}

const SETTING_LABELS: Record<AgentModelSettingKey, string> = {
  model: "Model",
  [AGENT_FALLBACK_MODELS_KEY]: "Fallback models",
  [AGENT_EFFORT_KEY]: "Effort",
  [AGENT_FALLBACK_EFFORTS_KEY]: "Fallback effort",
};

const UNDO_WINDOW_MS = 5000;
const SCHEMA_STALE_MS = 60_000;
const CATALOG_STALE_MS = 5 * 60_000;

function asConfig(agent: Agent): Record<string, unknown> {
  const config = agent.adapterConfig;
  return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

function readString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function catalogProviderFor(agent: Agent): string | undefined {
  return agent.adapterType === "paperclip_runner" ? String(asConfig(agent).provider ?? "codex") : undefined;
}

function catalogKey(adapterType: string, provider: string | undefined): string {
  return `${adapterType}\u0000${provider ?? ""}`;
}

function settingValues(config: Record<string, unknown>): Record<AgentModelSettingKey, AgentModelSettingValue> {
  const fallbacks = readAgentFallbackModels(config[AGENT_FALLBACK_MODELS_KEY]);
  const efforts = readAgentFallbackEfforts(config[AGENT_FALLBACK_EFFORTS_KEY]);
  return {
    model: readString(config, "model"),
    [AGENT_FALLBACK_MODELS_KEY]: fallbacks.length > 0 ? fallbacks : null,
    [AGENT_EFFORT_KEY]: readString(config, AGENT_EFFORT_KEY),
    [AGENT_FALLBACK_EFFORTS_KEY]: Object.keys(efforts).length > 0 ? efforts : null,
  };
}

function isEmptyValue(value: AgentModelSettingValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function applyValues(
  config: Record<string, unknown>,
  values: Partial<Record<AgentModelSettingKey, AgentModelSettingValue>>,
): Record<string, unknown> {
  const next = { ...config };
  for (const [key, value] of Object.entries(values)) {
    if (isEmptyValue(value)) delete next[key];
    else next[key] = value;
  }
  if (next[AGENT_FALLBACK_MODELS_KEY] !== undefined) {
    const fitted = fitAgentFallbackModels(readAgentFallbackModels(next[AGENT_FALLBACK_MODELS_KEY]), readString(next, "model"));
    if (fitted.list.length > 0) next[AGENT_FALLBACK_MODELS_KEY] = fitted.list;
    else delete next[AGENT_FALLBACK_MODELS_KEY];
  }
  const efforts = fitAgentFallbackEfforts(next[AGENT_FALLBACK_EFFORTS_KEY], readAgentFallbackModels(next[AGENT_FALLBACK_MODELS_KEY]));
  if (Object.keys(efforts).length > 0) next[AGENT_FALLBACK_EFFORTS_KEY] = efforts;
  else delete next[AGENT_FALLBACK_EFFORTS_KEY];
  return next;
}

function sameValue(left: AgentModelSettingValue, right: AgentModelSettingValue): boolean {
  if (isEmptyValue(left) && isEmptyValue(right)) return true;
  if ((left && typeof left === "object" && !Array.isArray(left)) || (right && typeof right === "object" && !Array.isArray(right))) {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  }
  return (left ?? null) === (right ?? null);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { failures?: AgentAdapterConfigBatchFailure[] } | null;
    const failure = Array.isArray(body?.failures) ? body.failures[0] : undefined;
    if (failure?.message) return failure.message;
  }
  return error instanceof Error && error.message ? error.message : "The change was not saved.";
}

/** Loads per-adapter model fields and catalogs for the agents table and saves single-cell edits. */
export function useAgentModelSettings(
  companyId: string | null,
  agents: readonly Agent[],
  enabled: boolean,
): AgentModelSettingsController {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [pending, setPending] = useState<Record<string, true>>({});

  const representatives = useMemo(() => {
    const byType = new Map<string, string>();
    for (const agent of [...agents].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!byType.has(agent.adapterType)) byType.set(agent.adapterType, agent.id);
    }
    return [...byType.entries()];
  }, [agents]);

  const previews = useQueries({
    queries: representatives.map(([, agentId]) => ({
      queryKey: queryKeys.agents.adapterConfigBatch(companyId ?? "", [agentId]),
      queryFn: () => agentsApi.batchAdapterConfigPreview([agentId]),
      enabled: enabled && Boolean(companyId),
      staleTime: SCHEMA_STALE_MS,
      retry: false,
    })),
  });

  const fieldsByType = useMemo(() => {
    const map = new Map<string, Map<string, AgentAdapterConfigBatchField>>();
    representatives.forEach(([adapterType], index) => {
      const preview = previews[index]?.data;
      const eligible = preview?.agents?.some((target) => target.eligible) ?? false;
      const fields = new Map<string, AgentAdapterConfigBatchField>();
      if (eligible) for (const field of preview?.fields ?? []) fields.set(field.key, field);
      map.set(adapterType, fields);
    });
    return map;
  }, [representatives, previews]);

  const catalogs = useMemo(() => {
    const seen = new Map<string, { adapterType: string; provider: string | undefined }>();
    for (const agent of agents) {
      const supportsModel = fieldsByType.get(agent.adapterType)?.has("model") ?? false;
      if (!supportsModel && !readString(asConfig(agent), "model")) continue;
      const provider = catalogProviderFor(agent);
      seen.set(catalogKey(agent.adapterType, provider), { adapterType: agent.adapterType, provider });
    }
    return [...seen.entries()];
  }, [agents, fieldsByType]);

  const catalogQueries = useQueries({
    queries: catalogs.map(([, { adapterType, provider }]) => ({
      queryKey: queryKeys.agents.adapterModels(companyId ?? "", adapterType, null, provider),
      queryFn: () => agentsApi.adapterModels(companyId!, adapterType, { provider }),
      enabled: enabled && Boolean(companyId),
      staleTime: CATALOG_STALE_MS,
      retry: false,
    })),
  });

  const optionsByCatalog = useMemo(() => {
    const map = new Map<string, IssueRunModelOverrideOption[]>();
    catalogs.forEach(([key], index) => {
      const models = catalogQueries[index]?.data;
      if (Array.isArray(models) && models.length > 0) map.set(key, models.map((model) => modelPickerOption(model, false)));
    });
    return map;
  }, [catalogs, catalogQueries]);

  const settingsFor = useCallback(
    (agent: Agent): AgentModelSettings => {
      const fields = fieldsByType.get(agent.adapterType);
      const config = asConfig(agent);
      const modelField = fields?.get("model") ?? null;
      const fallbackField = fields?.get(AGENT_FALLBACK_MODELS_KEY) ?? null;
      const effortField = fields?.get(AGENT_EFFORT_KEY) ?? null;
      const catalog = optionsByCatalog.get(catalogKey(agent.adapterType, catalogProviderFor(agent)));
      return {
        modelField,
        fallbackField,
        effortField,
        modelOptions: catalog ?? modelField?.options ?? fallbackField?.options ?? [],
        model: readString(config, "model"),
        fallbacks: readAgentFallbackModels(config[AGENT_FALLBACK_MODELS_KEY]),
        effort: readString(config, AGENT_EFFORT_KEY),
        fallbackEfforts: readAgentFallbackEfforts(config[AGENT_FALLBACK_EFFORTS_KEY]),
      };
    },
    [fieldsByType, optionsByCatalog],
  );

  const setPendingKey = useCallback((id: string, on: boolean) => {
    setPending((current) => {
      if (on === Boolean(current[id])) return current;
      const next = { ...current };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);

  const writeAgentConfig = useCallback(
    (agentId: string, config: Record<string, unknown>) => {
      if (!companyId) return;
      queryClient.setQueryData<Agent[]>(queryKeys.agents.list(companyId), (current) =>
        current?.map((entry) => (entry.id === agentId ? { ...entry, adapterConfig: config } : entry)),
      );
    },
    [companyId, queryClient],
  );

  const readAgentConfig = useCallback(
    (agentId: string): Record<string, unknown> | null => {
      if (!companyId) return null;
      const agent = queryClient.getQueryData<Agent[]>(queryKeys.agents.list(companyId))?.find((entry) => entry.id === agentId);
      return agent ? asConfig(agent) : null;
    },
    [companyId, queryClient],
  );

  const describe = useCallback(
    (agent: Agent, key: AgentModelSettingKey, value: AgentModelSettingValue): string => {
      if (isEmptyValue(value)) return "default";
      if (key === AGENT_EFFORT_KEY) return String(value);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const options = settingsFor(agent).modelOptions;
        return Object.entries(value)
          .map(([selector, level]) => `${modelValueText(describeModelValue(selector, options))} · ${level}`)
          .join(", ");
      }
      const options = settingsFor(agent).modelOptions;
      const list = Array.isArray(value) ? value : [String(value)];
      return list.map((entry) => modelValueText(describeModelValue(entry, options))).join(", ");
    },
    [settingsFor],
  );

  const apply = useCallback(
    async (
      agent: Agent,
      key: AgentModelSettingKey,
      values: AgentModelSettingValues,
      undoable: boolean,
    ) => {
      const pendingId = `${agent.id}:${key}`;
      const previous = readAgentConfig(agent.id) ?? asConfig(agent);
      const before = settingValues(previous);
      writeAgentConfig(agent.id, applyValues(previous, values));
      setPendingKey(pendingId, true);
      try {
        const result = await agentsApi.batchAdapterConfig([agent.id], values);
        const changedKeys = (result.results.find((entry) => entry.agentId === agent.id)?.changedKeys ?? []).filter(
          (changed): changed is AgentModelSettingKey => changed in SETTING_LABELS,
        );
        if (changedKeys.length > 0) {
          const label = SETTING_LABELS[key];
          const restore = Object.fromEntries(changedKeys.map((changed) => [changed, before[changed]])) as AgentModelSettingValues;
          pushToast(
            undoable
              ? {
                  title: "Saved",
                  body: `${agent.name} · ${label}: ${describe(agent, key, values[key] ?? null)}`,
                  tone: "success",
                  ttlMs: UNDO_WINDOW_MS,
                  action: { label: "Undo", onClick: () => void apply(agent, key, restore, false) },
                }
              : { title: "Restored", body: `${agent.name} · ${label}`, tone: "info" },
          );
        }
      } catch (error) {
        writeAgentConfig(agent.id, previous);
        pushToast({ title: `${SETTING_LABELS[key]} not saved`, body: errorMessage(error), tone: "error" });
      } finally {
        setPendingKey(pendingId, false);
        if (companyId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId), exact: true });
          void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
        }
      }
    },
    [companyId, describe, pushToast, queryClient, readAgentConfig, setPendingKey, writeAgentConfig],
  );

  const saveMany = useCallback(
    (agent: Agent, key: AgentModelSettingKey, values: AgentModelSettingValues) => {
      const current = settingValues(asConfig(agent));
      const changed: AgentModelSettingValues = {};
      for (const [entry, value] of Object.entries(values) as [AgentModelSettingKey, AgentModelSettingValue][]) {
        const normalized = isEmptyValue(value) ? null : value;
        if (!sameValue(current[entry], normalized)) changed[entry] = normalized;
      }
      if (Object.keys(changed).length === 0) return;
      void apply(agent, key, changed, true);
    },
    [apply],
  );

  const save = useCallback(
    (agent: Agent, key: AgentModelSettingKey, value: AgentModelSettingValue) => saveMany(agent, key, { [key]: value }),
    [saveMany],
  );

  const isPending = useCallback((agentId: string, key: AgentModelSettingKey) => Boolean(pending[`${agentId}:${key}`]), [pending]);

  return { settingsFor, isPending, save, saveMany };
}
