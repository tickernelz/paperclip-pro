import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import path from "node:path";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { HttpError } from "../errors.js";

const requirePackage = createRequire(import.meta.url);

export interface DocumentPdfMeta {
  title: string;
  markdown: string;
  issueIdentifier: string;
  revisionNumber: number;
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeStringify);

export function renderDocumentMarkdownToHtml(markdown: string): string {
  return String(markdownProcessor.processSync(markdown));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let githubMarkdownCss: string | null = null;

function loadGithubMarkdownCss(): string {
  if (githubMarkdownCss === null) {
    const packageDir = path.dirname(requirePackage.resolve("github-markdown-css/package.json"));
    githubMarkdownCss = readFileSync(path.join(packageDir, "github-markdown-light.css"), "utf8");
  }
  return githubMarkdownCss;
}

const PRINT_STYLES = [
  ":root { color-scheme: light; }",
  "html, body { margin: 0; padding: 0; background: #ffffff; }",
  ".markdown-body { box-sizing: border-box; min-width: 0; max-width: none; padding: 0; font-size: 11pt; }",
  ".markdown-body pre, .markdown-body table { page-break-inside: avoid; }",
  ".markdown-body h1, .markdown-body h2, .markdown-body h3 { page-break-after: avoid; }",
  ".markdown-body img { max-width: 100%; }",
].join("\n");

export function buildDocumentPrintHtml(meta: DocumentPdfMeta): string {
  const title = escapeHtml(meta.title);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>" + title + "</title>",
    "<style>" + loadGithubMarkdownCss() + "</style>",
    "<style>" + PRINT_STYLES + "</style>",
    "</head>",
    '<body><article class="markdown-body">',
    "<h1>" + title + "</h1>",
    renderDocumentMarkdownToHtml(meta.markdown),
    "</article></body></html>",
  ].join("\n");
}

function pdfChromeTemplate(inner: string): string {
  return '<div style="width:100%;font-size:8px;color:#59636e;padding:0 14mm;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' + inner + "</div>";
}

function playwrightChromiumCandidates(): string[] {
  const configuredRoot = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  const root = configuredRoot
    || path.join(homedir(), platform() === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const relatives = [
    "chrome-linux64/chrome",
    "chrome-linux/chrome",
    "chrome-headless-shell-linux64/chrome-headless-shell",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-headless-shell-mac/chrome-headless-shell",
  ];
  return entries
    .filter((entry) => entry.startsWith("chromium-") || entry.startsWith("chromium_headless_shell-"))
    .sort()
    .reverse()
    .flatMap((entry) => relatives.map((relative) => path.join(root, entry, relative)));
}

const SYSTEM_CHROMIUM_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/usr/bin/microsoft-edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export const CHROMIUM_UNAVAILABLE_MESSAGE =
  "PDF export needs a Chromium-family browser. Install Google Chrome or Chromium, or set PAPERCLIP_PDF_CHROMIUM_PATH to its executable.";

/** First Chromium-family executable this host exposes, or `null`. */
export function resolveChromiumExecutable(): string | null {
  const configured = [
    process.env.PAPERCLIP_PDF_CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ];
  for (const candidate of configured) {
    const trimmed = candidate?.trim();
    if (trimmed && existsSync(trimmed)) return trimmed;
  }
  for (const candidate of [...SYSTEM_CHROMIUM_CANDIDATES, ...playwrightChromiumCandidates()]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function renderDocumentPdf(meta: DocumentPdfMeta): Promise<Buffer> {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) throw new HttpError(503, CHROMIUM_UNAVAILABLE_MESSAGE);
  const { default: puppeteer } = await import("puppeteer-core");
  const chrome = escapeHtml(meta.issueIdentifier) + " &middot; " + escapeHtml(meta.title)
    + " &middot; Revision " + String(meta.revisionNumber);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildDocumentPrintHtml(meta), { waitUntil: "load" });
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: pdfChromeTemplate('<span style="float:left">' + chrome + "</span>"),
      footerTemplate: pdfChromeTemplate(
        '<span style="float:left">' + chrome + '</span><span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span>',
      ),
      margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" },
      tagged: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
