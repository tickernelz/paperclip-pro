import type {
  AgentAdapterConfigBatchField,
  AgentAdapterConfigBatchFailure,
  AgentAdapterConfigBatchPreview,
  AgentAdapterConfigBatchTarget,
} from "@tickernelz/paperclip-pro-shared";
import {
  AGENT_FALLBACK_MODELS_KEY,
  AGENT_FALLBACK_MODELS_MAX,
  fitAgentFallbackModels,
  readAgentFallbackModels,
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
  AGENT_FALLBACK_MODELS_KEY,
];

const LIST_KEYS: readonly string[] = [AGENT_FALLBACK_MODELS_KEY];

/** `provider` on a paperclip_runner agent needs the single-agent transition checks. */
const PROVIDER_LOCKED_ADAPTER_TYPES: Record<string, true> = {
  paperclip_runner: true,
};

export type AgentAdapterConfigBatchValue = string | string[] | null;

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
  skippedKeys: string[];
  droppedValues: Record<string, string[]>;
}

export type AgentAdapterConfigBatchPlan =
  | { ok: true; entries: AgentAdapterConfigBatchPlanEntry[] }
  | { ok: false; failures: AgentAdapterConfigBatchFailure[] };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isListField(field: ConfigFieldSchema): boolean {
  return field.type === "combobox_list" && LIST_KEYS.includes(field.key);
}

async function batchFieldsFor(
  agent: AgentAdapterConfigBatchAgent,
): Promise<{
  fields: Record<string, ConfigFieldSchema>;
  listFields: Record<string, ConfigFieldSchema>;
  reason: string | null;
}> {
  const resolved = await resolveAdapterConfigSchema(agent.adapterType);
  if (!resolved.ok) {
    return {
      fields: {},
      listFields: {},
      reason:
        resolved.reason === "not_registered"
          ? `Adapter "${agent.adapterType}" is not registered.`
          : `Adapter "${agent.adapterType}" does not publish a config schema.`,
    };
  }
  const fields: Record<string, ConfigFieldSchema> = {};
  const listFields: Record<string, ConfigFieldSchema> = {};
  for (const field of resolved.schema.fields) {
    if (!AGENT_ADAPTER_CONFIG_BATCH_KEYS.includes(field.key)) continue;
    if (isListField(field)) {
      listFields[field.key] = field;
      continue;
    }
    if (field.type !== "select" && !isFreeTextAdapterConfigField(field)) continue;
    if (field.key === "provider" && PROVIDER_LOCKED_ADAPTER_TYPES[agent.adapterType]) {
      continue;
    }
    fields[field.key] = field;
  }
  return {
    fields,
    listFields,
    reason: Object.keys(fields).length || Object.keys(listFields).length
      ? null
      : `Adapter "${agent.adapterType}" exposes no batch-editable model setting.`,
  };
}

function describeField(key: string, field: ConfigFieldSchema): AgentAdapterConfigBatchField {
  const list = isListField(field)
    ? {
        maxItems: typeof field.meta?.maxItems === "number" ? field.meta.maxItems : AGENT_FALLBACK_MODELS_MAX,
        distinctFromKey: typeof field.meta?.distinctFromKey === "string" ? field.meta.distinctFromKey : null,
      }
    : null;
  return {
    key,
    label: field.label,
    hint: field.hint ?? null,
    freeText: list ? true : isFreeTextAdapterConfigField(field),
    options: (field.options ?? [])
      .filter((option) => option.value.trim())
      .map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.group ? { group: option.group } : {}),
        ...(option.name ? { name: option.name } : {}),
      })),
    ...(list ? { list } : {}),
  };
}

function intersectField(
  current: AgentAdapterConfigBatchField,
  candidate: AgentAdapterConfigBatchField,
): AgentAdapterConfigBatchField {
  const allowed: Record<string, true> = {};
  for (const option of candidate.options) allowed[option.value] = true;
  return {
    ...current,
    freeText: current.freeText && candidate.freeText,
    options: current.options.filter((option) => allowed[option.value]),
  };
}

/** The fields a batch may set: scalar fields every agent shares, list fields any agent supports. */
export async function buildAgentAdapterConfigBatchPreview(
  agents: AgentAdapterConfigBatchAgent[],
): Promise<AgentAdapterConfigBatchPreview> {
  const targets: AgentAdapterConfigBatchTarget[] = [];
  let shared: Record<string, AgentAdapterConfigBatchField> | null = null;
  const lists: Record<string, AgentAdapterConfigBatchField> = {};
  const resolved = await Promise.all(agents.map(async (agent) => ({ agent, ...(await batchFieldsFor(agent)) })));
  const listKeys = new Set(resolved.flatMap((entry) => Object.keys(entry.listFields)));
  for (const { agent, fields, listFields, reason } of resolved) {
    const config = asRecord(agent.adapterConfig);
    const current: Record<string, string | null> = {};
    for (const key of Object.keys(fields)) {
      const value = config[key];
      current[key] = typeof value === "string" && value.trim() ? value.trim() : null;
    }
    const currentLists: Record<string, string[]> = {};
    for (const key of Object.keys(listFields)) currentLists[key] = readAgentFallbackModels(config[key]);
    const unsupportedKeys = [...listKeys].filter((key) => !listFields[key]);
    targets.push({
      agentId: agent.id,
      name: agent.name,
      adapterType: agent.adapterType,
      eligible: reason === null,
      reason,
      current,
      ...(listKeys.size > 0 ? { currentLists, unsupportedKeys } : {}),
    });
    if (reason !== null) continue;
    for (const [key, field] of Object.entries(listFields)) {
      const described = describeField(key, field);
      lists[key] = lists[key] ? intersectField(lists[key], described) : described;
    }
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
      shared[key] = intersectField(shared[key], candidate);
    }
  }
  return { fields: [...Object.values(shared ?? {}), ...Object.values(lists)], agents: targets };
}

