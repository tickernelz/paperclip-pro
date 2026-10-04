import { SECRET_FIELD_NAME_PATTERN } from "../../redaction.js";

export const OPENWA_REDACTED = "[REDACTED]";

const SECRET_KEY = new RegExp(
  String.raw`^(?:${SECRET_FIELD_NAME_PATTERN}|[A-Za-z0-9_-]*pairing[-_]?code[A-Za-z0-9_-]*|qr[A-Za-z0-9_-]*)$`,
  "i",
);
const AUTHOR_WORD = /unauthori[sz]ed|author(?!i[sz]ation)/gi;
const HEADERS_KEY = /headers$/i;
const KEY_PREFIX = "owa_k1_";
const REDACT_DEPTH = 32;

function secretKey(name: string): boolean {
  return HEADERS_KEY.test(name) || SECRET_KEY.test(name.replace(AUTHOR_WORD, ""));
}

function redact(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.startsWith(KEY_PREFIX) ? OPENWA_REDACTED : value;
  if (!value || typeof value !== "object") return value;
  if (depth >= REDACT_DEPTH) return OPENWA_REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) out[name] = secretKey(name) ? OPENWA_REDACTED : redact(entry, depth + 1);
  return out;
}

export function redactOpenwaSecrets<T>(value: T): T {
  return redact(value, 0) as T;
}
