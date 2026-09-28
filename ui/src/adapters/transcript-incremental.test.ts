import { describe, expect, it } from "vitest";
import { buildTranscript, createIncrementalTranscript, type RunLogChunk } from "./transcript";
import type { StdoutLineParser, TranscriptEntry, UIAdapterModule } from "./types";

const TS = "2026-04-20T00:00:00.000Z";

const parseFixtureLine: StdoutLineParser = (line, ts) => {
  const parsed = JSON.parse(line) as { type?: string; text?: string; name?: string };
  if (parsed.type === "poison") throw new Error("poison line");
  if (parsed.type === "text_delta") return [{ kind: "assistant", ts, text: parsed.text ?? "", delta: true, channel: "final" }];
  if (parsed.type === "thinking_delta") return [{ kind: "thinking", ts, text: parsed.text ?? "", delta: true, channel: "detail" }];
  if (parsed.type === "tool_call") return [{ kind: "tool_call", ts, name: parsed.name ?? "tool", input: {} }];
  if (parsed.type === "silent") return [];
  return [{ kind: "stdout", ts, text: line }];
};

function fixtureChunks(): RunLogChunk[] {
  const chunks: RunLogChunk[] = [];
  const at = (index: number) => new Date(Date.parse(TS) + index * 10).toISOString();
  const row = (value: unknown) => `${JSON.stringify(value)}\n`;

  for (let index = 0; index < 40; index += 1) {
    const ts = at(index);
    chunks.push({ ts, stream: "stdout", chunk: row({ type: "text_delta", text: ` token${index}` }), seq: index });

    if (index % 7 === 3) {
      chunks.push({ ts, stream: "stdout", chunk: row({ type: "thinking_delta", text: `think${index}` }) });
      chunks.push({ ts, stream: "stdout", chunk: row({ type: "tool_call", name: `tool_${index}` }) });
    }
    if (index % 11 === 5) {
      const split = row({ type: "text_delta", text: ` split${index}` });
      const cut = Math.floor(split.length / 2);
      chunks.push({ ts, stream: "stdout", chunk: split.slice(0, cut) });
      chunks.push({ ts, stream: "stdout", chunk: split.slice(cut) });
    }
    if (index % 13 === 6) chunks.push({ ts, stream: "stdout", chunk: "\r\n   \n" });
    if (index % 9 === 4) chunks.push({ ts, stream: "stderr", chunk: `warning at /home/dotta/project step ${index}` });
    if (index % 17 === 8) chunks.push({ ts, stream: "system", chunk: `run heartbeat ${index}` });
    if (index === 22) chunks.push({ ts, stream: "stdout", chunk: row({ type: "poison" }) });
    if (index === 30) chunks.push({ ts, stream: "stdout", chunk: row({ type: "silent" }) });
  }

  return chunks;
}

const statefulAdapter: UIAdapterModule = {
  type: "stateful_fixture",
  label: "Stateful fixture",
  ConfigFields: (() => null) as unknown as UIAdapterModule["ConfigFields"],
  buildAdapterConfig: () => ({}),
  parseStdoutLine: parseFixtureLine,
  createStdoutParser: () => {
    let pending: string | null = null;
    return {
      parseLine: (line, ts): TranscriptEntry[] => {
        const parsed = JSON.parse(line) as { type?: string; text?: string };
        if (parsed.type === "thinking_delta") {
          pending = parsed.text ?? "";
          return [];
        }
        const prefix = pending === null ? "" : `${pending}|`;
        pending = null;
        return [{ kind: "stdout", ts, text: `${prefix}${line}` }];
      },
      reset: () => {
        pending = null;
      },
    };
  },
};

describe("createIncrementalTranscript", () => {
  it("matches a full rebuild after every appended chunk", () => {
    const chunks = fixtureChunks();
    const incremental = createIncrementalTranscript(parseFixtureLine);

    for (let size = 1; size <= chunks.length; size += 1) {
      const prefix = chunks.slice(0, size);
      expect(incremental.update(prefix)).toEqual(buildTranscript(prefix, parseFixtureLine));
    }
  });

  it("matches a full rebuild when the parser carries state across lines", () => {
    const chunks = fixtureChunks();
    const incremental = createIncrementalTranscript(statefulAdapter);

    for (let size = 1; size <= chunks.length; size += 1) {
      const prefix = chunks.slice(0, size);
      expect(incremental.update(prefix)).toEqual(buildTranscript(prefix, statefulAdapter));
    }
  });

  it("matches a full rebuild after the retained window is trimmed or a chunk is replaced", () => {
    const chunks = fixtureChunks();
    const incremental = createIncrementalTranscript(parseFixtureLine);
    incremental.update(chunks);

    const trimmed = [
      { ts: chunks[20]!.ts, stream: "system", chunk: "⋯ earlier output trimmed ⋯" } satisfies RunLogChunk,
      ...chunks.slice(20),
    ];
    expect(incremental.update(trimmed)).toEqual(buildTranscript(trimmed, parseFixtureLine));

    const repaired = [...trimmed];
    repaired[4] = { ...repaired[4]!, chunk: `${JSON.stringify({ type: "text_delta", text: " repaired" })}\n` };
    expect(incremental.update(repaired)).toEqual(buildTranscript(repaired, parseFixtureLine));
  });

  it("keeps an already returned transcript unchanged when later chunks extend a delta", () => {
    const deltas: RunLogChunk[] = [1, 2, 3].map((index) => ({
      ts: TS,
      stream: "stdout",
      chunk: `${JSON.stringify({ type: "text_delta", text: ` part${index}` })}\n`,
    }));
    const incremental = createIncrementalTranscript(parseFixtureLine);

    const afterFirst = incremental.update(deltas.slice(0, 1));
    const snapshot = structuredClone(afterFirst);
    incremental.update(deltas);

    expect(afterFirst).toEqual(snapshot);
  });
});
