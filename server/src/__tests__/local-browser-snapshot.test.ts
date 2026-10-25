import { describe, expect, it } from "vitest";
import { LOCAL_BROWSER_CURSOR_PATTERN, LOCAL_BROWSER_LIMITS } from "@tickernelz/paperclip-pro-shared";
import {
  clampSnapshotMaxNodes,
  formatSnapshotCursor,
  parseSnapshotCursor,
  renderSnapshot,
} from "../services/local-browser/snapshot.js";

const RESULT_CHARS = LOCAL_BROWSER_LIMITS.resultMaxChars.default;

const nodes = [
  { ref: "e1", role: "navigation", name: "Main", depth: 0 },
  { ref: "e2", role: "link", name: "Home", depth: 1 },
  { ref: "e3", role: "link", name: "Pricing", depth: 1, selected: true },
  { role: "text", name: "Welcome to", depth: 0 },
  { role: "text", name: "the dashboard", depth: 0 },
  { role: "text", name: " ", depth: 0 },
  { ref: "e4", role: "textbox", name: "Search", value: "invoice 42", depth: 0 },
  { ref: "e5", role: "button", name: "Go", depth: 0, disabled: true },
  { ref: "e6", role: "combobox", name: "Plan", value: "Pro plan", depth: 0 },
];

