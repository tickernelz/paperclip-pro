import type { TranscriptEntry } from "@tickernelz/paperclip-pro-adapter-utils";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function extractContent(content: unknown): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };

  let text = "";
  let thinking = "";
  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    if (block.type === "text") text += asString(block.text);
    if (block.type === "thinking") thinking += asString(block.thinking);
  }
  return { text, thinking };
}

function extractToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  const record = asRecord(result);
  const content = record ? record.content : result;
  const extracted = extractContent(content);
  if (extracted.text) return extracted.text;
  return stringify(result);
}

function isAssistantError(message: JsonRecord): boolean {
  return message.stopReason === "error"
    || message.stopReason === "aborted"
    || asString(message.errorMessage).length > 0;
}

function lastAssistant(messages: unknown[]): JsonRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (message && message.role === "assistant") return message;
  }
  return null;
}

function totalUsage(messages: unknown[]): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let costUsd = 0;

  for (const value of messages) {
    const message = asRecord(value);
    if (!message || message.role !== "assistant") continue;
    const usage = asRecord(message.usage);
    if (!usage) continue;
    inputTokens += asNumber(usage.input) || asNumber(usage.inputTokens);
    outputTokens += asNumber(usage.output) || asNumber(usage.outputTokens);
    cachedTokens += asNumber(usage.cacheRead) || asNumber(usage.cachedInputTokens);
    const cost = asRecord(usage.cost);
    costUsd += cost ? asNumber(cost.total) : asNumber(usage.costUsd);
  }

  return { inputTokens, outputTokens, cachedTokens, costUsd };
}

function parseAgentEnd(parsed: JsonRecord, ts: string): TranscriptEntry[] {
  if (parsed.willContinue === true) return [];
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const assistant = lastAssistant(messages);
  const usage = totalUsage(messages);
  const content = assistant ? extractContent(assistant.content) : { text: "", thinking: "" };
  const errorMessage = assistant ? asString(assistant.errorMessage) : "";
  const isError = assistant ? isAssistantError(assistant) : false;
  const subtype = assistant ? asString(assistant.stopReason, isError ? "error" : "end") : "end";

  return [{
    kind: "result",
    ts,
    text: errorMessage || content.text,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    costUsd: usage.costUsd,
    subtype,
    isError,
    errors: errorMessage ? [errorMessage] : [],
  }];
}

const REDACTED_LOG_MARKER = "***REDACTED***";
const REPAIR_MAX_STEPS = 16;

function jsonErrorPosition(line: string): number {
  try {
    JSON.parse(line);
    return -1;
  } catch (error) {
    const match = /position (\d+)/.exec(error instanceof Error ? error.message : String(error));
    return match ? Number(match[1]) : line.length;
  }
}

function markerPositions(line: string): number[] {
  const positions: number[] = [];
  let index = line.indexOf(REDACTED_LOG_MARKER);
  while (index >= 0) {
    positions.push(index);
    index = line.indexOf(REDACTED_LOG_MARKER, index + REDACTED_LOG_MARKER.length);
  }
  return positions;
}

function repairCandidates(line: string, at: number): string[] {
  const end = at + REDACTED_LOG_MARKER.length;
  const head = line.slice(0, end);
  const rest = line.slice(end);
  const candidates: string[] = [];
  if (rest.startsWith("\\\"")) candidates.push(`${head}"${rest.slice(2)}`);
  if (rest.startsWith("\"")) candidates.push(`${head}\\"${rest.slice(1)}`);
  if (rest.startsWith("}") || rest.startsWith("]") || rest.startsWith(",")) {
    candidates.push(`${head}"${rest}`);
  }
  return candidates;
}

/** Rebuild a JSON line whose escapes Paperclip's log redaction swallowed, or null when unrecoverable. */
function repairRedactedJsonLine(line: string): string | null {
  if (!line.includes(REDACTED_LOG_MARKER)) return null;
  let current = line;
  let position = jsonErrorPosition(current);
  if (position < 0) return current;

  for (let step = 0; step < REPAIR_MAX_STEPS; step += 1) {
    const markers = markerPositions(current);
    const preceding = markers.filter((marker) => marker <= position);
    const at: number | undefined = preceding.length > 0 ? preceding[preceding.length - 1] : markers[0];
    if (at === undefined) return null;

    let best: string | null = null;
    let bestPosition = position;
    for (const candidate of repairCandidates(current, at)) {
      const candidatePosition = jsonErrorPosition(candidate);
      if (candidatePosition < 0) return candidate;
      if (candidatePosition > bestPosition) {
        best = candidate;
        bestPosition = candidatePosition;
      }
    }
    if (best === null) return null;
    current = best;
    position = bestPosition;
  }
  return jsonErrorPosition(current) < 0 ? current : null;
}

const SALVAGE_EVENT_PREFIX = '{"type":"';
const SALVAGE_MAX_EVENTS = 8;

