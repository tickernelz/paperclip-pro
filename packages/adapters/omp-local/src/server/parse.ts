import { repairRedactedJsonLine, salvageRedactedEvents } from "./redaction-repair.js";

export interface ParsedOmpToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result: unknown | null;
  isError: boolean;
}

export interface ParsedOmpOutput {
  sessionId: string | null;
  messages: string[];
  finalMessage: string | null;
  errors: string[];
  provider: string | null;
  model: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
  costUsd: number;
  toolCalls: ParsedOmpToolCall[];
  /** Truncated sample of malformed lines and event types this adapter does not interpret. */
  unknownLines: string[];
}

const BROKEN_TOOL_END_RE =
  /^\{"type":"tool_execution_end","toolCallId":"([^"\\]{1,200})"(?:,"toolName":"([^"\\]{1,200})")?/;
const UNKNOWN_LINE_LIMIT = 50;
const UNKNOWN_LINE_CHARS = 200;

type JsonObject = Record<string, unknown>;
type UsageTotals = ParsedOmpOutput["usage"] & { costUsd: number };

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const item of content) {
    const block = object(item);
    if (block?.type === "text" && typeof block.text === "string") text += block.text;
  }
  return text;
}

function usageFromMessage(message: JsonObject): UsageTotals | null {
  const usage = object(message.usage);
  if (!usage) return null;
  const cost = object(usage.cost);
  return {
    inputTokens: number(usage.inputTokens ?? usage.input),
    outputTokens: number(usage.outputTokens ?? usage.output),
    cachedInputTokens: number(usage.cachedInputTokens ?? usage.cacheRead),
    costUsd: number(usage.costUsd ?? cost?.total),
  };
}

function addUsage(target: UsageTotals, value: UsageTotals): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.costUsd += value.costUsd;
}

function messageKey(message: JsonObject): string {
  const timestamp = message.timestamp;
  if (typeof timestamp === "number" || typeof timestamp === "string") {
    return `${message.role ?? ""}:${timestamp}`;
  }
  return JSON.stringify([
    message.role,
    message.provider,
    message.model,
    message.stopReason,
    message.usage,
    message.content,
  ]);
}

function resultValue(value: unknown): unknown | null {
  return value === undefined ? null : value;
}