describe("renderSnapshot", () => {
  it("indents by depth and annotates value and state flags", () => {
    const rendered = renderSnapshot({ url: "https://example.com/app", title: "App", nodes, total: nodes.length });
    expect(rendered.url).toBe("https://example.com/app");
    expect(rendered.title).toBe("App");
    expect(rendered.text.split("\n")).toEqual([
      'e1 navigation "Main"',
      '  e2 link "Home"',
      '  e3 link "Pricing" [selected]',
      'text "Welcome to the dashboard"',
      'e4 textbox "Search"="invoice 42"',
      'e5 button "Go" [disabled]',
      'e6 combobox "Plan"="Pro plan"',
    ]);
    expect(rendered.truncated).toBe(false);
    expect(rendered.nodes).toBe(7);
    expect(rendered.total).toBe(9);
    expect(rendered.cursor).toBeUndefined();
  });

  it("collapses a long run of text-only nodes into one bounded line", () => {
    const run = Array.from({ length: 40 }, (_, index) => ({
      role: "text",
      name: "paragraph " + index + " " + "x".repeat(20),
      depth: 2,
    }));
    const rendered = renderSnapshot({ nodes: run, total: run.length });
    const lines = rendered.text.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith('    text "')).toBe(true);
    expect(lines[0]!.length).toBeLessThan(400);
    expect(lines[0]!.endsWith('…"')).toBe(true);
  });

  it("emits a decimal cursor and continues the next page after the last emitted node", () => {
    const first = renderSnapshot({ nodes, total: nodes.length }, { maxNodes: 3 });
    expect(first.text.split("\n")).toHaveLength(3);
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBe("3");
    expect(LOCAL_BROWSER_CURSOR_PATTERN.test(first.cursor!)).toBe(true);

    const second = renderSnapshot({ nodes, total: nodes.length }, { maxNodes: 3, cursor: first.cursor });
    const secondLines = second.text.split("\n");
    expect(secondLines).toEqual([
      'text "Welcome to the dashboard"',
      'e4 textbox "Search"="invoice 42"',
      'e5 button "Go" [disabled]',
    ]);
    expect(second.truncated).toBe(true);
    expect(second.cursor).toBe("8");

    const third = renderSnapshot({ nodes, total: nodes.length }, { maxNodes: 3, cursor: second.cursor });
    expect(third.text).toBe('e6 combobox "Plan"="Pro plan"');
    expect(third.truncated).toBe(false);
    expect(third.cursor).toBeUndefined();
  });

  it("starts at the offset the extension reports for a page it already paged", () => {
    const page = nodes.slice(3, 6);
    const rendered = renderSnapshot({ nodes: page, offset: 3, total: nodes.length, cursor: "3" }, { maxNodes: 10 });
    expect(rendered.text.split("\n")[0]).toBe('text "Welcome to the dashboard"');
    expect(rendered.cursor).toBe("6");
    expect(rendered.truncated).toBe(true);
  });

  it("treats a reset page as the first page and never repeats a cursor", () => {
    const rendered = renderSnapshot({ nodes, total: nodes.length, cursorReset: true }, { maxNodes: 3, cursor: "6" });
    expect(rendered.text.split("\n")[0]).toBe('e1 navigation "Main"');
    expect(rendered.cursor).toBe("3");

    const empty = renderSnapshot({ nodes: [], total: 0, truncated: true }, { maxNodes: 10 });
    expect(empty.cursor).toBeUndefined();
  });

  it("reports the extension's own truncation with a decimal offset", () => {
    const rendered = renderSnapshot({ nodes: nodes.slice(0, 2), total: 99, truncated: true }, { maxNodes: 10 });
    expect(rendered.truncated).toBe(true);
    expect(rendered.total).toBe(99);
    expect(rendered.cursor).toBe("2");
  });

  it("clamps maxNodes into the contract bounds", () => {
    expect(clampSnapshotMaxNodes(undefined)).toBe(120);
    expect(clampSnapshotMaxNodes(5_000)).toBe(400);
    expect(clampSnapshotMaxNodes(0)).toBe(1);
    expect(clampSnapshotMaxNodes(Number.NaN)).toBe(120);
    expect(clampSnapshotMaxNodes(5_000, 20_000)).toBe(5_000);
    expect(clampSnapshotMaxNodes(undefined, 50)).toBe(50);
  });

  it("bounds the rendered text by the caller's character limit", () => {
    const wide = Array.from({ length: 200 }, (_, index) => ({ ref: "e" + index, role: "button", name: "x".repeat(150) }));
    const rendered = renderSnapshot({ nodes: wide, total: wide.length }, { maxNodes: 200, maxChars: 2_000 });
    expect(rendered.text.length).toBeLessThanOrEqual(2_000);
    expect(rendered.truncated).toBe(true);
    expect(rendered.cursor).toBe(String(rendered.nodes));
  });

  it("accepts only decimal cursors and treats anything else as the start of the page", () => {
    expect(parseSnapshotCursor("120")).toBe(120);
    expect(parseSnapshotCursor(" 42 ")).toBe(42);
    expect(parseSnapshotCursor("eyJvIjoxMjB9")).toBe(0);
    expect(parseSnapshotCursor("not-a-cursor")).toBe(0);
    expect(parseSnapshotCursor("-3")).toBe(0);
    expect(parseSnapshotCursor(undefined)).toBe(0);
    expect(formatSnapshotCursor(12)).toBe("12");
    expect(formatSnapshotCursor(-1)).toBe("0");
    expect(LOCAL_BROWSER_CURSOR_PATTERN.test(formatSnapshotCursor(12))).toBe(true);
  });

  it("pages a hostile snapshot without skipping or repeating a node", () => {
    const huge = "x".repeat(20_000);
    const hostile = Array.from({ length: 120 }, (_, index) => ({
      ref: "e" + (index + 1),
      role: "button",
      name: huge,
      value: huge,
      depth: 0,
    }));

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let last;
    for (;;) {
      pages += 1;
      expect(pages).toBeLessThan(50);
      const page = renderSnapshot(
        { nodes: hostile, total: hostile.length },
        { maxNodes: 400, cursor },
      );
      expect(page.text.length).toBeLessThanOrEqual(RESULT_CHARS);
      expect(page.nodes).toBeGreaterThan(0);
      for (const line of page.text.split("\n")) {
        const ref = /^(e\d+) /.exec(line);
        if (ref) seen.push(ref[1]!);
      }
      last = page;
      if (!page.truncated) {
        expect(page.cursor).toBeUndefined();
        break;
      }
      expect(page.cursor).toBeTruthy();
      expect(Number(page.cursor)).toBeGreaterThan(seen.length - 1);
      cursor = page.cursor;
    }

    expect(last?.total).toBe(120);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, index) => "e" + (index + 1)));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps a bounded page usable when a node reports an absurd depth", () => {
    const page = renderSnapshot(
      { nodes: [{ ref: "e1", role: "button", name: "Deep", depth: 500_000 }], total: 2 },
      { maxNodes: 10 },
    );
    expect(page.nodes).toBe(1);
    expect(page.text.length).toBeLessThan(400);
    expect(page.text.trimStart()).toBe('e1 button "Deep"');
    expect(page.text.length - page.text.trimStart().length).toBeLessThanOrEqual(80);
    expect(page.truncated).toBe(true);
    expect(page.cursor).toBe("1");
  });

  it("never emits raw html", () => {
    const rendered = renderSnapshot({
      nodes: [{ ref: "e1", role: "button", name: "<img src=x onerror=alert(1)>", depth: 0 }],
      total: 1,
    });
    expect(rendered.text).toBe('e1 button "<img src=x onerror=alert(1)>"');
    expect(rendered.text).not.toContain("\n");
  });

  it("keeps a page usable when a node reports an oversized ref", () => {
    const rendered = renderSnapshot({
      url: "https://example.test/",
      title: "Oversized ref",
      nodes: [{ ref: "e" + "R".repeat(50_000), role: "button", name: "Go" }],
      total: 1,
    });
    expect(rendered.nodes).toBe(1);
    expect(rendered.text.length).toBeLessThanOrEqual(RESULT_CHARS);
    expect(rendered.text).toContain("Go");
    expect(rendered.text).toContain("\u2026");
    expect(rendered.cursor).toBeUndefined();
    expect(rendered.truncated).toBe(false);
  });
});
