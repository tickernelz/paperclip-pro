import type {
  IssueRunModelOverrideField,
  IssueRunModelOverrideInheritance,
  IssueRunModelOverrideKey,
  IssueRunModelOverridePropagation,
  IssueRunModelOverrideSubtaskScope,
  IssueRunModelOverrideView,
} from "@tickernelz/paperclip-pro-shared";
import type { AdapterConfigSchema, ConfigFieldSchema } from "../adapters/types.js";
import {
  AdapterConfigFieldValueError,
  isFreeTextAdapterConfigField,
  validateAdapterConfigFieldValue,
} from "./adapter-config-field-value.js";
import { resolveAdapterConfigSchema } from "./adapter-config-schema.js";

export const ISSUE_RUN_MODEL_OVERRIDE_KEYS: readonly IssueRunModelOverrideKey[] = [
  "model",
  "thinking",
];

export type IssueRunModelOverrideValues = Partial<
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

export function readIssueRunModelOverrideInheritance(
  assigneeAdapterOverrides: unknown,
): IssueRunModelOverrideInheritance {
  const raw = asRecord(asRecord(assigneeAdapterOverrides).modelOverrideInheritance);
  const subtaskScope: IssueRunModelOverrideSubtaskScope =
    raw.subtaskScope === "new_and_existing" ? "new_and_existing" : "new";
  return {
    inheritToSubtasks: raw.inheritToSubtasks !== false,
    subtaskScope,
    inherited: raw.inherited === true,
    sourceIssueId: nonEmptyString(raw.sourceIssueId),
  };
}

/** True when this issue carries an override a parent must never rewrite. */
export function hasExplicitIssueRunModelOverride(
  assigneeAdapterOverrides: unknown,
): boolean {
  const stored = readIssueRunModelOverride(assigneeAdapterOverrides);
  if (!stored.model && !stored.thinking) return false;
  return !readIssueRunModelOverrideInheritance(assigneeAdapterOverrides).inherited;
}

/** Merges the override into `assigneeAdapterOverrides`, leaving its other keys alone. */
export function writeIssueRunModelOverride(
  assigneeAdapterOverrides: unknown,
  values: IssueRunModelOverrideValues,
  inheritance?: {
    inheritToSubtasks: boolean;
    subtaskScope: IssueRunModelOverrideSubtaskScope;
    inherited?: boolean;
    sourceIssueId?: string | null;
  },
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
  const resolved = inheritance ?? readIssueRunModelOverrideInheritance(current);
  const keepsOverride = Boolean(next.adapterConfig);
  const inherited = keepsOverride && resolved.inherited === true;
  if (inherited || !resolved.inheritToSubtasks || resolved.subtaskScope !== "new") {
    next.modelOverrideInheritance = {
      inheritToSubtasks: resolved.inheritToSubtasks,
      subtaskScope: resolved.subtaskScope,
      ...(inherited
        ? { inherited: true, sourceIssueId: resolved.sourceIssueId ?? null }
        : {}),
    };
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
    try {
      result[key] = validateAdapterConfigFieldValue(field, value, {
        clearHint: "clear the override instead",
        unsupportedReason: "cannot be overridden per task",
      });
    } catch (error) {
      if (error instanceof AdapterConfigFieldValueError) {
        throw new IssueRunModelOverrideError(error.message, error.status);
      }
      throw error;
    }
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
    freeText: isFreeTextAdapterConfigField(field),
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
  propagation?: IssueRunModelOverridePropagation | null;
}): Promise<IssueRunModelOverrideView> {
  const stored = readIssueRunModelOverride(input.assigneeAdapterOverrides);
  const base = {
    issueId: input.issueId,
    agentId: input.assigneeAgent?.id ?? null,
    adapterType: input.assigneeAgent?.adapterType ?? null,
    inheritance: readIssueRunModelOverrideInheritance(input.assigneeAdapterOverrides),
    propagation: input.propagation ?? null,
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

/** The override a new child inherits, or `null` when it keeps what it was created with. */
export function inheritIssueRunModelOverrideForChild(input: {
  parentIssueId: string;
  parentOverrides: unknown;
  childOverrides: unknown;
}): Record<string, unknown> | null {
  const parentInheritance = readIssueRunModelOverrideInheritance(input.parentOverrides);
  if (!parentInheritance.inheritToSubtasks) return null;
  const parentValues = readIssueRunModelOverride(input.parentOverrides);
  const childConfig = asRecord(asRecord(input.childOverrides).adapterConfig);
  const values: IssueRunModelOverrideValues = {};
  for (const key of ISSUE_RUN_MODEL_OVERRIDE_KEYS) {
    if (!parentValues[key]) continue;
    if (childConfig[key] !== undefined) continue;
    values[key] = parentValues[key];
  }
  if (Object.keys(values).length === 0) return null;
  return writeIssueRunModelOverride(input.childOverrides, values, {
    inheritToSubtasks: true,
    subtaskScope: parentInheritance.subtaskScope,
    inherited: true,
    sourceIssueId: parentInheritance.sourceIssueId ?? input.parentIssueId,
  });
}
