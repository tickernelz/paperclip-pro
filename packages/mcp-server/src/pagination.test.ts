import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, InvalidCursorError, paginateListing, resolvePageSize } from "./catalog.js";

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