function balancedObjectEnd(line: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function salvageRedactedEvents(line: string): JsonRecord[] {
  if (!line.includes(REDACTED_LOG_MARKER)) return [];
  const events: JsonRecord[] = [];
  let cursor = line.indexOf(REDACTED_LOG_MARKER);
  while (cursor >= 0 && events.length < SALVAGE_MAX_EVENTS) {
    const start = line.indexOf(SALVAGE_EVENT_PREFIX, cursor + REDACTED_LOG_MARKER.length);
    if (start < 0) break;
    const end = balancedObjectEnd(line, start);
    if (end > start) {
      try {
        const event = asRecord(JSON.parse(line.slice(start, end)));
        if (event) events.push(event);
      } catch {
        break;
      }
    }
    cursor = line.indexOf(REDACTED_LOG_MARKER, start);
  }
  return events;
}

const BROKEN_TOOL_END_RE =
  /^\{"type":"tool_execution_end","toolCallId":"([^"\\]{1,200})"(?:,"toolName":"([^"\\]{1,200})")?/;

function settledToolEnd(line: string, ts: string): TranscriptEntry[] {
  const match = BROKEN_TOOL_END_RE.exec(line);
  if (!match) return [];
  return [{
    kind: "tool_result",
    ts,
    toolUseId: match[1]!,
    toolName: match[2] ?? "tool",
    content: "",
    isError: false,
  }];
}

function unreadableEntry(line: string, ts: string): TranscriptEntry[] {
  const match = /^\{"type":"([A-Za-z_]+)"/.exec(line);
  const kb = (line.length / 1024).toFixed(1);
  return [{
    kind: "system",
    ts,
    text: `Unreadable OMP event${match ? `: ${match[1]}` : ""} (${kb} KB) — Paperclip log redaction corrupted the JSON.`,
  }];
}

/** Parse one OMP JSONL stdout line into Paperclip transcript entries; stateless, so replay is stable. */
export function parseOmpStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const raw = (): TranscriptEntry[] => [{ kind: "stdout", ts, text: line }];

  let parsed: JsonRecord | null = null;
  try {
    parsed = asRecord(JSON.parse(line));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const repaired = repairRedactedJsonLine(line);
    if (repaired !== null) {
      try {
        parsed = asRecord(JSON.parse(repaired));
      } catch {
        parsed = null;
      }
    }
  }
  if (parsed) return parseOmpEvent(parsed, ts, raw);

  const salvaged = salvageRedactedEvents(line);
  if (salvaged.length > 0) return salvaged.flatMap((event) => parseOmpEvent(event, ts, raw));
  const settled = settledToolEnd(line, ts);
  if (settled.length > 0) return [...settled, ...unreadableEntry(line, ts)];
  return line.startsWith("{") ? unreadableEntry(line, ts) : raw();
}

function parseOmpEvent(
  parsed: JsonRecord,
  ts: string,
  raw: () => TranscriptEntry[],
): TranscriptEntry[] {
  try {
    const type = asString(parsed.type);

    if (type === "session" || type === "init") {
      const sessionId = asString(parsed.id) || asString(parsed.sessionId) || asString(parsed.session_id);
      if (!sessionId) return raw();
      const provider = asString(parsed.provider);
      const modelId = asString(parsed.model);
      const model = provider && modelId && !modelId.startsWith(`${provider}/`)
        ? `${provider}/${modelId}`
        : modelId;
      return [{ kind: "init", ts, model, sessionId }];
    }

    if (type === "thinking_level_changed") {
      const level = asString(parsed.thinkingLevel) || asString(parsed.resolved);
      return level ? [{ kind: "system", ts, text: `OMP thinking level: ${level}` }] : [];
    }

    if (type === "session_start") {
      return [{ kind: "system", ts, text: "OMP session started" }];
    }

    if (type === "agent_start") {
      return [{ kind: "system", ts, text: "OMP agent started" }];
    }

    if (type === "agent_end") {
      if (!Array.isArray(parsed.messages)) return raw();
      if (parsed.willContinue !== undefined && typeof parsed.willContinue !== "boolean") return raw();
      return parseAgentEnd(parsed, ts);
    }

    if (type === "message_update") {
      const event = asRecord(parsed.assistantMessageEvent);
      if (!event) return raw();
      const eventType = asString(event.type);
      if (eventType === "text_delta") {
        if (typeof event.delta !== "string") return raw();
        return event.delta ? [{ kind: "assistant", ts, text: event.delta, delta: true }] : [];
      }
      if (eventType === "thinking_delta") {
        if (typeof event.delta !== "string") return raw();
        return event.delta ? [{ kind: "thinking", ts, text: event.delta, delta: true }] : [];
      }
      if (eventType === "error") {
        const reason = asString(event.reason);
        return reason ? [{ kind: "stderr", ts, text: `OMP request ${reason}` }] : raw();
      }
      if (eventType === "start") return [];
      if (eventType === "text_start" || eventType === "thinking_start" || eventType === "toolcall_start") {
        return typeof event.contentIndex === "number" ? [] : raw();
      }
      if (eventType === "text_end" || eventType === "thinking_end") {
        return typeof event.contentIndex === "number" && typeof event.content === "string" ? [] : raw();
      }
      if (eventType === "image_end") {
        return typeof event.contentIndex === "number" && asRecord(event.content) ? [] : raw();
      }
      if (eventType === "toolcall_delta") {
        return typeof event.contentIndex === "number" && typeof event.delta === "string" ? [] : raw();
      }
      if (eventType === "toolcall_end") {
        return typeof event.contentIndex === "number" && asRecord(event.toolCall) ? [] : raw();
      }
      if (eventType === "done") return asString(event.reason) ? [] : raw();
      return raw();
    }

    if (type === "tool_execution_start") {
      const toolUseId = asString(parsed.toolCallId);
      if (!toolUseId) return raw();
      return [{ kind: "tool_call", ts, name: asString(parsed.toolName, "tool"), input: parsed.args, toolUseId }];
    }

    if (type === "tool_execution_end") {
      const toolUseId = asString(parsed.toolCallId);
      if (!toolUseId) return raw();
      return [{
        kind: "tool_result",
        ts,
        toolUseId,
        toolName: asString(parsed.toolName, "tool"),
        content: parsed.result === undefined ? "" : extractToolResult(parsed.result),
        isError: parsed.isError === true,
      }];
    }

    if (type === "result") {
      const hasPayload = [
        "text", "result", "subtype", "isError", "errors",
        "inputTokens", "outputTokens", "cachedTokens", "costUsd",
      ].some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
      if (!hasPayload) return raw();
      const errors = Array.isArray(parsed.errors)
        ? parsed.errors.filter((error): error is string => typeof error === "string")
        : [];
      return [{
        kind: "result",
        ts,
        text: asString(parsed.text) || asString(parsed.result),
        inputTokens: asNumber(parsed.inputTokens),
        outputTokens: asNumber(parsed.outputTokens),
        cachedTokens: asNumber(parsed.cachedTokens),
        costUsd: asNumber(parsed.costUsd),
        subtype: asString(parsed.subtype, parsed.isError === true ? "error" : "end"),
        isError: parsed.isError === true,
        errors,
      }];
    }

    if (type === "message_end" || type === "turn_end") {
      const message = asRecord(parsed.message);
      if (!message) return raw();
      if (message.role === "assistant" && isAssistantError(message)) {
        const reason = asString(message.errorMessage) || `OMP request ${asString(message.stopReason, "error")}`;
        return [{ kind: "stderr", ts, text: reason }];
      }
      return [];
    }

    if (type === "notice") {
      const text = asString(parsed.message);
      if (!text || (parsed.level !== "info" && parsed.level !== "warning" && parsed.level !== "error")) return raw();
      return parsed.level === "error"
        ? [{ kind: "stderr", ts, text }]
        : [{ kind: "system", ts, text }];
    }

    if (type === "auto_retry_start") {
      const message = asString(parsed.errorMessage);
      return message ? [{ kind: "system", ts, text: message }] : raw();
    }

    if (type === "auto_retry_end") {
      if (typeof parsed.success !== "boolean") return raw();
      if (parsed.success) return [];
      return [{ kind: "stderr", ts, text: asString(parsed.finalError, "OMP request retry failed") }];
    }

    if (type === "error" || type === "extension_error") {
      const text = asString(parsed.error)
        || asString(parsed.message)
        || asString(parsed.reason);
      return text ? [{ kind: "stderr", ts, text }] : raw();
    }

    if (type === "session_shutdown") {
      return [{ kind: "system", ts, text: "OMP session stopped" }];
    }

    if (type === "turn_start") return [];
    if (type === "message_start") return asRecord(parsed.message) ? [] : raw();
    if (type === "tool_execution_update") {
      const toolCallId = asString(parsed.toolCallId);
      const toolName = asString(parsed.toolName);
      if (!toolCallId || !toolName) return raw();
      const partialRec = asRecord(parsed.partialResult);
      let progressText = "";
      if (partialRec) {
        const detailsRec = asRecord(partialRec.details);
        if (typeof partialRec.progress === "string" && partialRec.progress.trim()) {
          progressText = partialRec.progress.trim();
        } else if (detailsRec && typeof detailsRec.progress === "string" && detailsRec.progress.trim()) {
          progressText = detailsRec.progress.trim();
        } else if (typeof partialRec.output === "string" && partialRec.output.trim()) {
          progressText = partialRec.output.trim();
        }
      } else if (typeof parsed.partialResult === "string" && parsed.partialResult.trim()) {
        progressText = parsed.partialResult.trim();
      }
      if (progressText) {
        return [{
          kind: "tool_result",
          ts: asString(parsed.timestamp, ts),
          toolUseId: toolCallId,
          toolName: toolName,
          content: progressText,
          isError: false,
          delta: true,
        }];
      }
      return [];
    }
    if (type === "session_stop") {
      return Array.isArray(parsed.messages) && asString(parsed.session_id) ? [] : raw();
    }

    return raw();
  } catch {
    return raw();
  }
}
