import { describe, expect, it } from "vitest";
import { paperclipToolCatalog } from "./catalog.js";
import { PaperclipApiClient } from "./client.js";
import { parseToolsets, FULL_TOOLSET } from "./config.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: null,
    toolsets: ["core"],
    agentRole: null,
  });
}

describe("tools/list completeness", () => {
  const client = makeClient();

  it.each([
    ["core", false],
    ["core", true],
    [FULL_TOOLSET, false],
    [FULL_TOOLSET, true],
  ])("returns every tool in a single response for %s (management=%s)", (selection, management) => {
    const listing = paperclipToolCatalog(client, parseToolsets(selection), management).listing;

    expect(listing.tools.length).toBeGreaterThan(0);
    expect(listing).not.toHaveProperty("nextCursor");
    expect(new Set(listing.tools.map((tool) => tool.name)).size).toBe(listing.tools.length);
  });

  it("never hides a tool behind a cursor the surface does not justify", () => {
    const agent = paperclipToolCatalog(client, parseToolsets(FULL_TOOLSET), false).listing;
    const board = paperclipToolCatalog(client, parseToolsets(FULL_TOOLSET), true).listing;

    const agentNames = new Set(agent.tools.map((tool) => tool.name));
    expect(board.tools.filter((tool) => !agentNames.has(tool.name)).length).toBeGreaterThan(0);
    expect(agent.tools.every((tool) => board.tools.some((entry) => entry.name === tool.name))).toBe(true);
  });
});