function parseJsonObject(line: string): JsonObject | null {
  try {
    return object(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

export function parseOmpJsonLine(line: string): JsonObject | null {
  const direct = parseJsonObject(line);
  if (direct) return direct;
  const repaired = repairRedactedJsonLine(line);
  return repaired === null ? null : parseJsonObject(repaired);
}

const OMP_STARTUP_COMPLETE_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
  "result",
  "error",
]);

export function isOmpStartupComplete(stdoutLine: string): boolean {
  const event = parseOmpJsonLine(stdoutLine);
  const eventType = typeof event?.type === "string" ? event.type : null;
  return eventType !== null && OMP_STARTUP_COMPLETE_EVENT_TYPES.has(eventType);
}

export interface OmpOutputAccumulator {
  push(rawLine: string, event?: JsonObject | null): void;
  result(): ParsedOmpOutput;
}

export function createOmpOutputAccumulator(): OmpOutputAccumulator {
  const toolCalls = new Map<string, ParsedOmpToolCall>();
  const toolCallList: ParsedOmpToolCall[] = [];
  const messageTexts = new Map<string, string>();
  const messageUsage = new Map<string, UsageTotals>();
  const turnUsageKeys = new Set<string>();
  const explicitUsage: UsageTotals[] = [];
  const unknownKept: string[] = [];
  let unknownDropped = 0;
  let unknownDroppedBytes = 0;
  let terminalError: string | null = null;
  let sessionId: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let finalMessage: string | null = null;

  const recordUnknown = (line: string): void => {
    if (unknownKept.length < UNKNOWN_LINE_LIMIT) {
      unknownKept.push(
        line.length > UNKNOWN_LINE_CHARS
          ? `${line.slice(0, UNKNOWN_LINE_CHARS)}… (${line.length} bytes)`
          : line,
      );
      return;
    }
    unknownDropped += 1;
    unknownDroppedBytes += line.length;
  };

  const readAssistant = (value: unknown, collectMessage: boolean): JsonObject | null => {
    const message = object(value);
    if (!message || message.role !== "assistant") return null;
    const messageProvider = string(message.provider).trim();
    const messageModel = string(message.model).trim();
    if (messageProvider) provider = messageProvider;
    if (messageModel) model = messageModel;

    const text = textContent(message.content);
    if (text) {
      finalMessage = text;
      if (collectMessage) messageTexts.set(messageKey(message), text);
    }

    const stopReason = string(message.stopReason).trim();
    if (stopReason === "error" || stopReason === "aborted") {
      const messageError = string(message.errorMessage).trim() || `OMP request ${stopReason}.`;
      if (!terminalError || !terminalError.includes(messageError)) terminalError = messageError;
    } else if (stopReason && stopReason !== "unknown") {
      terminalError = null;
    }
    return message;
  };

  const push = (rawLine: string, parsedEvent?: JsonObject | null): void => {
    const line = rawLine.trim();
    if (!line) return;
    const event = parsedEvent === undefined ? parseOmpJsonLine(line) : parsedEvent;
    if (!event) {
      const salvaged = salvageRedactedEvents(line);
      if (salvaged.length === 0) {
        recordUnknown(rawLine);
        settleBrokenToolEnd(line);
        return;
      }
      for (const recovered of salvaged) handleEvent(recovered, rawLine);
      return;
    }

    handleEvent(event, rawLine);
  };

  const settleBrokenToolEnd = (line: string): void => {
    const match = BROKEN_TOOL_END_RE.exec(line);
    if (!match) return;
    const id = match[1]!;
    const existing = toolCalls.get(id);
    if (existing) {
      if (existing.result === null) existing.result = "";
      return;
    }
    const call: ParsedOmpToolCall = {
      toolCallId: id,
      toolName: match[2] ?? "",
      args: null,
      result: "",
      isError: false,
    };
    toolCalls.set(id, call);
    toolCallList.push(call);
  };

  const handleEvent = (event: JsonObject, rawLine: string): void => {
    const type = string(event.type);
    let handled = true;
    switch (type) {
      case "session": {
        const id = string(event.id ?? event.sessionId ?? event.session_id).trim();
        if (id) sessionId = id;
        break;
      }
      case "session_start": {
        const id = string(event.sessionId ?? event.session_id ?? event.id).trim();
        if (id) sessionId = id;
        break;
      }
      case "message_start":
        readAssistant(event.message, false);
        break;
      case "message_end": {
        const message = readAssistant(event.message, true);
        if (message) {
          const usage = usageFromMessage(message);
          if (usage) messageUsage.set(messageKey(message), usage);
        }
        break;
      }
      case "turn_end": {
        const message = readAssistant(event.message, true);
        if (message) {
          const key = messageKey(message);
          const usage = usageFromMessage(message);
          if (usage) messageUsage.set(key, usage);
          turnUsageKeys.add(key);
        }
        const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
        for (const value of toolResults) {
          const toolResult = object(value);
          if (!toolResult) continue;
          const id = string(toolResult.toolCallId).trim();
          if (!id) continue;
          const existing = toolCalls.get(id);
          if (existing) {
            existing.result = resultValue(toolResult.content ?? toolResult.result);
            existing.isError = toolResult.isError === true;
          }
        }
        break;
      }
      case "agent_end": {
        if (Array.isArray(event.messages)) {
          for (let index = event.messages.length - 1; index >= 0; index -= 1) {
            if (readAssistant(event.messages[index], false)) break;
          }
        }
        break;
      }
      case "message_update":
      case "agent_start":
      case "turn_start":
      case "tool_execution_update":
      case "auto_retry_start":
      case "auto_compaction_start":
      case "auto_compaction_end":
      case "retry_fallback_applied":
      case "retry_fallback_succeeded":
      case "thinking_level_changed":
      case "ttsr_triggered":
      case "todo_reminder":
      case "todo_auto_clear":
      case "irc_message":
      case "goal_updated":
      case "notice":
        break;
      case "auto_retry_end":
        if (event.success === false) {
          terminalError = string(event.finalError).trim() || "OMP exhausted automatic retries without producing a response.";
        } else if (event.success === true) {
          terminalError = null;
        }
        break;
      case "tool_execution_start": {
        const id = string(event.toolCallId).trim();
        const name = string(event.toolName).trim();
        if (!id && !name) break;
        const key = id || `anonymous-${toolCallList.length + 1}`;
        const call: ParsedOmpToolCall = {
          toolCallId: id,
          toolName: name,
          args: event.args,
          result: null,
          isError: false,
        };
        toolCalls.set(key, call);
        toolCallList.push(call);
        break;
      }
      case "tool_execution_end": {
        const id = string(event.toolCallId).trim();
        const existing = toolCalls.get(id);
        if (existing) {
          existing.result = resultValue(event.result);
          existing.isError = event.isError === true;
        } else {
          const call: ParsedOmpToolCall = {
            toolCallId: id,
            toolName: string(event.toolName).trim(),
            args: null,
            result: resultValue(event.result),
            isError: event.isError === true,
          };
          toolCalls.set(id || `anonymous-end-${toolCallList.length + 1}`, call);
          toolCallList.push(call);
        }
        break;
      }
      case "usage": {
        const usage = object(event.usage) ?? event;
        const cost = object(usage.cost);
        explicitUsage.push({
          inputTokens: number(usage.inputTokens ?? usage.input),
          outputTokens: number(usage.outputTokens ?? usage.output),
          cachedInputTokens: number(usage.cachedInputTokens ?? usage.cacheRead),
          costUsd: number(usage.costUsd ?? cost?.total),
        });
        break;
      }
      case "error": {
        const message = string(event.message ?? event.error).trim();
        if (message) terminalError = message;
        break;
      }
      default:
        handled = false;
    }
    if (!handled) recordUnknown(rawLine);
  };

  const result = (): ParsedOmpOutput => {
    const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 };
    const selectedUsageKeys = turnUsageKeys.size > 0 ? turnUsageKeys : new Set(messageUsage.keys());
    for (const key of selectedUsageKeys) {
      const usage = messageUsage.get(key);
      if (usage) addUsage(totals, usage);
    }
    if (selectedUsageKeys.size === 0) {
      for (const usage of explicitUsage) addUsage(totals, usage);
    }
    return {
      sessionId,
      messages: [...messageTexts.values()],
      finalMessage,
      errors: terminalError ? [terminalError] : [],
      provider,
      model,
      usage: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cachedInputTokens: totals.cachedInputTokens,
      },
      costUsd: totals.costUsd,
      toolCalls: toolCallList,
      unknownLines: unknownDropped > 0
        ? [...unknownKept, `… ${unknownDropped} more unparsed lines (${unknownDroppedBytes} bytes)`]
        : unknownKept,
    };
  };

  return { push, result };
}

