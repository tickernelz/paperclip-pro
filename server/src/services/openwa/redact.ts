export const OPENWA_REDACTED = "[REDACTED]";

const SECRET_KEYS: ReadonlySet<string> = new Set([
  "apikey",
  "api_key",
  "secret",
  "clientsecret",
  "verifytoken",
  "token",
  "accesstoken",
  "refreshtoken",
  "password",
  "pairingcode",
  "qr",
  "qrcode",
]);
const KEY_PREFIX = "owa_k1_";
const QR_KEY = /^qr/i;
const IMAGE_DATA_URL = /^data:image\/[^;,]{1,100};base64,/i;
const REDACT_DEPTH = 32;

function redactString(key: string | null, value: string): string {
  if (value.startsWith(KEY_PREFIX)) return OPENWA_REDACTED;
  if (key !== null && QR_KEY.test(key) && IMAGE_DATA_URL.test(value)) return OPENWA_REDACTED;
  return value;
}

function redact(key: string | null, value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactString(key, value);
  if (!value || typeof value !== "object") return value;
  if (depth >= REDACT_DEPTH) return OPENWA_REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redact(key, entry, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) out[name] = SECRET_KEYS.has(name.toLowerCase()) ? OPENWA_REDACTED : redact(name, entry, depth + 1);
  return out;
}

export function redactOpenwaSecrets<T>(value: T): T {
  return redact(null, value, 0) as T;
}
