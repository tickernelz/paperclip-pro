// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { useRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRunForIssue } from "../api/heartbeats";
import {
  TasksLiveNowSection,
  buildLiveNowEntries,
  liveNowCollapsedStorageKey,
  useAboveViewportResizeCompensation,
} from "./TasksLiveNowSection";
import { classifyLiveNowHealth, countLiveNowHealth } from "./live-now/live-now-health";

const mockIssuesApi = vi.hoisted(() => ({ get: vi.fn(), addComment: vi.fn() }));
const mockHeartbeatsApi = vi.hoisted(() => ({ cancel: vi.fn() }));

vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: mockHeartbeatsApi }));

vi.mock("@/lib/router", () => ({
  Link: ({
    children,
    to,
    state: _state,
    issuePrefetch: _issuePrefetch,
    disableIssueQuicklook: _disableIssueQuicklook,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    state?: unknown;
    issuePrefetch?: unknown;
    disableIssueQuicklook?: boolean;
  }) => <a href={to} {...props}>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function run(overrides: Partial<LiveRunForIssue>): LiveRunForIssue {
  return {
    id: "run-1",
    status: "running",
    invocationSource: "assignment",
    triggerDetail: null,
    startedAt: "2026-10-08T10:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-10-08T10:00:00.000Z",
    agentId: "agent-1",
    agentName: "Builder",
    adapterType: "process",
    issueId: "issue-1",
    ...overrides,
  };
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: "issue-1",
    identifier: "ZHA-1",
    title: "Task",
    status: "in_progress",
    priority: "medium",
    parentId: null,
    ...overrides,
  } as Issue;
}

let container: HTMLDivElement;
let root: Root | null = null;

function render(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  flushSync(() => {
    root!.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

function liveRows() {
  return [...container.querySelectorAll<HTMLElement>("[data-live-now-issue-id]")];
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  localStorage.clear();
  mockIssuesApi.get.mockReset();
  mockIssuesApi.addComment.mockReset();
  mockHeartbeatsApi.cancel.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildLiveNowEntries", () => {
  it("merges runs on one task into one entry, newest start first", () => {
    const entries = buildLiveNowEntries([
      run({ id: "a", issueId: "issue-1", startedAt: "2026-10-08T10:00:00.000Z" }),
      run({ id: "b", issueId: "issue-2", startedAt: "2026-10-08T10:05:00.000Z" }),
      run({ id: "c", issueId: "issue-1", agentId: "agent-2", startedAt: "2026-10-08T10:10:00.000Z" }),
      run({ id: "d", issueId: "issue-3", status: "succeeded" }),
      run({ id: "e", issueId: null }),
    ], new Map());
    expect(entries.map((entry) => [entry.issueId, entry.runs.map((r) => r.id)])).toEqual([
      ["issue-1", ["c", "a"]],
      ["issue-2", ["b"]],
    ]);
    expect(entries[0]!.earliestStartedAt).toBe("2026-10-08T10:00:00.000Z");
  });

  it("drops runs whose task is already done or cancelled", () => {
    expect(buildLiveNowEntries([run({ issueId: "issue-1" })], new Map([["issue-1", "done"]]))).toEqual([]);
  });
});

describe("TasksLiveNowSection", () => {
  it("shows a live task from an unloaded page with its parent path from the detail ancestors", async () => {
    mockIssuesApi.get.mockResolvedValue(issue({
      id: "issue-9",
      identifier: "ZHA-723",
      title: "Deep task",
      parentId: "parent-2",
      ancestors: [
        { id: "parent-2", identifier: "ZHA-500", title: "Middle" },
        { id: "parent-1", identifier: "ZHA-379", title: "Root" },
      ],
    } as Partial<Issue>));

    render(
      <TasksLiveNowSection
        companyId="company-1"
        liveRuns={[run({ issueId: "issue-9", currentStatusMessage: "Running tests" })]}
        issues={[issue({ id: "loaded-1", identifier: "ZHA-1" })]}
      />,
    );

    await waitFor(() => {
      const rows = liveRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain("ZHA-723");
      expect(rows[0]!.textContent).toContain("Deep task");
      const path = rows[0]!.querySelector("[data-slot='tasks-live-now-path']");
      expect([...path!.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
        ["ZHA-379", "/issues/ZHA-379"],
        ["ZHA-500", "/issues/ZHA-500"],
      ]);
      expect(rows[0]!.textContent).toContain("Running tests");
    });
    expect(mockIssuesApi.get).toHaveBeenCalledWith("issue-9");
    expect(container.querySelector("[data-slot='tasks-live-now-count']")?.textContent).toBe("1");
  });

  it("builds the parent path from loaded tasks and caps it at three ancestors", () => {
    const loaded = [
      issue({ id: "p1", identifier: "ZHA-1", parentId: null }),
      issue({ id: "p2", identifier: "ZHA-2", parentId: "p1" }),
      issue({ id: "p3", identifier: "ZHA-3", parentId: "p2" }),
      issue({ id: "p4", identifier: "ZHA-4", parentId: "p3" }),
      issue({ id: "leaf", identifier: "ZHA-5", parentId: "p4", title: "Leaf" }),
    ];
    render(<TasksLiveNowSection companyId="company-1" liveRuns={[run({ issueId: "leaf" })]} issues={loaded} />);

    const path = liveRows()[0]!.querySelector("[data-slot='tasks-live-now-path']")!;
    expect([...path.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["ZHA-2", "ZHA-3", "ZHA-4"]);
    expect(path.textContent).toContain("…");
    expect(mockIssuesApi.get).not.toHaveBeenCalled();
  });

  it("renders one row listing every agent when two runs share a task", () => {
    render(
      <TasksLiveNowSection
        companyId="company-1"
        liveRuns={[
          run({ id: "r1", agentId: "agent-1", agentName: "Builder" }),
          run({ id: "r2", agentId: "agent-2", agentName: "Reviewer", startedAt: "2026-10-08T10:02:00.000Z" }),
        ]}
        issues={[issue({ id: "issue-1", identifier: "ZHA-1", title: "Shared" })]}
      />,
    );

    const rows = liveRows();
    expect(rows).toHaveLength(1);
    const names = [...rows[0]!.querySelectorAll("[title]")].map((el) => el.getAttribute("title"));
    expect(names).toEqual(expect.arrayContaining(["Builder", "Reviewer"]));
  });

  it("renders nothing when no task is live", () => {
    render(
      <TasksLiveNowSection
        companyId="company-1"
        liveRuns={[run({ status: "succeeded" })]}
        issues={[issue({})]}
      />,
    );
    expect(container.querySelector("section")).toBeNull();
    expect(liveRows()).toHaveLength(0);
  });

  it("persists the collapsed state per company", () => {
    const props = {
      companyId: "company-1",
      liveRuns: [run({})],
      issues: [issue({})],
    };
    render(<TasksLiveNowSection {...props} />);
    expect(liveRows()).toHaveLength(1);

    const toggle = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    flushSync(() => toggle.click());
    expect(liveRows()).toHaveLength(0);
    expect(localStorage.getItem(liveNowCollapsedStorageKey("company-1"))).toBe("true");

    flushSync(() => root!.unmount());
    render(<TasksLiveNowSection {...props} />);
    expect(container.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("false");
    expect(liveRows()).toHaveLength(0);

    flushSync(() => root!.unmount());
    render(<TasksLiveNowSection {...props} companyId="company-2" />);
    expect(liveRows()).toHaveLength(1);
  });
});

const NOW = new Date("2026-10-08T10:30:00.000Z").getTime();
const at = (msBeforeNow: number) => new Date(NOW - msBeforeNow).toISOString();

function silence(level: "ok" | "suspicious" | "critical", ageMs: number): NonNullable<LiveRunForIssue["outputSilence"]> {
  return {
    lastOutputAt: at(ageMs),
    lastOutputSeq: 3,
    lastOutputStream: "stdout",
    silenceStartedAt: at(ageMs),
    silenceAgeMs: ageMs,
    level,
    suspicionThresholdMs: 5 * 60_000,
    criticalThresholdMs: 15 * 60_000,
    snoozedUntil: null,
    evaluationIssueId: null,
    evaluationIssueIdentifier: null,
    evaluationIssueAssigneeAgentId: null,
  };
}

const healthFixtures = {
  justStarted: run({ id: "start", startedAt: at(10_000), createdAt: at(12_000) }),
  queued: run({ id: "queued", status: "queued", startedAt: null, createdAt: at(5_000) }),
  active: run({
    id: "active",
    startedAt: at(14 * 60_000),
    currentToolName: "bash",
    currentStatusMessage: "Running bash",
    lastAssistantSnippet: "Rebasing before the push.",
    lastEventAt: at(6_000),
  }),
  thinking: run({ id: "thinking", startedAt: at(6 * 60_000), currentStatusMessage: "Thinking", lastEventAt: at(20_000) }),
  finishedTool: run({
    id: "finished",
    startedAt: at(6 * 60_000),
    currentToolName: "fabric_exec",
    currentStatusMessage: "Finished fabric_exec",
    lastEventAt: at(30_000),
  }),
  quietBySilence: run({ id: "quiet-silence", startedAt: at(20 * 60_000), lastEventAt: at(6 * 60_000), outputSilence: silence("suspicious", 6 * 60_000) }),
  quietByClock: run({ id: "quiet-clock", startedAt: at(20 * 60_000), currentToolName: "wait", lastEventAt: at(4 * 60_000) }),
  stalledByWatchdog: run({ id: "stalled-watchdog", startedAt: at(40 * 60_000), lastEventAt: at(2 * 60_000), outputSilence: silence("critical", 19 * 60_000) }),
  stalledByClock: run({ id: "stalled-clock", startedAt: at(60 * 60_000), lastEventAt: at(25 * 60_000) }),
};

describe("classifyLiveNowHealth", () => {
  it.each([
    ["justStarted", "starting", "Starting"],
    ["queued", "starting", "Queued"],
    ["active", "active", "Working"],
    ["thinking", "thinking", "Thinking"],
    ["finishedTool", "thinking", "Thinking"],
    ["quietBySilence", "quiet", "Quiet 6m"],
    ["quietByClock", "quiet", "Quiet 4m"],
    ["stalledByWatchdog", "stalled", "Stalled 2m"],
    ["stalledByClock", "stalled", "Stalled 25m"],
  ] as const)("classifies the %s fixture as %s", (fixture, health, label) => {
    expect(classifyLiveNowHealth(healthFixtures[fixture], NOW)).toMatchObject({ health, label });
  });

  it("counts working, quiet and stalled tasks", () => {
    expect(countLiveNowHealth(["active", "thinking", "starting", "quiet", "stalled", "stalled"])).toEqual({
      working: 3,
      quiet: 1,
      stalled: 2,
    });
  });
});

describe("Live now cards", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("shows the agent, health, current tool and latest snippet, with stalled tasks first", () => {
    render(
      <TasksLiveNowSection
        companyId="company-1"
        liveRuns={[
          { ...healthFixtures.active, issueId: "issue-1" },
          { ...healthFixtures.stalledByClock, issueId: "issue-2", agentId: "agent-2", agentName: "Operator" },
        ]}
        issues={[issue({ id: "issue-1", identifier: "ZHA-1" }), issue({ id: "issue-2", identifier: "ZHA-2" })]}
      />,
    );

    const rows = liveRows();
    expect(rows.map((row) => [row.dataset.liveNowIssueId, row.dataset.liveHealth])).toEqual([
      ["issue-2", "stalled"],
      ["issue-1", "active"],
    ]);
    const active = rows[1]!;
    expect(active.querySelector("[data-slot='tasks-live-now-health']")?.textContent).toBe("Working");
    expect(active.querySelector("[data-slot='tasks-live-now-status']")?.textContent).toContain("Running bash");
    expect(active.querySelector("[data-slot='tasks-live-now-status'] svg")).not.toBeNull();
    expect(active.querySelector("[data-slot='tasks-live-now-snippet']")?.textContent).toBe("Rebasing before the push.");
    expect(container.querySelector("[data-slot='tasks-live-now-summary']")?.textContent).toContain("1 stalled");
  });

  it("links to the task and to the live run transcript", () => {
    render(<TasksLiveNowSection companyId="company-1" liveRuns={[run({})]} issues={[issue({})]} />);

    const row = liveRows()[0]!;
    expect(row.querySelector("a[aria-label='Open ZHA-1']")?.getAttribute("href")).toBe("/issues/ZHA-1");
    expect(row.querySelector("a[aria-label='Run transcript for Builder']")?.getAttribute("href")).toBe(
      "/agents/agent-1/runs/run-1",
    );
  });

  it("steers the running turn from the card composer", async () => {
    mockIssuesApi.addComment.mockResolvedValue({ id: "comment-1", deliveredAs: "steered" });
    render(<TasksLiveNowSection companyId="company-1" liveRuns={[run({})]} issues={[issue({})]} />);

    const steer = liveRows()[0]!.querySelector<HTMLButtonElement>("button[aria-label='Steer Builder on ZHA-1']")!;
    expect(steer.getAttribute("aria-expanded")).toBe("false");
    flushSync(() => steer.click());
    expect(steer.getAttribute("aria-expanded")).toBe("true");

    const textarea = container.querySelector<HTMLTextAreaElement>("[data-slot='tasks-live-now-steer'] textarea")!;
    expect(document.activeElement).toBe(textarea);
    flushSync(() => setTextareaValue(textarea, "  check the failing test  "));
    flushSync(() => container.querySelector<HTMLButtonElement>("[data-slot='tasks-live-now-steer'] button[type='submit']")!.click());

    await waitFor(() => expect(container.querySelector("[data-slot='tasks-live-now-steer']")).toBeNull());
    expect(mockIssuesApi.addComment).toHaveBeenCalledWith(
      "issue-1",
      "check the failing test",
      undefined,
      undefined,
      undefined,
      expect.any(String),
      "steer",
    );
    expect(liveRows()[0]!.querySelector("[role='status']")?.textContent).toBe("Steered into Builder's turn");
  });

  it("asks for confirmation before stopping the run", async () => {
    mockHeartbeatsApi.cancel.mockResolvedValue(undefined);
    render(<TasksLiveNowSection companyId="company-1" liveRuns={[run({})]} issues={[issue({})]} />);

    flushSync(() => liveRows()[0]!.querySelector<HTMLButtonElement>("button[aria-label=\"Stop Builder's run on ZHA-1\"]")!.click());
    await waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).not.toBeNull());
    expect(mockHeartbeatsApi.cancel).not.toHaveBeenCalled();

    const dialog = document.body.querySelector<HTMLElement>("[role='alertdialog']")!;
    const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Keep running")!;
    flushSync(() => cancel.click());
    await waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());
    expect(mockHeartbeatsApi.cancel).not.toHaveBeenCalled();

    flushSync(() => liveRows()[0]!.querySelector<HTMLButtonElement>("button[aria-label=\"Stop Builder's run on ZHA-1\"]")!.click());
    await waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).not.toBeNull());
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("[role='alertdialog'] button")].find(
      (button) => button.textContent === "Stop run",
    )!;
    flushSync(() => confirm.click());
    await waitFor(() => expect(mockHeartbeatsApi.cancel).toHaveBeenCalledWith("run-1"));
  });

  it("collapses to a strip of agent avatars that expands again on click", () => {
    render(
      <TasksLiveNowSection
        companyId="company-1"
        liveRuns={[
          { ...healthFixtures.active, id: "r1", issueId: "issue-1", agentId: "agent-1", agentName: "Builder" },
          { ...healthFixtures.thinking, id: "r2", issueId: "issue-1", agentId: "agent-2", agentName: "Reviewer" },
          { ...healthFixtures.justStarted, id: "r3", issueId: "issue-2", agentId: "agent-1", agentName: "Builder" },
          { ...healthFixtures.stalledByClock, id: "r4", issueId: "issue-3", agentId: "agent-3", agentName: "Operator" },
        ]}
        issues={[
          issue({ id: "issue-1", identifier: "ZHA-1" }),
          issue({ id: "issue-2", identifier: "ZHA-2" }),
          issue({ id: "issue-3", identifier: "ZHA-3" }),
        ]}
      />,
    );
    expect(container.querySelector("[data-slot='tasks-live-now-avatars']")).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>("section > button[aria-expanded]")!;
    flushSync(() => toggle.click());

    expect(liveRows()).toHaveLength(0);
    const strip = container.querySelector("[data-slot='tasks-live-now-avatars']")!;
    expect([...strip.querySelectorAll("[title]")].map((el) => el.getAttribute("title"))).toEqual([
      "Operator",
      "Builder",
      "Reviewer",
    ]);
    expect(toggle.textContent).toContain("1 stalled");
    expect(container.querySelector("[data-slot='tasks-live-now-count']")?.textContent).toBe("3");

    flushSync(() => toggle.click());
    expect(liveRows()).toHaveLength(3);
    expect(container.querySelector("[data-slot='tasks-live-now-avatars']")).toBeNull();
  });
});