function listValue(
  value: AgentAdapterConfigBatchValue,
  field: ConfigFieldSchema,
): string[] | null | AdapterConfigFieldValueError {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    return new AdapterConfigFieldValueError(`${field.label} expects a list of model selectors.`);
  }
  const maxItems = typeof field.meta?.maxItems === "number" ? field.meta.maxItems : AGENT_FALLBACK_MODELS_MAX;
  const entries = value.map((entry) => entry.trim());
  if (entries.some((entry) => !entry)) {
    return new AdapterConfigFieldValueError(`${field.label} cannot contain an empty entry.`);
  }
  if (new Set(entries).size !== entries.length) {
    return new AdapterConfigFieldValueError(`${field.label} cannot list the same model twice.`);
  }
  if (entries.length > maxItems) {
    return new AdapterConfigFieldValueError(`${field.label} accepts at most ${maxItems} entries.`);
  }
  return entries;
}

function sameList(left: unknown, right: string[]): boolean {
  const current = readAgentFallbackModels(left);
  return current.length === right.length && current.every((entry, index) => entry === right[index]);
}

/** Validates every value per agent; one invalid field rejects the whole batch. */
export async function planAgentAdapterConfigBatch(
  agents: AgentAdapterConfigBatchAgent[],
  values: Record<string, AgentAdapterConfigBatchValue>,
): Promise<AgentAdapterConfigBatchPlan> {
  const failures: AgentAdapterConfigBatchFailure[] = [];
  const entries: AgentAdapterConfigBatchPlanEntry[] = [];
  const resolved = await Promise.all(agents.map(async (agent) => ({ agent, ...(await batchFieldsFor(agent)) })));
  const listKeysInBatch = new Set(
    Object.keys(values).filter((key) => resolved.some((entry) => entry.listFields[key])),
  );
  for (const { agent, fields, listFields, reason } of resolved) {
    if (reason !== null) {
      failures.push({ agentId: agent.id, name: agent.name, key: null, message: reason });
      continue;
    }
    const adapterConfig = { ...asRecord(agent.adapterConfig) };
    const changedKeys: string[] = [];
    const skippedKeys: string[] = [];
    const droppedValues: Record<string, string[]> = {};
    const pendingLists: Array<[string, ConfigFieldSchema, AgentAdapterConfigBatchValue]> = [];
    for (const [key, value] of Object.entries(values)) {
      if (listKeysInBatch.has(key)) {
        const listField = listFields[key];
        if (!listField) {
          skippedKeys.push(key);
          continue;
        }
        pendingLists.push([key, listField, value]);
        continue;
      }
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
      if (Array.isArray(value)) {
        failures.push({ agentId: agent.id, name: agent.name, key, message: `${field.label} takes a single value.` });
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
    for (const key of Object.keys(listFields)) {
      if (pendingLists.some(([pending]) => pending === key)) continue;
      if (adapterConfig[key] === undefined) continue;
      pendingLists.push([key, listFields[key]!, readAgentFallbackModels(adapterConfig[key])]);
    }
    for (const [key, field, value] of pendingLists) {
      const parsed = listValue(value, field);
      if (parsed instanceof AdapterConfigFieldValueError) {
        failures.push({ agentId: agent.id, name: agent.name, key, message: parsed.message });
        continue;
      }
      const distinctFromKey = typeof field.meta?.distinctFromKey === "string" ? field.meta.distinctFromKey : null;
      const primary = distinctFromKey && typeof adapterConfig[distinctFromKey] === "string"
        ? adapterConfig[distinctFromKey] as string
        : null;
      const fitted = parsed === null ? { list: [], dropped: [] } : fitAgentFallbackModels(parsed, primary);
      if (fitted.dropped.length > 0) droppedValues[key] = fitted.dropped;
      if (fitted.list.length === 0) {
        if (adapterConfig[key] === undefined) continue;
        delete adapterConfig[key];
        changedKeys.push(key);
        continue;
      }
      if (sameList(adapterConfig[key], fitted.list)) continue;
      adapterConfig[key] = fitted.list;
      changedKeys.push(key);
    }
    entries.push({ agent, adapterConfig, changedKeys: changedKeys.sort(), skippedKeys, droppedValues });
  }
  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, entries };
}
