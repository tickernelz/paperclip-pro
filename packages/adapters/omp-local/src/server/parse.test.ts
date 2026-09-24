import { describe, expect, it } from "vitest";
import { createOmpOutputAccumulator } from "./parse.js";

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
