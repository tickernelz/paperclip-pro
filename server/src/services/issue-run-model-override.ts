import type {
  IssueRunModelOverrideField,
  IssueRunModelOverrideKey,
  IssueRunModelOverrideView,
} from "@tickernelz/paperclip-pro-shared";
import type { AdapterConfigSchema, ConfigFieldSchema } from "../adapters/types.js";
import { resolveAdapterConfigSchema } from "./adapter-config-schema.js";

const ISSUE_RUN_MODEL_OVERRIDE_KEYS: readonly IssueRunModelOverrideKey[] = [
  "model",
  "thinking",
];

const FREE_TEXT_FIELD_TYPES: Record<string, true> = { text: true, combobox: true };

type IssueRunModelOverrideValues = Partial<
  Record<IssueRunModelOverrideKey, string | null>
>;

export class IssueRunModelOverrideError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "IssueRunModelOverrideError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readIssueRunModelOverride(
  assigneeAdapterOverrides: unknown,
): Record<IssueRunModelOverrideKey, string | null> {
  const adapterConfig = asRecord(asRecord(assigneeAdapterOverrides).adapterConfig);
  return {
    model: nonEmptyString(adapterConfig.model),
    thinking: nonEmptyString(adapterConfig.thinking),
  };
}

/** Merges the override into `assigneeAdapterOverrides`, leaving its other keys alone. */
export function writeIssueRunModelOverride(
  assigneeAdapterOverrides: unknown,
  values: IssueRunModelOverrideValues,
): Record<string, unknown> | null {
  const current = asRecord(assigneeAdapterOverrides);
  const adapterConfig = { ...asRecord(current.adapterConfig) };
  for (const key of ISSUE_RUN_MODEL_OVERRIDE_KEYS) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === null || value === undefined) delete adapterConfig[key];
    else adapterConfig[key] = value;
  }
  const next: Record<string, unknown> = {};
  if (Object.keys(adapterConfig).length > 0) next.adapterConfig = adapterConfig;
  if (typeof current.useProjectWorkspace === "boolean") {
    next.useProjectWorkspace = current.useProjectWorkspace;
  }
  return Object.keys(next).length > 0 ? next : null;
}

export interface IssueRunAdapterConfig {
  config: Record<string, unknown>;
  modelOverride: Record<IssueRunModelOverrideKey, string | null>;
}

/** Layers the per-issue adapter overrides onto the run's execution config. */
export function buildIssueRunAdapterConfig(
  workspaceManagedConfig: Record<string, unknown>,
  issueOverrides: { adapterConfig: Record<string, unknown> | null } | null,
): IssueRunAdapterConfig {
  const issueAdapterConfig = issueOverrides?.adapterConfig ?? null;
  return {
    config: { ...workspaceManagedConfig, ...(issueAdapterConfig ?? {}) },
    modelOverride: readIssueRunModelOverride({ adapterConfig: issueAdapterConfig }),
  };
}

function findField(
  schema: AdapterConfigSchema,
  key: IssueRunModelOverrideKey,
): ConfigFieldSchema | null {
  return schema.fields.find((field) => field.key === key) ?? null;
}

function validateIssueRunModelOverrideValue(
  field: ConfigFieldSchema,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new IssueRunModelOverrideError(
      `${field.label} cannot be empty; clear the override instead.`,
    );
  }
  if (field.type === "select") {
    const allowed = (field.options ?? []).map((option) => option.value);
    if (!allowed.includes(trimmed)) {
      throw new IssueRunModelOverrideError(
        `${field.label} must be one of: ${allowed.join(", ")}.`,
      );
    }
    return trimmed;
  }
  if (!FREE_TEXT_FIELD_TYPES[field.type]) {
    throw new IssueRunModelOverrideError(
      `${field.label} cannot be overridden per task.`,
    );
  }
  return trimmed;
}

