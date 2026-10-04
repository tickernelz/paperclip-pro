import { describe, expect, it } from "vitest";
import { piToolArgs } from "./execute.js";

describe("pi tool profile", () => {
  it("keeps the full toolset and operator args in a full run", () => {
    const extraArgs = ["--tools", "read,bash,edit,write", "--no-skills"];
    expect(piToolArgs("full", extraArgs)).toEqual({
      tools: "read,bash,edit,write,grep,find,ls",
      extraArgs,
    });
  });

  it("drops edit and write but keeps bash in a read_only run", () => {
    expect(piToolArgs("read_only", [])).toEqual({ tools: "read,bash,grep,find,ls", extraArgs: [] });
  });

  it("drops operator tool selections that would re-enable writes in a read_only run", () => {
    expect(
      piToolArgs("read_only", ["--tools", "read,edit,write", "-t", "write", "--no-tools", "--thinking", "high"]),
    ).toEqual({ tools: "read,bash,grep,find,ls", extraArgs: ["--no-tools", "--thinking", "high"] });
  });
});
