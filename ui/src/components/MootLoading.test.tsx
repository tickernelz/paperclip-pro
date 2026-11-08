// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MootLoading } from "./MootLoading";

describe("MootLoading", () => {
  it("announces loading while the animated mark stays decorative", () => {
    const html = renderToStaticMarkup(<MootLoading />);

    expect(html).toContain('role="status"');
    expect(html).toContain("min-h-dvh");
    expect(html).toContain('<span class="sr-only">Loading…</span>');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html.match(/class="moot-mark-dot-pulse"/g)).toHaveLength(6);
  });

  it("starts the pulse at the accent dot and steps once around the ring per period", () => {
    const html = renderToStaticMarkup(<MootLoading />);
    const delays = [...html.matchAll(/animation-delay:(-?\d+(?:\.\d+)?)ms/g)].map((match) => Number(match[1]));
    const accentDelay = delays[[...html.matchAll(/<circle[^>]*>/g)].slice(1).findIndex((circle) => circle[0].includes("var(--accent)"))];

    expect(delays).toHaveLength(6);
    expect(accentDelay).toBe(Math.min(...delays));
    expect(new Set(delays).size).toBe(6);
    expect(Math.max(...delays) - Math.min(...delays)).toBe(1000);
  });

  it("allows containing layouts to override the full-page height", () => {
    const html = renderToStaticMarkup(<MootLoading className="min-h-0" />);

    expect(html).toContain("min-h-0");
    expect(html).not.toContain("min-h-dvh");
  });
});
