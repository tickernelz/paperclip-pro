import type { ConfigFieldSchema } from "../adapters/types.js";

const FREE_TEXT_FIELD_TYPES: Record<string, true> = { text: true, combobox: true };

export class AdapterConfigFieldValueError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "AdapterConfigFieldValueError";
    this.status = status;
  }
}

export function isFreeTextAdapterConfigField(field: ConfigFieldSchema): boolean {
  return Boolean(FREE_TEXT_FIELD_TYPES[field.type]);
}

/** Validates one value against the adapter's published field schema. */
export function validateAdapterConfigFieldValue(
  field: ConfigFieldSchema,
  value: string,
  wording: { clearHint: string; unsupportedReason: string },
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdapterConfigFieldValueError(
      `${field.label} cannot be empty; ${wording.clearHint}.`,
    );
  }
  if (field.type === "select") {
    const allowed = (field.options ?? []).map((option) => option.value);
    if (!allowed.includes(trimmed)) {
      throw new AdapterConfigFieldValueError(
        `${field.label} must be one of: ${allowed.join(", ")}.`,
      );
    }
    return trimmed;
  }
  if (!isFreeTextAdapterConfigField(field)) {
    throw new AdapterConfigFieldValueError(
      `${field.label} ${wording.unsupportedReason}.`,
    );
  }
  return trimmed;
}
