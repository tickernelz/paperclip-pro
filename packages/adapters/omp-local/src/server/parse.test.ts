import { describe, expect, it } from "vitest";
import { classifyOmpFailure } from "./failure.js";
import { createOmpJsonlParser, createOmpOutputAccumulator } from "./parse.js";

const CAPTURED_TOOL_START = "{\"type\":\"tool_execution_start\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"intent\":\"Echoing alpha string again\"}";
const CAPTURED_TOOL_PROGRESS = "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":69.76190599999973}}}";
const CAPTURED_TOOL_END = "{\"type\":\"tool_execution_end\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":69.76190599999973}},\"isError\":false}";

function glueLikeLogRedaction(swallowedLine: string, followingLine: string): string {
  return `${swallowedLine.slice(0, swallowedLine.indexOf('"partialResult"'))}"***REDACTED***"${followingLine}`;
}

describe("createOmpOutputAccumulator redaction salvage", () => {
  it("settles a tool call whose end log redaction glued onto the previous line", () => {
    const accumulator = createOmpOutputAccumulator();

    accumulator.push(CAPTURED_TOOL_START);
    accumulator.push(glueLikeLogRedaction(CAPTURED_TOOL_PROGRESS, CAPTURED_TOOL_END));

    const { toolCalls, unknownLines } = accumulator.result();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ toolCallId: "call_455341", toolName: "bash", isError: false });
    expect(toolCalls[0]!.result).not.toBeNull();
    expect(unknownLines).toEqual([]);
  });

  it("settles a tool call whose end payload is unrecoverable", () => {
    const accumulator = createOmpOutputAccumulator();

    accumulator.push(CAPTURED_TOOL_START);
    accumulator.push("{\"type\":\"tool_execution_end\",\"toolCallId\":\"call_455341\",\"toolName\":\"fabric_exec\",\"result\":{\"content\":");

    const { toolCalls } = accumulator.result();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.result).not.toBeNull();
  });
});

describe("createOmpOutputAccumulator retry exhaustion", () => {
  const providerError = "400 credit insufficient balance: balance=14655 required=14892 (request id: r1)";
  const failedAssistant = {
    role: "assistant",
    content: [],
    provider: "tiprouter",
    model: "deepseek-v4.1-flash",
    stopReason: "error",
    errorMessage: providerError,
  };
  const finalError = `Provider requested 1800000ms wait, exceeds retry.maxDelayMs (300000ms). Original error: ${providerError}`;

  it("keeps OMP's retry verdict when agent_end replays the failed message", () => {
    const accumulator = createOmpOutputAccumulator();
    accumulator.push(JSON.stringify({ type: "message_end", message: failedAssistant }));
    accumulator.push(JSON.stringify({ type: "auto_retry_end", success: false, attempt: 1, finalError }));
    accumulator.push(JSON.stringify({ type: "agent_end", messages: [failedAssistant] }));

    const [parsedError] = accumulator.result().errors;
    expect(parsedError).toBe(finalError);
    const before = Date.now();
    const classified = classifyOmpFailure({
      parsedError: parsedError!,
      stderr: "",
      timedOut: false,
      exitCode: 1,
      signal: null,
    });
    expect(classified.errorFamily).toBe("provider_quota");
    expect(Date.parse(classified.retryNotBefore ?? "") - before).toBeGreaterThanOrEqual(1_800_000 - 1_000);
  });

  it("reports a later, different failure instead of the earlier retry verdict", () => {
    const accumulator = createOmpOutputAccumulator();
    accumulator.push(JSON.stringify({ type: "auto_retry_end", success: false, attempt: 1, finalError }));
    accumulator.push(JSON.stringify({
      type: "message_end",
      message: { ...failedAssistant, errorMessage: "tool crashed unexpectedly" },
    }));

    expect(accumulator.result().errors).toEqual(["tool crashed unexpectedly"]);
  });
});


describe("createOmpJsonlParser accounting", () => {
  const turnEnd = (usage: Record<string, number> | null) => JSON.stringify({
    type: "turn_end",
    message: { role: "assistant", provider: "tiprouter", model: "deepseek-v4.1-flash", content: [], ...(usage ? { usage } : {}) },
  });
  const agentEnd = JSON.stringify({ type: "agent_end", messages: [] });

  it("retains partial usage without defaulting an absent counter to zero", () => {
    const parser = createOmpJsonlParser();
    const parsed = parser(turnEnd({ inputTokens: 10, outputTokens: 3 }) + "\n" + agentEnd);
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 3, cachedInputTokens: 0 });
    expect(parsed.usageReported).toBe(true);
    expect(parsed.usageComplete).toBe(true);
  });

  it("keeps usage incomplete when no terminal event closed the turn", () => {
    const parser = createOmpJsonlParser();
    expect(parser(turnEnd({ inputTokens: 10, outputTokens: 3 })).usageComplete).toBe(false);
  });

  it("distinguishes an absent cost from a reported zero", () => {
    const parser = createOmpJsonlParser();
    expect(parser(turnEnd({ inputTokens: 1, outputTokens: 1, costUsd: 0 }) + "\n" + agentEnd).costUsd).toBe(0);
    expect(parser(turnEnd({ inputTokens: 1, outputTokens: 1 }) + "\n" + agentEnd).costUsd).toBeNull();
  });

  it("marks usage incomplete when a later record carries an invalid counter", () => {
    const parser = createOmpJsonlParser();
    const parsed = parser(turnEnd({ inputTokens: 10, outputTokens: 3 }) + "\n"
      + JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { inputTokens: -1 } } })
      + "\n" + agentEnd);
    expect(parsed.usageReported).toBe(true);
    expect(parsed.usageComplete).toBe(false);
  });

  it("replaces a repeated message snapshot instead of double-counting", () => {
    const parser = createOmpJsonlParser();
    const message = { role: "assistant", timestamp: 1, model: "m", usage: { inputTokens: 10, outputTokens: 3 } };
    const parsed = parser(JSON.stringify({ type: "message_end", message })
      + "\n" + JSON.stringify({ type: "message_end", message: { ...message, usage: { inputTokens: 10, outputTokens: 7 } } })
      + "\n" + agentEnd);
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 7, cachedInputTokens: 0 });
  });
});
