// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PublicIssueShareView } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../context/ThemeContext";
import { PublicIssueSharePage } from "./PublicIssueSharePage";

const getPublicShareMock = vi.hoisted(() => vi.fn());
const getPublicShareIssueMock = vi.hoisted(() => vi.fn());

vi.mock("../api/issue-share", () => ({
  issueShareApi: {
    getPublicShare: (token: string) => getPublicShareMock(token),
    getPublicShareIssue: (token: string, issueId: string) => getPublicShareIssueMock(token, issueId),
  },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: null, selectedCompanyId: null, companies: [] }),
  useOptionalCompany: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "Ab3dE5gH9k";

function buildView(overrides: Partial<PublicIssueShareView> = {}): PublicIssueShareView {
  return {
    company: { name: "Acme Robotics", logoUrl: null },
    issue: {
      id: "issue-root",
      identifier: "ACM-12",
      title: "Install the warehouse scanner",
      description: "Scanner install for the north dock.",
      status: "in_progress",
      priority: "high",
      projectName: "Operations",
      assignee: { kind: "agent", name: "Wira", iconUrl: null },
      createdAt: "2026-10-01T08:00:00.000Z",
      updatedAt: "2026-10-07T08:00:00.000Z",
      completedAt: null,
    },
    isSharedRoot: true,
    activeRun: null,
    related: [],
    comments: [],
    documents: [],
    attachments: [],
    workProducts: [],
    ...overrides,
  };
}

describe("PublicIssueSharePage", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function renderAt(path: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/s/:token" element={<PublicIssueSharePage />} />
                <Route path="/s/:token/issues/:issueId" element={<PublicIssueSharePage />} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!container.querySelector("[aria-busy='true']")) break;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({ fillStyle: "", fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn() })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: vi.fn(() => "data:image/png;base64,stub"),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders a redacted comment as author, time and label without any body", async () => {
    getPublicShareMock.mockResolvedValue(
      buildView({
        comments: [
          {
            id: "c-agent",
            kind: "comment",
            author: { kind: "agent", name: "Wira", iconUrl: null },
            body: "Scanner mounted on dock 3.",
            attachments: [],
            createdAt: "2026-10-07T07:00:00.000Z",
          },
          {
            id: "c-human",
            kind: "redacted",
            author: { kind: "user", name: "Dana Supervisor", iconUrl: null },
            createdAt: "2026-10-07T07:30:00.000Z",
          },
        ],
      }),
    );

    await renderAt(`/s/${TOKEN}`);

    expect(getPublicShareMock).toHaveBeenCalledWith(TOKEN);
    const redacted = container.querySelectorAll("[data-testid='public-share-redacted-comment']");
    expect(redacted).toHaveLength(1);
    const placeholder = redacted[0]!;
    expect(placeholder.textContent).toContain("Dana Supervisor");
    expect(placeholder.textContent).toContain("Internal update");
    expect(placeholder.querySelector("time")).not.toBeNull();
    expect(placeholder.textContent).not.toContain("Scanner mounted");
    expect(container.textContent).toContain("Scanner mounted on dock 3.");
    expect(document.head.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
  });

  it("shows a static working pill for an active run and no run transcript", async () => {
    getPublicShareMock.mockResolvedValue(
      buildView({ activeRun: { agentName: "Wira", startedAt: "2026-10-07T08:00:00.000Z" } }),
    );

    await renderAt(`/s/${TOKEN}`);

    const pills = container.querySelectorAll("[data-testid='public-share-run-pill']");
    expect(pills).toHaveLength(1);
    expect(pills[0]!.textContent).toBe("Wira is working…");
    expect(container.querySelector("[data-testid^='task-chat']")).toBeNull();
  });

  it("links navigable related issues within the token and leaves the rest as plain text", async () => {
    getPublicShareMock.mockResolvedValue(
      buildView({
        related: [
          { id: "issue-child", identifier: "ACM-13", title: "Mount bracket", status: "todo", relation: "child", navigable: true },
          { id: "issue-blocker", identifier: "ACM-9", title: "Order spare cables", status: "blocked", relation: "blocked_by", navigable: false },
        ],
      }),
    );

    await renderAt(`/s/${TOKEN}`);

    const plain = Array.from(container.querySelectorAll("span")).find((node) =>
      node.textContent === "ACM-9 · Order spare cables",
    );
    expect(plain).toBeDefined();
    expect(plain!.closest("a")).toBeNull();
    const linked = Array.from(container.querySelectorAll("a")).find((node) =>
      node.textContent?.includes("Mount bracket"),
    );
    expect(linked?.getAttribute("href")).toBe(`/s/${TOKEN}/issues/issue-child`);
  });

  it("renders the not-available state when the link resolves to 404", async () => {
    getPublicShareMock.mockResolvedValue(null);

    await renderAt(`/s/${TOKEN}`);

    expect(container.textContent).toContain("This link is not available");
    expect(container.textContent).not.toContain("Install the warehouse scanner");
  });
});
