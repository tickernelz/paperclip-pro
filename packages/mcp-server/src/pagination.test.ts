import { describe, expect, it } from "vitest";
import { paperclipToolCatalog, DEFAULT_PAGE_SIZE, InvalidCursorError, paginateListing, resolvePageSize } from "./catalog.js";
import { PaperclipApiClient } from "./client.js";
import { parseToolsets } from "./config.js";

const listing = {
  tools: Array.from({ length: 25 }, (_, index) => ({
    name: `tool-${index}`,
    description: `tool ${index}`,
    inputSchema: { type: "object" as const, properties: {} },
  })),
};

function drain(pageSize: number): string[] {
  const names: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = paginateListing(listing, cursor, pageSize);
    names.push(...page.tools.map((tool) => tool.name));
    if (!page.nextCursor) return names;
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

describe("paginateListing", () => {
  it("returns the whole listing in one page when it fits", () => {
    const page = paginateListing(listing, null, 100);
    expect(page.tools).toHaveLength(25);
    expect(page.nextCursor).toBeUndefined();
  });

  it("walks every tool exactly once across pages", () => {
    for (const pageSize of [1, 7, 25, 26]) {
      const names = drain(pageSize);
      expect(names).toEqual(listing.tools.map((tool) => tool.name));
      expect(new Set(names).size).toBe(listing.tools.length);
    }
  });

  it("reports no next cursor on the final page", () => {
    const first = paginateListing(listing, null, 10);
    const second = paginateListing(listing, first.nextCursor, 10);
    const third = paginateListing(listing, second.nextCursor, 10);
    expect(third.tools).toHaveLength(5);
    expect(third.nextCursor).toBeUndefined();
  });

  it("rejects a cursor that is not a page offset", () => {
    expect(() => paginateListing(listing, "not-a-cursor", 10)).toThrow(InvalidCursorError);
    expect(() => paginateListing(listing, "bm90LWEtbnVtYmVy", 10)).toThrow(InvalidCursorError);
  });

  it("rejects a cursor past the end of the listing", () => {
    expect(() => paginateListing(listing, "OTk5", 10)).toThrow(InvalidCursorError);
  });
});

describe("resolvePageSize", () => {
  it("defaults when the override is absent or unusable", () => {
    expect(resolvePageSize({})).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageSize({ PAPERCLIP_MCP_PAGE_SIZE: "0" })).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageSize({ PAPERCLIP_MCP_PAGE_SIZE: "-3" })).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageSize({ PAPERCLIP_MCP_PAGE_SIZE: "abc" })).toBe(DEFAULT_PAGE_SIZE);
  });

  it("honours a positive override", () => {
    expect(resolvePageSize({ PAPERCLIP_MCP_PAGE_SIZE: "25" })).toBe(25);
  });
});

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

describe("default page size against the real catalog", () => {
  const client = makeClient();
  const toolsets = parseToolsets("full");

  function drainFromDefaultPageSize(): string[] {
    const names: string[] = [];
    let cursor: string | null | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = paperclipToolCatalog(client, toolsets, false, { cursor }).listing;
      names.push(...page.tools.map((tool) => tool.name));
      if (!page.nextCursor) return names;
      cursor = page.nextCursor;
    }
    throw new Error("pagination did not terminate");
  }

  it("is smaller than the advertised surface, so the cursor is actually reachable", () => {
    const first = paperclipToolCatalog(client, toolsets, false, {}).listing;
    expect(first.tools.length).toBe(DEFAULT_PAGE_SIZE);
    const whole = paperclipToolCatalog(client, toolsets, false, { pageSize: Number.MAX_SAFE_INTEGER }).listing;
    expect(DEFAULT_PAGE_SIZE).toBeLessThan(whole.tools.length);
    expect(first.nextCursor).toBeTruthy();
  });

  it("gives a client that sends no cursor every advertised tool exactly once", () => {
    const names = drainFromDefaultPageSize();
    const whole = paperclipToolCatalog(client, toolsets, false, { pageSize: Number.MAX_SAFE_INTEGER }).listing;
    expect(names).toEqual(whole.tools.map((tool) => tool.name));
    expect(new Set(names).size).toBe(whole.tools.length);
  });
});
