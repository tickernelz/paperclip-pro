// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ResolvedDecisionEntry, ResolvedDecisionPage } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueEmptyState } from "../pages/DecisionQueuePage";
import { DecisionHistorySections, historySourceKinds } from "./DecisionHistory";

const mockDecisionQueuesApi = vi.hoisted(() => ({ history: vi.fn() }));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../api/decisionQueues", () => ({ decisionQueuesApi: mockDecisionQueuesApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function entry(overrides: Partial<ResolvedDecisionEntry> = {}): ResolvedDecisionEntry {
  return {
    id: "issue_thread_interaction:1",
    sourceKind: "issue_thread_interaction",
    sourceId: "1",
    kind: "ask_user_questions",
    kindLabel: "Questions",
    status: "answered",
    outcome: "decided",
    title: "When do we launch?",
    result: "Friday",
    decidedBy: { type: "user", userId: "u1", agentId: null, name: "Dana Board" },
    decidedAt: new Date().toISOString(),
    issue: { id: "i1", identifier: "DQC-1", title: "Launch", href: "/DQC/issues/DQC-1" },
    href: "/DQC/issues/DQC-1",
    ...overrides,
  };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}

describe("DecisionHistorySections", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockDecisionQueuesApi.history.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: { decidedOpen: boolean; selectedSourceKinds?: string[] }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <DecisionHistorySections
            companyId="company-1"
            selectedSourceKinds={(props.selectedSourceKinds ?? []) as never}
            bounds={{}}
            agentMap={new Map()}
            decidedOpen={props.decidedOpen}
            expiredOpen={false}
            onToggleDecided={() => undefined}
            onToggleExpired={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
  }

  it("requests nothing until a history section is opened", async () => {
    render({ decidedOpen: false });
    await flush();
    expect(mockDecisionQueuesApi.history).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Decided");
    expect(container.textContent).toContain("Expired");
  });

  it("fills the Decided section with resolved decisions and their decider and outcome", async () => {
    const page: ResolvedDecisionPage = { items: [entry()], nextCursor: "next", totalCount: 392 };
    mockDecisionQueuesApi.history.mockResolvedValue(page);
    render({ decidedOpen: true });
    await flush();

    expect(mockDecisionQueuesApi.history).toHaveBeenCalledTimes(1);
    expect(mockDecisionQueuesApi.history.mock.calls[0]![1]).toMatchObject({ status: "decided", cursor: null });
    expect(container.textContent).toContain("Decided (392)");
    const row = container.querySelector("[data-decision-history-row='decided']");
    expect(row?.textContent).toContain("When do we launch?");
    expect(row?.textContent).toContain("Dana Board");
    expect(row?.textContent).toContain("Friday");
    expect(row?.querySelector("a")?.getAttribute("href")).toBe("/DQC/issues/DQC-1");
    expect(container.textContent).toContain("Load older");
  });

  it("explains an empty filtered history instead of rendering a blank section", async () => {
    mockDecisionQueuesApi.history.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    render({ decidedOpen: true, selectedSourceKinds: ["approval"] });
    await flush();
    expect(mockDecisionQueuesApi.history.mock.calls[0]![1]).toMatchObject({ sourceKinds: ["approval"] });
    expect(container.textContent).toContain("Nothing decided matches these filters");
  });

  it("skips the request when the kind filter excludes every history source", async () => {
    render({ decidedOpen: true, selectedSourceKinds: ["blocker_attention"] });
    await flush();
    expect(mockDecisionQueuesApi.history).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Decided (0)");
    expect(historySourceKinds(["blocker_attention", "approval"])).toEqual(["approval"]);
  });
});

describe("QueueEmptyState", () => {
  it("points an empty queue at its resolved history", () => {
    const html = renderToStaticMarkup(<QueueEmptyState title="Questions" resolvedCount={411} onShowHistory={() => undefined} />);
    expect(html).toContain("Nothing in Questions is waiting for a decision.");
    expect(html).toContain("411 already resolved.");
    expect(html).toContain("See history");
  });

  it("keeps the onboarding hint when nothing has been resolved", () => {
    const html = renderToStaticMarkup(<QueueEmptyState title="Plans" resolvedCount={0} onShowHistory={() => undefined} />);
    expect(html).not.toContain("See history");
    expect(html).toContain("Decisions land here");
  });
});
