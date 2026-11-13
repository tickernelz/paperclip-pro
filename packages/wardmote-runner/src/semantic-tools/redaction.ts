import type { CapabilityJsonValue } from "../mock-core/capability-control-plane-types.js";
import type { WardmoteJsonValue } from "../catalog/semantic-action-types.js";

export const CAPABILITY_REDACTED = "[REDACTED]";

export function redactSemanticValue(value: unknown, key = ""): CapabilityJsonValue {
  if (key.length === 0) {
    return redactWardmoteSemanticValue(value) as CapabilityJsonValue;
  }
  const wrapped = redactWardmoteSemanticValue({ [key]: value });
  if (typeof wrapped !== "object" || wrapped === null || Array.isArray(wrapped)) {
    return CAPABILITY_REDACTED;
  }
  const object = wrapped as { readonly [entryKey: string]: WardmoteJsonValue };
  return (object[key] ?? CAPABILITY_REDACTED) as CapabilityJsonValue;
}

const WARDMOTE_SENSITIVE_KEY =
  /(?:authorization(?:[-_]?code)?|cookie|credentials?|passwords?|passwd|private.?key|secrets?|token|api.?key|connection.?string)(?:[-_]?(?:value|header|prod(?:uction)?|dev(?:elopment)?|test|staging|primary|secondary))*$/i;