export interface OmpAccounting {
  usage: ParsedOmpOutput["usage"] | null;
  usageReported: boolean;
  usageComplete: boolean;
  costUsd: number | null;
  provider: string | null;
  model: string | null;
}

type AccountingTotals = UsageTotals;

function readCounter(source: JsonObject, keys: string[]): { valid: boolean; value: number | null } {
  for (const key of keys) {
    if (!(key in source) || source[key] === undefined) continue;
    const raw = source[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return { valid: false, value: null };
    return { valid: true, value: raw };
  }
  return { valid: true, value: null };
}

function addAccounting(target: AccountingTotals, value: AccountingTotals): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.costUsd += value.costUsd;
}

export function createOmpJsonlParser() {
  const messageUsage = new Map<string, AccountingTotals>();
  const turnUsageKeys = new Set<string>();
  const explicitUsage: AccountingTotals[] = [];
  let sawAgentEnd = false;
  let usageReported = false;
  let invalidUsage = false;
  let provider: string | null = null;
  let model: string | null = null;

  let currentCallCostSeen = false;
  function readUsage(source: JsonObject): AccountingTotals | null {
    const input = readCounter(source, ["inputTokens", "input"]);
    const output = readCounter(source, ["outputTokens", "output"]);
    const cached = readCounter(source, ["cachedInputTokens", "cacheRead"]);
    const cacheWrite = readCounter(source, ["cacheWriteTokens", "cacheWrite", "cacheCreationInputTokens"]);
    const costObject = object(source.cost);
    const cost = costObject ? readCounter(costObject, ["total"]) : readCounter(source, ["costUsd"]);
    if (!input.valid || !output.valid || !cached.valid || !cacheWrite.valid || !cost.valid) invalidUsage = true;
    if (input.value === null && output.value === null && cached.value === null
      && cacheWrite.value === null && cost.value === null) {
      return null;
    }
    usageReported = true;
    if (cost.value !== null) currentCallCostSeen = true;
    return {
      inputTokens: input.value ?? 0,
      outputTokens: output.value ?? 0,
      cachedInputTokens: cached.value ?? 0,
      costUsd: cost.value ?? 0,
    };
  }

  function readAssistantMessage(value: unknown): JsonObject | null {
    const message = object(value);
    if (!message || message.role !== "assistant") return null;
    const messageProvider = string(message.provider).trim();
    const messageModel = string(message.model).trim();
    if (messageProvider) provider = messageProvider;
    if (messageModel) model = messageModel;
    return message;
  }

  return (stdout: string): OmpAccounting => {
    currentCallCostSeen = false;
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const event = parseOmpJsonLine(line);
      if (!event) continue;
      const type = string(event.type);
      if (type === "agent_end") {
        sawAgentEnd = true;
        const messages = Array.isArray(event.messages) ? event.messages : [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = readAssistantMessage(messages[index]);
          if (message) break;
        }
        continue;
      }
      if (type === "message_end" || type === "turn_end") {
        const message = readAssistantMessage(event.message);
        if (message) {
          const usage = object(message.usage);
          const totals = usage ? readUsage(usage) : null;
          if (totals) {
            messageUsage.set(messageKey(message), totals);
            if (type === "turn_end") turnUsageKeys.add(messageKey(message));
          }
        }
        continue;
      }
      if (type === "usage") {
        const usage = object(event.usage) ?? event;
        const totals = readUsage(usage);
        if (totals) explicitUsage.push(totals);
        continue;
      }
    }

    const totals: AccountingTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 };
    const selectedKeys = turnUsageKeys.size > 0 ? turnUsageKeys : new Set(messageUsage.keys());
    for (const key of selectedKeys) {
      const usage = messageUsage.get(key);
      if (usage) addAccounting(totals, usage);
    }
    if (selectedKeys.size === 0) {
      for (const usage of explicitUsage) addAccounting(totals, usage);
    }
    return {
      usage: usageReported
        ? {
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            cachedInputTokens: totals.cachedInputTokens,
          }
        : null,
      usageReported,
      usageComplete: usageReported && !invalidUsage && sawAgentEnd,
      costUsd: sawAgentEnd && !currentCallCostSeen ? null : totals.costUsd,
      provider,
      model,
    };
  };
}

export function parseOmpJsonl(stdout: string): ParsedOmpOutput {
  const accumulator = createOmpOutputAccumulator();
  for (const rawLine of stdout.split(/\r?\n/)) accumulator.push(rawLine);
  return accumulator.result();
}

export function isOmpUnknownSessionError(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`;
  return (
    /Session\s+["'][^"'\r\n]+["']\s+not found\.?/i.test(text) ||
    /unknown\s+(?:OMP\s+)?session\b/i.test(text) ||
    /could not (?:find|resolve)\s+(?:the\s+)?session\b/i.test(text)
  );
}
