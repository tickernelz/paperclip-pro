import { describe, expect, it } from "vitest";
import {
  buildDocumentPrintHtml,
  renderDocumentMarkdownToHtml,
  resolveChromiumExecutable,
} from "../services/document-pdf.js";

const TOC_MARKDOWN = [
  "## Contents",
  "",
  "- [1. This is my header](#1-this-is-my-header)",
  "- [Répétition](#répétition)",
  "",
  "## 1. This is my header",
  "",
  "First body.",
  "",
  "## 1. This is my header",
  "",
  "Duplicate heading body.",
  "",
  "## Répétition",
  "",
  "Non-ASCII heading body.",
].join("\n");

describe("document PDF markdown rendering", () => {
  it("renders markdown hyperlinks and bare URLs as clickable anchors", () => {
    const html = renderDocumentMarkdownToHtml(
      "See [the spec](https://example.com/spec) and https://bare.example.org for details.",
    );

    expect(html).toContain('<a href="https://example.com/spec">the spec</a>');
    expect(html).toContain('<a href="https://bare.example.org">https://bare.example.org</a>');
  });

  it("emits no anchors for prose that contains no link", () => {
    const html = renderDocumentMarkdownToHtml("See the spec and `https://bare.example.org` for details.");

    expect(html).not.toContain("<a href=");
    expect(html).toContain("<code>https://bare.example.org</code>");
  });

  it("gives every heading a GitHub-compatible id and keeps fragment links intact", () => {
    const html = renderDocumentMarkdownToHtml(TOC_MARKDOWN);

    expect(html).toContain('<h2 id="1-this-is-my-header">1. This is my header</h2>');
    expect(html).toContain('<h2 id="1-this-is-my-header-1">1. This is my header</h2>');
    expect(html).toContain('<h2 id="répétition">Répétition</h2>');
    expect(html).toContain('<a href="#1-this-is-my-header">1. This is my header</a>');
    expect(html).toContain('<a href="#r%C3%A9p%C3%A9tition">Répétition</a>');
  });

  it("renders GitHub-flavoured tables and task lists", () => {
    const html = renderDocumentMarkdownToHtml(
      ["| A | B |", "| - | - |", "| 1 | 2 |", "", "- [x] done", "- [ ] todo"].join("\n"),
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain('<input type="checkbox" checked disabled>');
  });

  it("starts the body with the rendered markdown and injects no title heading", () => {
    const html = buildDocumentPrintHtml({
      title: "Internal Status 2026-09-25",
      markdown: "Body paragraph.",
      issueIdentifier: "ZHA-9",
      revisionNumber: 2,
    });

    expect(html).toContain('<article class="markdown-body">\n<p>Body paragraph.</p>');
    expect(html).not.toContain("<h1>Internal Status 2026-09-25</h1>");
    expect(html).toContain("<title>Internal Status 2026-09-25</title>");
    expect(html).toContain(".markdown-body");
    expect(html).toContain("color-scheme: light");
  });

  it("renders exactly one h1 when the markdown opens with its own heading", () => {
    const html = buildDocumentPrintHtml({
      title: "Internal Status 2026-09-25",
      markdown: "# Curation Report\n\nBody.",
      issueIdentifier: "ZHA-9",
      revisionNumber: 2,
    });

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="curation-report">Curation Report</h1>');
  });

  it("escapes HTML metacharacters in the document title", () => {
    const html = buildDocumentPrintHtml({
      title: 'Status <script>alert("x")</script>',
      markdown: "Body.",
      issueIdentifier: "ZHA-9",
      revisionNumber: 1,
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("chromium discovery", () => {
  it("prefers the explicitly configured executable", () => {
    const previous = process.env.PAPERCLIP_PDF_CHROMIUM_PATH;
    process.env.PAPERCLIP_PDF_CHROMIUM_PATH = process.execPath;
    try {
      expect(resolveChromiumExecutable()).toBe(process.execPath);
    } finally {
      if (previous === undefined) delete process.env.PAPERCLIP_PDF_CHROMIUM_PATH;
      else process.env.PAPERCLIP_PDF_CHROMIUM_PATH = previous;
    }
  });

  it("ignores a configured path that does not exist", () => {
    const previous = process.env.PAPERCLIP_PDF_CHROMIUM_PATH;
    process.env.PAPERCLIP_PDF_CHROMIUM_PATH = "/nonexistent/chromium-binary";
    try {
      expect(resolveChromiumExecutable()).not.toBe("/nonexistent/chromium-binary");
    } finally {
      if (previous === undefined) delete process.env.PAPERCLIP_PDF_CHROMIUM_PATH;
      else process.env.PAPERCLIP_PDF_CHROMIUM_PATH = previous;
    }
  });
});
