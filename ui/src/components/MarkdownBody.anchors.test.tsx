// @vitest-environment node

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "../context/ThemeContext";
import { MarkdownBody } from "./MarkdownBody";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string } & React.ComponentProps<"a">) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/PAP/issues/PAP-1", search: "", hash: "", state: null }),
}));

vi.mock("../api/issues", () => ({ issuesApi: { get: vi.fn() } }));
vi.mock("../context/CompanyContext", () => ({ useOptionalCompany: () => null }));

function renderMarkdown(children: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <MarkdownBody>{children}</MarkdownBody>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const TOC_MARKDOWN = [
  "- [1. This is my header](#1-this-is-my-header)",
  "- [Répétition](#répétition)",
  "",
  "## 1. This is my header",
  "",
  "## 1. This is my header",
  "",
  "## Répétition",
].join("\n");

describe("MarkdownBody in-document anchors", () => {
  it("slugs headings the GitHub way, deduplicating repeats", () => {
    const html = renderMarkdown(TOC_MARKDOWN);

    expect(html).toContain('<h2 id="1-this-is-my-header">');
    expect(html).toContain('<h2 id="1-this-is-my-header-1">');
    expect(html).toContain('<h2 id="répétition">');
  });

  it("keeps fragment links relative and in the same tab", () => {
    const html = renderMarkdown(TOC_MARKDOWN);

    expect(html).toContain('href="#1-this-is-my-header"');
    expect(html).not.toContain('href="#1-this-is-my-header" target="_blank"');
  });

  it("still opens external links in a new tab", () => {
    const html = renderMarkdown("[spec](https://example.com/spec)");

    expect(html).toContain('href="https://example.com/spec"');
    expect(html).toContain('target="_blank"');
  });

  it("adds no heading id when the document has no headings", () => {
    const html = renderMarkdown("Just a paragraph.");

    expect(html).not.toContain("id=\"");
  });
});
