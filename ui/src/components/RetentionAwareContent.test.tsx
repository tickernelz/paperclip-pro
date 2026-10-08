// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../context/ThemeContext";
import { PurgedAttachmentsContext } from "../context/PurgedAttachmentsContext";
import { resetPurgedContentProbesForTests } from "../lib/purged-attachment";
import { MarkdownBody } from "./MarkdownBody";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string } & React.ComponentProps<"a">) => (
    <a href={to} {...props}>{children}</a>
  ),
  useCaseHref: () => (path: string) => path,
  useLocation: () => ({ pathname: "/PAP/issues/PAP-1", search: "", hash: "", state: null }),
}));

vi.mock("../api/issues", () => ({ issuesApi: { get: vi.fn() } }));
vi.mock("../context/CompanyContext", () => ({ useOptionalCompany: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();

function goneResponse(purgedAt: string) {
  return new Response(null, { status: 410, headers: { "X-Paperclip-Purged-At": purgedAt } });
}

describe("retention tombstones in markdown", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    resetPurgedContentProbesForTests();
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(markdown: string, purged = new Map<string, string>()) {
    root = createRoot(container);
    flushSync(() => {
      root?.render(
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider>
            <PurgedAttachmentsContext.Provider value={purged}>
              <MarkdownBody>{markdown}</MarkdownBody>
            </PurgedAttachmentsContext.Provider>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
  }

  it("replaces a purged image with the removal notice after a HEAD probe", async () => {
    fetchMock.mockResolvedValue(goneResponse("2026-09-30T12:34:56.000Z"));
    render("![Diagram](/api/attachments/att-1/content)");

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/attachments/att-1/content");
    flushSync(() => img?.dispatchEvent(new Event("error")));

    await vi.waitFor(() => expect(container.textContent).toContain("File removed by retention (2026-09-30)"));
    expect(container.querySelector("img")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/attachments/att-1/content",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("keeps a broken image that was not purged", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    render("![Diagram](/api/assets/asset-1/content)");

    flushSync(() => container.querySelector("img")?.dispatchEvent(new Event("error")));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.textContent).not.toContain("File removed by retention");
  });

  it("renders a link to a purged attachment known from the task's attachment list as the notice", () => {
    render(
      "[report.pdf](/api/attachments/att-2/content)",
      new Map([["/api/attachments/att-2/content", "2026-10-01T00:00:00.000Z"]]),
    );

    expect(container.textContent).toContain("File removed by retention (2026-10-01)");
    expect(container.querySelector('a[href="/api/attachments/att-2/content"]')).toBeNull();
  });

  it("checks a content link before navigating and shows the notice when it was purged", async () => {
    fetchMock.mockResolvedValue(goneResponse("2026-10-02T08:00:00.000Z"));
    render("[report.pdf](/api/attachments/att-3/content)");

    const link = container.querySelector<HTMLAnchorElement>('a[href="/api/attachments/att-3/content"]');
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    flushSync(() => link?.dispatchEvent(click));

    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(container.textContent).toContain("File removed by retention (2026-10-02)"));
  });
});