const WARDMOTE_SECRET_VALUE =
  /(?:\bBearer\s+(?!(?:tokens?|authentication|authorization|credentials?|schemes?|flows?)[.,;:!?]?(?:\s|$))[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|pcgw|ghp|github_pat)_[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gi;
const WARDMOTE_SECRET_QUERY =
  /([?&](?:code|key|secret|state|token|api[_-]?key|access[_-]?token)=)[^&#\s]+/gi;
const WARDMOTE_WARDMOTE_SECRET_QUERY_DETECT =
  /[?&](?:code|key|secret|state|token|api[_-]?key|access[_-]?token)=[^&#\s]+/i;

const WARDMOTE_MAX_DEPTH = 16;
const WARDMOTE_MAX_NODES = 10_000;
const WARDMOTE_MAX_ARRAY_ITEMS = 512;
const WARDMOTE_MAX_OBJECT_KEYS = 512;
const WARDMOTE_MAX_STRING_LENGTH = 200_000;

export const WARDMOTE_SEMANTIC_REDACTED = "[REDACTED]";
export const WARDMOTE_SEMANTIC_TRUNCATED = "[TRUNCATED]";

export interface WardmoteSemanticValueSafety {
  readonly containsProtectedData: boolean;
  readonly withinBounds: boolean;
}

export function inspectWardmoteSemanticValue(
  value: unknown,
): WardmoteSemanticValueSafety {
  return inspectValueSafety(value, true);
}

/** Validate transport bounds without inspecting credential content. */
export function isWardmoteSemanticValueWithinBounds(value: unknown): boolean {
  return inspectValueSafety(value, false).withinBounds;
}

function inspectValueSafety(
  value: unknown,
  detectCredentials: boolean,
): WardmoteSemanticValueSafety {
  const state = { nodes: 0, protected: false, withinBounds: true, detectCredentials };
  inspect(value, "", 0, state, new Set<object>());
  return Object.freeze({
    containsProtectedData: state.protected,
    withinBounds: state.withinBounds,
  });
}

export function redactWardmoteSemanticValue(
  value: unknown,
): WardmoteJsonValue {
  const state = { nodes: 0 };
  return redact(value, "", 0, state, new Set<object>());
}

function inspect(
  value: unknown,
  key: string,
  depth: number,
  state: {
    nodes: number;
    protected: boolean;
    withinBounds: boolean;
    detectCredentials: boolean;
  },
  ancestors: Set<object>,
): void {
  state.nodes += 1;
  if (state.nodes > WARDMOTE_MAX_NODES || depth > WARDMOTE_MAX_DEPTH) {
    state.withinBounds = false;
    return;
  }
  if (state.detectCredentials && WARDMOTE_SENSITIVE_KEY.test(key)) {
    state.protected = true;
  }
  if (typeof value === "string") {
    if (value.length > WARDMOTE_MAX_STRING_LENGTH) state.withinBounds = false;
    WARDMOTE_SECRET_VALUE.lastIndex = 0;
    if (
      state.detectCredentials &&
      (WARDMOTE_SECRET_VALUE.test(value) || WARDMOTE_WARDMOTE_SECRET_QUERY_DETECT.test(value))
    ) {
      state.protected = true;
    }
    WARDMOTE_SECRET_VALUE.lastIndex = 0;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > WARDMOTE_MAX_ARRAY_ITEMS) state.withinBounds = false;
    if (ancestors.has(value)) {
      state.withinBounds = false;
      return;
    }
    ancestors.add(value);
    for (const child of value.slice(0, WARDMOTE_MAX_ARRAY_ITEMS)) {
      inspect(child, "", depth + 1, state, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) {
      state.withinBounds = false;
      return;
    }
    const entries = Object.entries(value);
    if (entries.length > WARDMOTE_MAX_OBJECT_KEYS) state.withinBounds = false;
    ancestors.add(value);
    for (const [childKey, child] of entries.slice(0, WARDMOTE_MAX_OBJECT_KEYS)) {
      inspect(child, childKey, depth + 1, state, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (
    value !== null &&
    typeof value !== "number" &&
    typeof value !== "boolean" &&
    typeof value !== "undefined"
  ) {
    state.withinBounds = false;
  }
}

function redact(
  value: unknown,
  key: string,
  depth: number,
  state: { nodes: number },
  ancestors: Set<object>,
): WardmoteJsonValue {
  state.nodes += 1;
  if (state.nodes > WARDMOTE_MAX_NODES || depth > WARDMOTE_MAX_DEPTH) {
    return WARDMOTE_SEMANTIC_TRUNCATED;
  }
  if (WARDMOTE_SENSITIVE_KEY.test(key)) return WARDMOTE_SEMANTIC_REDACTED;
  if (typeof value === "string") {
    WARDMOTE_SECRET_VALUE.lastIndex = 0;
    const redacted = value
      .replace(WARDMOTE_SECRET_VALUE, WARDMOTE_SEMANTIC_REDACTED)
      .replace(WARDMOTE_SECRET_QUERY, `$1${WARDMOTE_SEMANTIC_REDACTED}`);
    WARDMOTE_SECRET_VALUE.lastIndex = 0;
    return redacted.length <= WARDMOTE_MAX_STRING_LENGTH
      ? redacted
      : `${redacted.slice(0, WARDMOTE_MAX_STRING_LENGTH)}${WARDMOTE_SEMANTIC_TRUNCATED}`;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return WARDMOTE_SEMANTIC_TRUNCATED;
    ancestors.add(value);
    const result = value
      .slice(0, WARDMOTE_MAX_ARRAY_ITEMS)
      .map((child) => redact(child, "", depth + 1, state, ancestors));
    ancestors.delete(value);
    if (value.length > WARDMOTE_MAX_ARRAY_ITEMS) {
      result.push(WARDMOTE_SEMANTIC_TRUNCATED);
    }
    return result;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) return WARDMOTE_SEMANTIC_TRUNCATED;
    ancestors.add(value);
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, WARDMOTE_MAX_OBJECT_KEYS)
      .map(
        ([childKey, child]) =>
          [
            childKey,
            redact(child, childKey, depth + 1, state, ancestors),
          ] as const,
      );
    ancestors.delete(value);
    const result: Record<string, WardmoteJsonValue> =
      Object.fromEntries(entries);
    if (Object.keys(value).length > WARDMOTE_MAX_OBJECT_KEYS) {
      result.__wardmote_truncated__ = WARDMOTE_SEMANTIC_TRUNCATED;
    }
    return result;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return WARDMOTE_SEMANTIC_TRUNCATED;
}
