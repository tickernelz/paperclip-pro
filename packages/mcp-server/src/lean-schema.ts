export type JsonSchemaObject = Record<string, unknown>;

const DROPPED_KEYWORDS: Record<string, true> = {
  $schema: true,
  contentEncoding: true,
  contentMediaType: true,
  default: true,
  example: true,
  examples: true,
  exclusiveMaximum: true,
  exclusiveMinimum: true,
  format: true,
  maxItems: true,
  maxLength: true,
  maxProperties: true,
  maximum: true,
  minItems: true,
  minLength: true,
  minProperties: true,
  minimum: true,
  multipleOf: true,
  pattern: true,
  propertyNames: true,
  readOnly: true,
  uniqueItems: true,
  writeOnly: true,
};

const SCHEMA_MAP_KEYWORDS: Record<string, true> = {
  $defs: true,
  definitions: true,
  patternProperties: true,
  properties: true,
};

const SCHEMA_LIST_KEYWORDS: Record<string, true> = {
  allOf: true,
  anyOf: true,
  oneOf: true,
  prefixItems: true,
};

const NESTED_SCHEMA_KEYWORDS: Record<string, true> = {
  additionalProperties: true,
  else: true,
  if: true,
  items: true,
  not: true,
  then: true,
};

function isNullBranch(value: unknown): value is JsonSchemaObject {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    (value as JsonSchemaObject).type === "null"
  );
}

export function leanJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => leanJsonSchema(entry));
  if (typeof schema !== "object" || schema === null) return schema;

  const result: JsonSchemaObject = {};
  for (const [key, value] of Object.entries(schema as JsonSchemaObject)) {
    if (DROPPED_KEYWORDS[key]) continue;
    if (
      key === "additionalProperties" &&
      (value === false ||
        (typeof value === "object" && value !== null && Object.keys(value).length === 0))
    ) {
      continue;
    }
    if (SCHEMA_MAP_KEYWORDS[key] && typeof value === "object" && value !== null) {
      result[key] = Object.fromEntries(
        Object.entries(value as JsonSchemaObject).map(([name, entry]) => [
          name,
          leanJsonSchema(entry),
        ]),
      );
      continue;
    }
    if (SCHEMA_LIST_KEYWORDS[key] && Array.isArray(value)) {
      result[key] = value.map((entry) => leanJsonSchema(entry));
      continue;
    }
    if (NESTED_SCHEMA_KEYWORDS[key]) {
      result[key] = leanJsonSchema(value);
      continue;
    }
    result[key] = value;
  }

  const branches = result.anyOf ?? result.oneOf;
  if (Array.isArray(branches) && branches.length === 2 && branches.some(isNullBranch)) {
    const alternative = branches.find((entry) => !isNullBranch(entry));
    if (alternative && typeof alternative === "object") {
      delete result.anyOf;
      delete result.oneOf;
      return { ...(alternative as JsonSchemaObject), ...result };
    }
  }

  return result;
}
