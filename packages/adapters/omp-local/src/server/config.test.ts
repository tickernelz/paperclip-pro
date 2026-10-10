import { describe, expect, it } from "vitest";
import { modelOptions } from "./config.js";
import { parseOmpModelsOutput } from "./models.js";

const catalog = JSON.stringify({
  models: [
    { provider: "sub2api-claude", id: "claude-opus-5-5", selector: "sub2api-claude/claude-opus-5-5", name: "Claude Opus 5.5" },
    { provider: "sub2api-claude-kaitech", id: "claude-opus-5-5", selector: "sub2api-claude-kaitech/claude-opus-5-5", name: "Claude Opus 5.5" },
    { provider: "ollama", id: "qwen3", selector: "ollama/qwen3" },
  ],
});

describe("omp model options", () => {
  it("keeps the provider from the catalog row", () => {
    expect(parseOmpModelsOutput(catalog)).toEqual([
      { id: "sub2api-claude/claude-opus-5-5", label: "Claude Opus 5.5", provider: "sub2api-claude" },
      { id: "sub2api-claude-kaitech/claude-opus-5-5", label: "Claude Opus 5.5", provider: "sub2api-claude-kaitech" },
      { id: "ollama/qwen3", label: "ollama/qwen3", provider: "ollama" },
    ]);
  });

  it("carries the display name and provider as structured fields", () => {
    expect(modelOptions(parseOmpModelsOutput(catalog))).toEqual([
      {
        value: "sub2api-claude/claude-opus-5-5",
        label: "Claude Opus 5.5 (sub2api-claude/claude-opus-5-5)",
        group: "sub2api-claude",
        name: "Claude Opus 5.5",
      },
      {
        value: "sub2api-claude-kaitech/claude-opus-5-5",
        label: "Claude Opus 5.5 (sub2api-claude-kaitech/claude-opus-5-5)",
        group: "sub2api-claude-kaitech",
        name: "Claude Opus 5.5",
      },
      { value: "ollama/qwen3", label: "ollama/qwen3", group: "ollama" },
    ]);
  });
});
