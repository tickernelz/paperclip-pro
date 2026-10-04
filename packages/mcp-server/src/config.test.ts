import { describe, expect, it, vi } from "vitest";
import { paperclipToolCatalog } from "./catalog.js";
import { PaperclipApiClient } from "./client.js";
import { parseToolsets, resolveToolsets, FULL_TOOLSET, OPENWA_TOOLSET, TOOLSET_NAMES } from "./config.js";
import type { ToolsetName } from "./tool-overrides.js";

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

function listingNames(toolsets: ToolsetName[], management = false) {
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

  it("selects the openwa toolset only when named, never through full", () => {
    expect(parseToolsets(FULL_TOOLSET)).not.toContain(OPENWA_TOOLSET);
    expect(parseToolsets("all")).not.toContain(OPENWA_TOOLSET);
    expect(parseToolsets("openwa")).toEqual(["core", "openwa"]);
    expect(parseToolsets("full,openwa")).toEqual([...TOOLSET_NAMES, "openwa"]);
    expect(TOOLSET_NAMES).not.toContain(OPENWA_TOOLSET);
  });

  it("lists OpenWA tools only for the openwa toolset with a bound executor", () => {
    const calls: unknown[] = [];
    const openwaTools = { call: async (input: unknown) => { calls.push(input); return { ok: true }; } };
    const names = (toolsets: ToolsetName[], options = {}) =>
      paperclipToolCatalog(makeClient(), toolsets, false, options).listing.tools.map((tool) => tool.name);
    const openwaNames = ["openwa_send", "openwa_read_chat", "openwa_get_media", "openwa_find", "openwa_stay_silent", "openwa_handoff", "openwa_catalog", "openwa_endpoint_config", "openwa_linked_list", "openwa_linked_read", "openwa_describe", "openwa_call"];
    expect(names(["core", "openwa"], { openwaTools })).toEqual(expect.arrayContaining(openwaNames));
    expect(names(["core", "openwa"]).some((name) => name.startsWith("openwa_"))).toBe(false);
    expect(names(parseToolsets(FULL_TOOLSET), { openwaTools }).some((name) => name.startsWith("openwa_"))).toBe(false);
    expect(calls).toEqual([]);
  });

  it("resolves full and its deprecated aliases to one identical union", () => {
    expect(parseToolsets(FULL_TOOLSET)).toEqual([...TOOLSET_NAMES]);
    expect(parseToolsets("all")).toEqual(parseToolsets(FULL_TOOLSET));
    expect(parseToolsets("extended")).toEqual(parseToolsets(FULL_TOOLSET));
    expect(parseToolsets("full,core")).toEqual([...TOOLSET_NAMES]);
  });

  it("warns once per deprecated alias and never for the canonical value", async () => {
    vi.resetModules();
    const fresh = await import("./config.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fresh.parseToolsets("all");
      fresh.parseToolsets("all");
      fresh.parseToolsets("extended");
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        expect.stringContaining('"all" is deprecated'),
        expect.stringContaining('"extended" is deprecated'),
      ]);
      warn.mockClear();
      fresh.parseToolsets(fresh.FULL_TOOLSET);
      fresh.parseToolsets("core");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

describe("Paperclip MCP listing annotations", () => {
  const client = makeClient();
  const toolsets = parseToolsets(FULL_TOOLSET);

  function annotatedEntries(annotations: boolean) {
    return paperclipToolCatalog(client, toolsets, false, { annotations }).listing.tools.filter(
      (tool) => "annotations" in tool,
    );
  }

  it("omits annotations from the default listing", () => {
    const listing = paperclipToolCatalog(client, toolsets, false).listing;
    expect(listing.tools.length).toBeGreaterThan(0);
    expect(listing.tools.filter((tool) => "annotations" in tool)).toEqual([]);
  });

  it("keeps them reachable for a caller that opts in", () => {
    const annotated = annotatedEntries(true);
    expect(annotated.length).toBeGreaterThan(0);
    expect(annotated.every((tool) => "annotations" in tool)).toBe(true);
  });

  it("does not let one caller's choice poison the memoized listing for another", () => {
    const lean = paperclipToolCatalog(client, toolsets, false, { annotations: false }).listing;
    const annotated = paperclipToolCatalog(client, toolsets, false, { annotations: true }).listing;

    expect(lean.tools.filter((tool) => "annotations" in tool)).toEqual([]);
    expect(annotated.tools.filter((tool) => "annotations" in tool).length).toBeGreaterThan(0);
    expect(lean.tools.map((tool) => tool.name)).toEqual(annotated.tools.map((tool) => tool.name));
  });
});