describe("useAboveViewportResizeCompensation", () => {
  function Probe() {
    const ref = useRef<HTMLDivElement | null>(null);
    useAboveViewportResizeCompensation(ref);
    return <div ref={ref} data-testid="probe" />;
  }

  function setup(initial: { top: number; height: number }) {
    let notify: (() => void) | null = null;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    });
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollTop", { value: 500, writable: true });
    container.appendChild(scroller);
    const box = { ...initial };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === scroller) return { top: 100, bottom: 700, height: 600 } as DOMRect;
      return { top: box.top, bottom: box.top + box.height, height: box.height } as DOMRect;
    });
    root = createRoot(scroller);
    flushSync(() => root!.render(<Probe />));
    return {
      scroller,
      resize(height: number) {
        box.height = height;
        notify!();
      },
      resizeAlreadyCorrected(height: number) {
        const delta = height - box.height;
        box.top -= delta;
        box.height = height;
        scroller.scrollTop += delta;
        scroller.dispatchEvent(new Event("scroll"));
        notify!();
      },
    };
  }

  it("adds the height delta to scrollTop when the section sits above the viewport", () => {
    const { scroller, resize } = setup({ top: -300, height: 120 });
    resize(200);
    expect(scroller.scrollTop).toBe(580);
    resize(40);
    expect(scroller.scrollTop).toBe(420);
  });

  it("does not compensate twice when the list already restored its rows", () => {
    const { scroller, resizeAlreadyCorrected } = setup({ top: -300, height: 120 });
    resizeAlreadyCorrected(200);
    expect(scroller.scrollTop).toBe(580);
  });

  it("leaves scrollTop alone while the section is visible", () => {
    const { scroller, resize } = setup({ top: 110, height: 120 });
    resize(200);
    expect(scroller.scrollTop).toBe(500);
  });
});
