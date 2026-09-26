import type {
  AgentAdapterConfigBatchField,
  AgentAdapterConfigBatchFailure,
  AgentAdapterConfigBatchPreview,
  AgentAdapterConfigBatchTarget,
} from "@tickernelz/paperclip-pro-shared";
import type { ConfigFieldSchema } from "../adapters/types.js";
import {
  AdapterConfigFieldValueError,
  isFreeTextAdapterConfigField,
  validateAdapterConfigFieldValue,
} from "./adapter-config-field-value.js";
import { resolveAdapterConfigSchema } from "./adapter-config-schema.js";

/** The model-selection keys a batch may write; everything else stays single-agent. */
export const AGENT_ADAPTER_CONFIG_BATCH_KEYS: readonly string[] = [
  "model",
  "thinking",
  "provider",
  "smolModel",
  "slowModel",
  "planModel",
  "modelCycle",
];

/** `provider` on a paperclip_runner agent needs the single-agent transition checks. */
const PROVIDER_LOCKED_ADAPTER_TYPES: Record<string, true> = {
  paperclip_runner: true,
};

export interface AgentAdapterConfigBatchAgent {
  id: string;
  name: string;
  adapterType: string;
  adapterConfig: Record<string, unknown> | null;
}

export interface AgentAdapterConfigBatchPlanEntry {
  agent: AgentAdapterConfigBatchAgent;
  adapterConfig: Record<string, unknown>;
  changedKeys: string[];
}

export type AgentAdapterConfigBatchPlan =
  | { ok: true; entries: AgentAdapterConfigBatchPlanEntry[] }
  | { ok: false; failures: AgentAdapterConfigBatchFailure[] };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function batchFieldsFor(
  agent: AgentAdapterConfigBatchAgent,
): Promise<{ fields: Record<string, ConfigFieldSchema>; reason: string | null }> {
  const resolved = await resolveAdapterConfigSchema(agent.adapterType);
  if (!resolved.ok) {
    return {
      fields: {},
      reason:
        resolved.reason === "not_registered"
          ? `Adapter "${agent.adapterType}" is not registered.`
          : `Adapter "${agent.adapterType}" does not publish a config schema.`,
    };
  }
  const fields: Record<string, ConfigFieldSchema> = {};
  for (const field of resolved.schema.fields) {
    if (!AGENT_ADAPTER_CONFIG_BATCH_KEYS.includes(field.key)) continue;
    if (field.type !== "select" && !isFreeTextAdapterConfigField(field)) continue;
    if (field.key === "provider" && PROVIDER_LOCKED_ADAPTER_TYPES[agent.adapterType]) {
      continue;
    }
    fields[field.key] = field;
  }
  return {
    fields,
    reason: Object.keys(fields).length
      ? null
      : `Adapter "${agent.adapterType}" exposes no batch-editable model setting.`,
  };
}

function describeField(key: string, field: ConfigFieldSchema): AgentAdapterConfigBatchField {
  return {
    key,
    label: field.label,
    hint: field.hint ?? null,
    freeText: isFreeTextAdapterConfigField(field),
    options: (field.options ?? [])
      .filter((option) => option.value.trim())
      .map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.group ? { group: option.group } : {}),
      })),
  };
}

/** The fields a batch may set: the intersection over the selected agents' schemas. */
export async function buildAgentAdapterConfigBatchPreview(
  agents: AgentAdapterConfigBatchAgent[],
): Promise<AgentAdapterConfigBatchPreview> {
  const targets: AgentAdapterConfigBatchTarget[] = [];
  let shared: Record<string, AgentAdapterConfigBatchField> | null = null;
  for (const agent of agents) {
    const { fields, reason } = await batchFieldsFor(agent);
    const config = asRecord(agent.adapterConfig);
    const current: Record<string, string | null> = {};
    for (const key of Object.keys(fields)) {
      const value = config[key];
      current[key] = typeof value === "string" && value.trim() ? value.trim() : null;
    }
    targets.push({
      agentId: agent.id,
      name: agent.name,
      adapterType: agent.adapterType,
      eligible: reason === null,
      reason,
      current,
    });
    if (reason !== null) continue;
    const described: Record<string, AgentAdapterConfigBatchField> = {};
    for (const [key, field] of Object.entries(fields)) {
      described[key] = describeField(key, field);
    }
    if (shared === null) {
      shared = described;
      continue;
    }
    for (const key of Object.keys(shared)) {
      const candidate = described[key];
      if (!candidate) {
        delete shared[key];
        continue;
      }
      const allowed: Record<string, true> = {};
      for (const option of candidate.options) allowed[option.value] = true;
      shared[key] = {
        ...shared[key],
        freeText: shared[key].freeText && candidate.freeText,
        options: shared[key].options.filter((option) => allowed[option.value]),
      };
    }
  }
  return { fields: Object.values(shared ?? {}), agents: targets };
}

/** Validates every value per agent; one invalid field rejects the whole batch. */
export async function planAgentAdapterConfigBatch(
  agents: AgentAdapterConfigBatchAgent[],
  values: Record<string, string | null>,
): Promise<AgentAdapterConfigBatchPlan> {
  const failures: AgentAdapterConfigBatchFailure[] = [];
  const entries: AgentAdapterConfigBatchPlanEntry[] = [];
  for (const agent of agents) {
    const { fields, reason } = await batchFieldsFor(agent);
    if (reason !== null) {
      failures.push({ agentId: agent.id, name: agent.name, key: null, message: reason });
      continue;
    }
    const adapterConfig = { ...asRecord(agent.adapterConfig) };
    const changedKeys: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      const field = fields[key];
      if (!field) {
        failures.push({
          agentId: agent.id,
          name: agent.name,
          key,
          message:
            key === "provider" && PROVIDER_LOCKED_ADAPTER_TYPES[agent.adapterType]
              ? `Change the provider of a ${agent.adapterType} agent one agent at a time.`
              : `Adapter "${agent.adapterType}" does not expose a batch-editable "${key}" setting.`,
        });
        continue;
      }
      if (value === null) {
        if (adapterConfig[key] === undefined) continue;
        delete adapterConfig[key];
        changedKeys.push(key);
        continue;
      }
      try {
        const next = validateAdapterConfigFieldValue(field, value, {
          clearHint: "clear the field instead",
          unsupportedReason: "cannot be changed in a batch",
        });
        if (adapterConfig[key] === next) continue;
        adapterConfig[key] = next;
        changedKeys.push(key);
      } catch (error) {
        if (error instanceof AdapterConfigFieldValueError) {
          failures.push({
            agentId: agent.id,
            name: agent.name,
            key,
            message: error.message,
          });
          continue;
        }
        throw error;
      }
    }
    entries.push({ agent, adapterConfig, changedKeys: changedKeys.sort() });
  }
  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, entries };
}
