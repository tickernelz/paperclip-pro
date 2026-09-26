import { describe, expect, it } from "vitest";
import { paperclipToolCatalog } from "./catalog.js";
import { PaperclipApiClient } from "./client.js";
import { parseToolsets, resolveToolsets, TOOLSET_NAMES } from "./config.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
    toolsets: ["core"],
    agentRole: null,
  });
}

function listingNames(toolsets: Array<"core" | "extended">, management = false) {
  return paperclipToolCatalog(makeClient(), toolsets, management).listing.tools.map(
    (tool) => tool.name,
  );
}

describe("Paperclip MCP toolsets", () => {
  it("treats extended and all as supersets of core", () => {
    expect(parseToolsets("core")).toEqual(["core"]);
    expect(parseToolsets("extended")).toEqual(["core", "extended"]);
    expect(parseToolsets("all")).toEqual(["core", "extended"]);
    expect(parseToolsets("extended,core")).toEqual(["core", "extended"]);
    expect(parseToolsets("CORE , extended")).toEqual(["core", "extended"]);
    expect(parseToolsets("")).toEqual(["core"]);
    expect(parseToolsets(null)).toEqual(["core"]);
    expect(parseToolsets("nonsense")).toEqual(["core"]);
  });

  it("never drops core from the selected union", () => {
    for (const requested of ["core", "extended", "all", "extended,core", "nonsense", ""]) {
      expect(parseToolsets(requested)).toContain("core");
    }
    for (const requested of ["extended", "all", "extended,core"]) {
      expect(parseToolsets(requested)).toEqual([...TOOLSET_NAMES]);
    }
  });

  it("resolves the same union from the flag and the environment", () => {
    expect(resolveToolsets({ PAPERCLIP_MCP_TOOLSETS: "extended" }, [])).toEqual([
      "core",
      "extended",
    ]);
    expect(resolveToolsets({}, ["--toolsets", "extended"])).toEqual(["core", "extended"]);
  });

  it("exposes every core tool name in the extended listing", () => {
    const core = listingNames(["core"]);
    const extended = listingNames(["extended"]);

    expect(core.length).toBeGreaterThan(0);
    expect(extended.length).toBeGreaterThan(core.length);
    expect(core.filter((name) => !extended.includes(name))).toEqual([]);
    expect(extended).toContain("paperclipCreateChildIssue");
    expect(extended).toContain("paperclipSetIssueWatchdog");
    expect(extended).toContain("paperclipGetIssueWatchdog");
  });

  it("exposes every core tool name in the all listing", () => {
    const core = listingNames(["core"]);
    const all = listingNames(parseToolsets("all"), true);

    expect(core.filter((name) => !all.includes(name))).toEqual([]);
  });

  it("keeps the extended listing a superset for a board-authority caller too", () => {
    const core = listingNames(["core"], true);
    const extended = listingNames(["extended"], true);

    expect(core.filter((name) => !extended.includes(name))).toEqual([]);
  });
});
