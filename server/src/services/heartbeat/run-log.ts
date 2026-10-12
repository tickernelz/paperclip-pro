import { appendWithByteCap, MAX_EXCERPT_BYTES, parseObject } from "../../adapters/utils.js";
import { redactRunLogChunkText } from "../../redaction.js";

const MAX_PERSISTED_LOG_CHUNK_CHARS = 64 * 1024;
const MAX_RUN_EVENT_PAYLOAD_STRING_CHARS = 16 * 1024;
const MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS = 50;
const MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS = 100;
const MAX_RUN_EVENT_PAYLOAD_DEPTH = 6;
const INLINE_BASE64_IMAGE_DATA_RE =
  /("type":"image","source":\{"type":"base64","data":")([A-Za-z0-9+/=]{1024,})(")/g;

export function appendExcerpt(prev: string, chunk: string) {
  return appendWithByteCap(prev, chunk, MAX_EXCERPT_BYTES);
}

function truncateRunEventString(value: string) {
  if (value.length <= MAX_RUN_EVENT_PAYLOAD_STRING_CHARS) return value;
  const omittedChars = value.length - MAX_RUN_EVENT_PAYLOAD_STRING_CHARS;
  return `${value.slice(0, MAX_RUN_EVENT_PAYLOAD_STRING_CHARS)}\n[truncated ${omittedChars} chars]`;
}

function boundRunEventValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return truncateRunEventString(value);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_RUN_EVENT_PAYLOAD_DEPTH) {
      return {
        _truncated: true,
        type: "array",
        originalLength: value.length,
      };
    }
    const bounded = value
      .slice(0, MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS)
      .map((entry) => boundRunEventValue(entry, depth + 1, seen));
    if (value.length > MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS) {
      bounded.push({
        _truncated: true,
        omittedItems: value.length - MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS,
      });
    }
    return bounded;
  }
  if (typeof value !== "object" || value === undefined) {
    return null;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  const entries = Object.entries(value as Record<string, unknown>);
  if (depth >= MAX_RUN_EVENT_PAYLOAD_DEPTH) {
    const bounded = {
      _truncated: true,
      type: "object",
      keys: entries.map(([key]) => key).slice(0, 20),
    };
    seen.delete(value);
    return bounded;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(
    0,
    MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS,
  )) {
    out[key] = boundRunEventValue(entryValue, depth + 1, seen);
  }
  if (entries.length > MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS) {
    out._truncated = true;
    out._omittedKeys = entries.length - MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS;
  }
  seen.delete(value);
  return out;
}

export function boundHeartbeatRunEventPayloadForStorage(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const bounded = boundRunEventValue(payload, 0, new WeakSet());
  return parseObject(bounded) ?? { _truncated: true };
}

function redactInlineBase64ImageData(chunk: string) {
  return chunk.replace(
    INLINE_BASE64_IMAGE_DATA_RE,
    (_match, prefix: string, data: string, suffix: string) =>
      `${prefix}[omitted base64 image data: ${data.length} chars]${suffix}`,
  );
}

const COMPACTED_LOG_LINE_MIN_CHARS = 256;
const COMPACTED_LOG_JSON_LADDER: { stringChars: number; arrayItems: number }[] = [
  { stringChars: 8192, arrayItems: 50 },
  { stringChars: 2048, arrayItems: 25 },
  { stringChars: 512, arrayItems: 10 },
  { stringChars: 128, arrayItems: 5 },
  { stringChars: 32, arrayItems: 2 },
  { stringChars: 0, arrayItems: 1 },
];
const COMPACTED_LOG_JSON_MAX_DEPTH = 24;

function shrinkLogJsonValue(
  value: unknown,
  limits: { stringChars: number; arrayItems: number },
  depth: number,
): unknown {
  if (typeof value === "string") {
    if (value.length <= limits.stringChars) return value;
    const kept = value.slice(0, limits.stringChars);
    return `${kept}[paperclip truncated ${value.length - kept.length} chars]`;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= COMPACTED_LOG_JSON_MAX_DEPTH) return "[paperclip truncated nested value]";
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, limits.arrayItems)
      .map((entry) => shrinkLogJsonValue(entry, limits, depth + 1));
    if (value.length > kept.length) {
      kept.push({ truncated: true, omittedItems: value.length - kept.length });
    }
    return kept;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = shrinkLogJsonValue(entry, limits, depth + 1);
  }
  return out;
}

const MINIMAL_LOG_JSON_KEYS: Record<string, true> = {
  type: true,
  toolCallId: true,
  toolName: true,
  sessionId: true,
  id: true,
};

function compactJsonLogLine(line: string, maxChars: number): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  for (const limits of COMPACTED_LOG_JSON_LADDER) {
    const shrunk: Record<string, unknown> = {};
    for (const [key, entry] of entries) shrunk[key] = shrinkLogJsonValue(entry, limits, 1);
    shrunk.truncated = true;
    shrunk.truncatedChars = line.length;
    const candidate = JSON.stringify(shrunk);
    if (candidate.length <= maxChars) return candidate;
  }
  const minimal: Record<string, unknown> = { truncated: true, truncatedChars: line.length };
  for (const [key, value] of entries) {
    if (!MINIMAL_LOG_JSON_KEYS[key]) continue;
    if (typeof value === "string" || typeof value === "number") minimal[key] = value;
  }
  return JSON.stringify(minimal);
}

function compactLogLine(line: string, maxChars: number) {
  if (line.length <= maxChars) return line;
  const json = compactJsonLogLine(line, maxChars);
  if (json !== null && json.length < line.length) return json;
  const headChars = Math.max(0, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(0, Math.floor(maxChars * 0.25));
  const omittedChars = Math.max(0, line.length - headChars - tailChars);
  const marker = `[paperclip truncated run log chunk: omitted ${omittedChars} chars]`;
  return `${line.slice(0, headChars)}${marker}${line.slice(line.length - tailChars)}`;
}

export function compactRunLogChunk(
  chunk: string,
  maxChars = MAX_PERSISTED_LOG_CHUNK_CHARS,
) {
  const normalized = redactRunLogChunkText(redactInlineBase64ImageData(chunk));
  if (normalized.length <= maxChars) return normalized;

  const lines = normalized.split("\n");
  let total = normalized.length;
  const guard = lines.length * COMPACTED_LOG_JSON_LADDER.length + 16;
  for (let step = 0; step < guard && total > maxChars; step += 1) {
    let longest = 0;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index]!.length > lines[longest]!.length) longest = index;
    }
    const line = lines[longest]!;
    const target = Math.max(COMPACTED_LOG_LINE_MIN_CHARS, line.length - (total - maxChars));
    if (target >= line.length) break;
    const compacted = compactLogLine(line, target);
    if (compacted.length >= line.length) break;
    lines[longest] = compacted;
    total -= line.length - compacted.length;
  }
  return lines.join("\n");
}
