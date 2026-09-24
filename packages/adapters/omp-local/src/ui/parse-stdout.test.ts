import { describe, expect, it } from "vitest";
import { parseOmpStdoutLine } from "./parse-stdout.js";

const CAPTURED_OMP_TOOL_STREAM = [
  "{\"type\":\"tool_execution_start\",\"toolCallId\":\"call_455335\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"intent\":\"Echoing alpha string\"}",
  "{\"type\":\"tool_execution_start\",\"toolCallId\":\"call_455339\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo beta\"},\"intent\":\"Echoing beta string\"}",
  "{\"type\":\"tool_execution_start\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"intent\":\"Echoing alpha string again\"}",
  "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455339\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo beta\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"beta\\n\"}],\"details\":{}}}",
  "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455335\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\"}],\"details\":{}}}",
  "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\"}],\"details\":{}}}",
  "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455339\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo beta\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"beta\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":68.01920100000098}}}",
  "{\"type\":\"tool_execution_end\",\"toolCallId\":\"call_455339\",\"toolName\":\"bash\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"beta\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":68.01920100000098}},\"isError\":false}",
  "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455335\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":70.68117799999891}}}",
  "{\"type\":\"tool_execution_end\",\"toolCallId\":\"call_455335\",\"toolName\":\"bash\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":70.68117799999891}},\"isError\":false}",
  "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"args\":{\"command\":\"echo alpha\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":69.76190599999973}}}",
  "{\"type\":\"tool_execution_end\",\"toolCallId\":\"call_455341\",\"toolName\":\"bash\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"alpha\\n\\n\\nWall time: 0.07 seconds\"}],\"details\":{\"timeoutSeconds\":300,\"wallTimeMs\":69.76190599999973}},\"isError\":false}",
];

const CAPTURED_OMP_PROGRESS_UPDATE = "{\"type\":\"tool_execution_update\",\"toolCallId\":\"call_389015\",\"toolName\":\"fabric_exec\",\"args\":{\"code\":\"const r = await omp.bash({cmd:'sleep 3; echo ok'}); return r.output;\",\"display\":\"Waiting three seconds\"},\"partialResult\":{\"content\":[{\"type\":\"text\",\"text\":\"Calling omp.bash\"}],\"details\":{\"progress\":\"Calling omp.bash\",\"audits\":[{\"ref\":\"omp.bash\",\"nestedToolCallId\":\"fabric_cb927a80-14e9-4706-be1f-aad57b9536a6\",\"startedAt\":1790276953309,\"tool\":\"bash\",\"provider\":\"omp\",\"args\":{\"command\":\"sleep 3; echo ok\"}}],\"phases\":[]}}}";

const REDACTION_MARKER = '"***REDACTED***"';

function glueLikeLogRedaction(swallowedLine: string, followingLine: string): string {
  return `${swallowedLine.slice(0, swallowedLine.indexOf('"partialResult"'))}${REDACTION_MARKER}${followingLine}`;
}

function parseStream(lines: readonly string[]) {
  return lines.flatMap((line, index) =>
    parseOmpStdoutLine(line, new Date(1790000000000 + index * 1000).toISOString()),
  );
}

function pairing(entries: ReturnType<typeof parseStream>) {
  const started = entries
    .filter((entry) => entry.kind === "tool_call")
    .map((entry) => (entry as { toolUseId?: string }).toolUseId);
  const settled = entries
    .filter((entry) => entry.kind === "tool_result" && (entry as { delta?: boolean }).delta !== true)
    .map((entry) => (entry as { toolUseId?: string }).toolUseId);
  return { started, settled, unpaired: started.filter((id) => !settled.includes(id)) };
}

describe("parseOmpStdoutLine tool pairing", () => {
  it("settles every parallel tool call captured from a real OMP run", () => {
    const { started, unpaired } = pairing(parseStream(CAPTURED_OMP_TOOL_STREAM));

    expect(started).toEqual(["call_455335", "call_455339", "call_455341"]);
    expect(unpaired).toEqual([]);
  });

  it("settles a tool call whose end log redaction glued onto the previous line", () => {
    const swallowedIndex = CAPTURED_OMP_TOOL_STREAM.length - 2;
    const corrupted = [
      ...CAPTURED_OMP_TOOL_STREAM.slice(0, swallowedIndex),
      glueLikeLogRedaction(
        CAPTURED_OMP_TOOL_STREAM[swallowedIndex]!,
        CAPTURED_OMP_TOOL_STREAM[swallowedIndex + 1]!,
      ),
    ];

    const entries = parseStream(corrupted);
    const { unpaired, settled } = pairing(entries);

    expect(unpaired).toEqual([]);
    expect(settled).toContain("call_455341");
    expect(entries.some((entry) => entry.kind === "system" && String((entry as { text?: string }).text).includes("Unreadable"))).toBe(false);
  });

  it("stamps streamed tool progress with the line timestamp so replay is stable", () => {
    const [entry] = parseOmpStdoutLine(CAPTURED_OMP_PROGRESS_UPDATE, "2026-09-24T19:01:05.507Z");

    expect(entry).toMatchObject({ kind: "tool_result", delta: true, ts: "2026-09-24T19:01:05.507Z" });
  });
});
