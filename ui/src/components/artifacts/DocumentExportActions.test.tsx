// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIssuesApi = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getDocumentPdf: vi.fn(),
}));
const mockCopyTextToClipboard = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mockCopyTextToClipboard }));

import { DocumentExportActions } from "./DocumentExportActions";

const FULL_BODY = [
  "# Internal Status",
  "",
  "- [1. Scope](#1-scope)",
  "",
  "## 1. Scope",
  "",
  "See [the spec](https://example.com/spec) and https://bare.example.org.",
].join("\n");

let container: HTMLDivElement;
let root: Root;
let downloads: Array<{ name: string; blob: Blob }>;
let lastObjectUrlBlob: Blob | null;

function click(testId: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`missing ${testId}`);
  button.click();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  downloads = [];
  lastObjectUrlBlob = null;
  mockIssuesApi.getDocument.mockResolvedValue({ key: "internal-status", body: FULL_BODY });
  mockIssuesApi.getDocumentPdf.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
  URL.createObjectURL = vi.fn((blob: Blob) => {
    lastObjectUrlBlob = blob;
    return "blob:mock";
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function mockClick(this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: lastObjectUrlBlob as Blob });
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(props: Partial<Parameters<typeof DocumentExportActions>[0]> = {}) {
  act(() => {
    root.render(
      <DocumentExportActions
        issueId="issue-1"
        documentKey="internal-status"
        title="Internal Status 2026-09-25"
        format="markdown"
        {...props}
      />,
    );
  });
}

describe("DocumentExportActions", () => {
  it("copies the full document body, not a preview", async () => {
    render({ body: FULL_BODY });
    click("document-export-copy");
    await flush();

    expect(mockCopyTextToClipboard).toHaveBeenCalledWith(FULL_BODY);
    expect(container.textContent).toContain("Copied!");
  });

  it("fetches the document when the caller has no body in hand", async () => {
    render();
    click("document-export-copy");
    await flush();

    expect(mockIssuesApi.getDocument).toHaveBeenCalledWith("issue-1", "internal-status");
    expect(mockCopyTextToClipboard).toHaveBeenCalledWith(FULL_BODY);
  });

  it("downloads the raw source under a slugified markdown filename", async () => {
    render({ body: FULL_BODY });
    click("document-export-download");
    await flush();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("internal-status-2026-09-25.md");
    expect(downloads[0]!.blob.type).toBe("text/markdown;charset=utf-8");
    expect(await downloads[0]!.blob.text()).toBe(FULL_BODY);
  });

  it("downloads the server-rendered PDF without opening a print dialog", async () => {
    const print = vi.fn();
    window.print = print;

    render({ body: FULL_BODY });
    click("document-export-pdf");
    await flush();

    expect(mockIssuesApi.getDocumentPdf).toHaveBeenCalledWith("issue-1", "internal-status");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("internal-status-2026-09-25.pdf");
    expect(downloads[0]!.blob.type).toBe("application/pdf");
    expect(print).not.toHaveBeenCalled();
  });

  it("reports a failed export instead of claiming success", async () => {
    mockIssuesApi.getDocumentPdf.mockRejectedValue(new Error("No Chromium"));

    render({ body: FULL_BODY });
    click("document-export-pdf");
    await flush();

    expect(downloads).toHaveLength(0);
    expect(container.textContent).toContain("No Chromium");
  });
});
