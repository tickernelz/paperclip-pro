// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IssueRef } from "@tickernelz/paperclip-pro-shared";
import { ThemeProvider } from "@/context/ThemeContext";
import { __liveUpdatesTestUtils } from "@/context/LiveUpdatesProvider";
import { queryKeys } from "@/lib/queryKeys";
import { ISSUE_REF_BATCH_WINDOW_MS } from "@/lib/issueRefStatus";
import { MarkdownBody } from "./MarkdownBody";

const issuesApi = vi.hoisted(() => ({ get: vi.fn(), refs: vi.fn() }));
vi.mock("../api/issues", () => ({ issuesApi }));
vi.mock("@/lib/router", () => ({
  Link: ({ to, ...props }: ComponentProps<"a"> & { to: string }) => <a href={to} {...props} />,
  useCaseHref: () => () => "",
  useLocation: () => ({ pathname: "/PAP/issues/PAP-500", search: "", hash: "", state: null }),
}));
vi.mock("../context/CompanyContext", () => ({
  useOptionalCompany: () => ({ selectedCompanyId: "company-1", companies: [{ issuePrefix: "PAP" }] }),
}));

const UUID_TASK = "0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";

const ISSUES: Record<string, IssueRef> = {
  "PAP-1": { id: "11111111-1111-4111-8111-111111111111", identifier: "PAP-1", title: "One", status: "todo" },
  "PAP-2": { id: "22222222-2222-4222-8222-222222222222", identifier: "PAP-2", title: "Two", status: "done" },
  "PAP-3": { id: "33333333-3333-4333-8333-333333333333", identifier: "PAP-3", title: "Three", status: "blocked" },
  "PAP-4": { id: "44444444-4444-4444-8444-444444444444", identifier: "PAP-4", title: "Four", status: "in_review" },
  [UUID_TASK]: { id: UUID_TASK, identifier: "PAP-5", title: "Five", status: "cancelled" },
};

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
  intersect(elements: Element[]) {
    const entries = elements
      .filter((element) => this.observed.has(element))
      .map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", class extends MockIntersectionObserver {});
  issuesApi.refs.mockImplementation(async (_companyId: string, refs: string[]) =>
    refs.flatMap((ref) => {
      const issue = ISSUES[ref] ?? Object.values(ISSUES).find((candidate) => candidate.id === ref);
      return issue ? [{ ...issue }] : [];
    }),
  );
  issuesApi.get.mockImplementation(async (ref: string) => ({ ...ISSUES[ref], companyId: "company-1" }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render(markdown: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <MarkdownBody>{markdown}</MarkdownBody>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
}

function link(pathId: string) {
  const element = container.querySelector<HTMLAnchorElement>(`a[href="/issues/${pathId}"]`);
  expect(element, pathId).not.toBeNull();
  return element!;
}

function observer() {
  expect(MockIntersectionObserver.instances).toHaveLength(1);
  return MockIntersectionObserver.instances[0]!;
}

async function intersect(elements: Element[]) {
  await act(async () => {
    observer().intersect(elements);
  });
}

async function flushBatch() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ISSUE_REF_BATCH_WINDOW_MS + 20));
  });
}

const FIVE_MENTIONS = `See PAP-1, PAP-2, PAP-3 and PAP-4, plus [the fifth task](/issues/${UUID_TASK}).`;
const FIVE_PATHS = ["PAP-1", "PAP-2", "PAP-3", "PAP-4", UUID_TASK];

it("shows every mention's status without hover using one batched refs request", async () => {
  await render(FIVE_MENTIONS);
  const links = FIVE_PATHS.map(link);
  for (const element of links) expect(element.querySelector("svg")).toBeNull();
  expect(observer().options?.rootMargin).toBe("200px");

  await intersect(links);
  await flushBatch();

  expect(issuesApi.refs).toHaveBeenCalledTimes(1);
  expect(issuesApi.refs).toHaveBeenCalledWith("company-1", expect.arrayContaining(["PAP-1", "PAP-2", "PAP-3", "PAP-4", UUID_TASK]));
  expect(issuesApi.refs.mock.calls[0]![1]).toHaveLength(5);
  for (const element of links) expect(element.querySelector("svg"), element.href).not.toBeNull();
  expect(link("PAP-2").innerHTML).toContain("--status-task-icon-done");
  expect(link(UUID_TASK).getAttribute("aria-label")).toBe("Issue PAP-5: Five");
  expect(issuesApi.get).not.toHaveBeenCalled();
});

it("renders status from already-cached detail and list data with zero requests", async () => {
  client.setQueryData(queryKeys.issues.detail("PAP-1"), { ...ISSUES["PAP-1"], companyId: "company-1" });
  client.setQueryData(queryKeys.issues.list("company-1"), [{ ...ISSUES["PAP-3"], companyId: "company-1" }]);
  await render("Track PAP-1 and PAP-3.");
  await intersect([link("PAP-1"), link("PAP-3")]);
  await flushBatch();

  expect(link("PAP-1").innerHTML).toContain("--status-task-icon-todo");
  expect(link("PAP-3").querySelector("svg")).not.toBeNull();
  expect(issuesApi.refs).not.toHaveBeenCalled();
  expect(issuesApi.get).not.toHaveBeenCalled();
});

it("requests mentions only once they come near the viewport", async () => {
  await render("Start with PAP-1, later PAP-2, never PAP-3.");
  await flushBatch();
  expect(issuesApi.refs).not.toHaveBeenCalled();

  await intersect([link("PAP-1")]);
  await flushBatch();
  expect(issuesApi.refs).toHaveBeenCalledTimes(1);
  expect(issuesApi.refs).toHaveBeenLastCalledWith("company-1", ["PAP-1"]);
  expect(link("PAP-2").querySelector("svg")).toBeNull();

  await intersect([link("PAP-2")]);
  await flushBatch();
  expect(issuesApi.refs).toHaveBeenCalledTimes(2);
  expect(issuesApi.refs).toHaveBeenLastCalledWith("company-1", ["PAP-2"]);
  expect(link("PAP-3").querySelector("svg")).toBeNull();
});

it("updates the icon from a live issue.updated event without refetching", async () => {
  await render("Watch PAP-1.");
  await intersect([link("PAP-1")]);
  await flushBatch();
  expect(link("PAP-1").innerHTML).toContain("--status-task-icon-todo");

  await act(async () => {
    __liveUpdatesTestUtils.invalidateActivityQueries(
      client,
      "company-1",
      {
        entityType: "issue",
        entityId: ISSUES["PAP-1"]!.id,
        action: "issue.updated",
        details: { identifier: "PAP-1", changes: { status: { from: "todo", to: "done" } } },
      },
      { userId: null, agentId: null },
    );
  });
  await flushBatch();

  expect(link("PAP-1").innerHTML).toContain("--status-task-icon-done");
  expect(issuesApi.refs).toHaveBeenCalledTimes(1);
  expect(issuesApi.get).not.toHaveBeenCalled();
});

it("still loads full detail for the quicklook on hover", async () => {
  await render("Hover PAP-4.");
  await intersect([link("PAP-4")]);
  await flushBatch();
  expect(issuesApi.get).not.toHaveBeenCalled();

  await act(async () => {
    link("PAP-4").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  expect(issuesApi.get).toHaveBeenCalledExactlyOnceWith("PAP-4");
});