/** Validates against the adapter's published config schema, not a server-side list. */
function validateIssueRunModelOverride(
  schema: AdapterConfigSchema,
  values: IssueRunModelOverrideValues,
): IssueRunModelOverrideValues {
  const result: IssueRunModelOverrideValues = {};
  for (const key of ISSUE_RUN_MODEL_OVERRIDE_KEYS) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === null || value === undefined) {
      result[key] = null;
      continue;
    }
    const field = findField(schema, key);
    if (!field) {
      throw new IssueRunModelOverrideError(
        `This agent's adapter does not expose a "${key}" setting.`,
      );
    }
    result[key] = validateIssueRunModelOverrideValue(field, value);
  }
  return result;
}

function buildField(
  key: IssueRunModelOverrideKey,
  field: ConfigFieldSchema | null,
  agentConfig: Record<string, unknown>,
  override: string | null,
): IssueRunModelOverrideField | null {
  if (!field) return null;
  const agentDefault =
    nonEmptyString(agentConfig[key]) ?? nonEmptyString(field.default);
  return {
    key,
    label: field.label,
    hint: field.hint ?? null,
    freeText: Boolean(FREE_TEXT_FIELD_TYPES[field.type]),
    options: (field.options ?? [])
      .filter((option) => option.value.trim())
      .map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.group ? { group: option.group } : {}),
      })),
    agentDefault,
    override,
    effective: override ?? agentDefault,
  };
}

export async function buildIssueRunModelOverrideView(input: {
  issueId: string;
  assigneeAgent: {
    id: string;
    adapterType: string;
    adapterConfig: Record<string, unknown> | null;
  } | null;
  assigneeAdapterOverrides: unknown;
}): Promise<IssueRunModelOverrideView> {
  const stored = readIssueRunModelOverride(input.assigneeAdapterOverrides);
  const base = {
    issueId: input.issueId,
    agentId: input.assigneeAgent?.id ?? null,
    adapterType: input.assigneeAgent?.adapterType ?? null,
  };
  if (!input.assigneeAgent) {
    return {
      ...base,
      supported: false,
      unsupportedReason: "This task has no agent assignee.",
      fields: [],
    };
  }
  const resolved = await resolveAdapterConfigSchema(input.assigneeAgent.adapterType);
  if (!resolved.ok) {
    return {
      ...base,
      supported: false,
      unsupportedReason:
        resolved.reason === "not_registered"
          ? `Adapter "${input.assigneeAgent.adapterType}" is not registered.`
          : `Adapter "${input.assigneeAgent.adapterType}" does not publish a config schema.`,
      fields: [],
    };
  }
  const agentConfig = asRecord(input.assigneeAgent.adapterConfig);
  const fields = ISSUE_RUN_MODEL_OVERRIDE_KEYS.map((key) =>
    buildField(key, findField(resolved.schema, key), agentConfig, stored[key]),
  ).filter((field): field is IssueRunModelOverrideField => field !== null);
  return {
    ...base,
    supported: fields.length > 0,
    unsupportedReason: fields.length
      ? null
      : `Adapter "${input.assigneeAgent.adapterType}" exposes no model or thinking setting.`,
    fields,
  };
}

export async function resolveIssueRunModelOverrideUpdate(input: {
  adapterType: string | null;
  values: IssueRunModelOverrideValues;
}): Promise<IssueRunModelOverrideValues> {
  const clearsOnly = ISSUE_RUN_MODEL_OVERRIDE_KEYS.every(
    (key) => !(key in input.values) || input.values[key] == null,
  );
  if (!input.adapterType) {
    if (clearsOnly) return validateIssueRunModelOverride({ fields: [] }, input.values);
    throw new IssueRunModelOverrideError(
      "This task has no agent assignee, so there is no adapter to validate against.",
    );
  }
  const resolved = await resolveAdapterConfigSchema(input.adapterType);
  if (!resolved.ok) {
    if (clearsOnly) return validateIssueRunModelOverride({ fields: [] }, input.values);
    throw new IssueRunModelOverrideError(
      `Adapter "${input.adapterType}" does not publish a config schema.`,
    );
  }
  return validateIssueRunModelOverride(resolved.schema, input.values);
}
