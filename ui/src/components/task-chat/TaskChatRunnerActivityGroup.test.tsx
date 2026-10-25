// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskChatThreadView } from "./TaskChatThreadView";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import {
  TaskChatRunnerActivityGroup,
  newestActivityIds,
} from "./TaskChatRunnerActivityGroup";
import { TaskChatBubble } from "./TaskChatBubble";
import { TaskChatExpansionState } from "./expansion-state";
import { buildTurnTimelineRows } from "./transcript-adapter";
import type {
  TaskChatActivityPhaseItem,
  TaskChatItem,
  TaskChatToolItem,
} from "./task-chat-model";

const tool = (
  id: string,
  status: TaskChatToolItem["status"] = "completed",
): TaskChatToolItem => ({
  id,
  kind: "tool",
  name: "exec_command",
  target: `command-${id}`,
  status,
  detail: `output-${id}`,
});

const tools = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    tool(`t${index + 1}`, index === count - 1 ? "in_progress" : "completed"),
  );

const commentary = (id: string, text: string): TaskChatItem => ({
  id,
  kind: "message",
  author: "agent",
  text,
});

describe("TaskChatRunnerActivityGroup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let memory: Map<string, boolean>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    memory = new Map();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = (node: React.ReactNode) =>
    act(() =>
      root.render(
        <TaskChatExpansionState.Provider value={memory}>
          <MemoryRouter>
            <ThemeProvider>{node}</ThemeProvider>
          </MemoryRouter>
        </TaskChatExpansionState.Provider>,
      ),
    );

  const render = (
    items: TaskChatActivityPhaseItem["items"],
    host = "live",
    active = true,
  ) =>
    mount(
      <TaskChatRunnerActivityGroup
        key={host}
        item={{
          id: "commentary:phase",
          kind: "activity_phase",
          items,
          active,
          summary: "",
        }}
      />,
    );

  const TURN = "run-1:turn";
  const renderTurn = (items: TaskChatItem[], running = true) => {
    const rows = buildTurnTimelineRows(items, running, TURN);
    const phases = rows.filter(
      (row): row is TaskChatActivityPhaseItem => row.kind === "activity_phase",
    );
    const open = newestActivityIds(running ? phases : []);
    mount(
      <>
        {phases.map((phase) => (
          <TaskChatRunnerActivityGroup
            key={phase.id}
            item={phase}
            openActivityIds={open}
          />
        ))}
      </>,
    );
  };

  const earlierToggle = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="task-chat-activity-earlier-toggle"]',
    );
  const phaseToggle = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="task-chat-activity-phase-toggle"]',
    );
  const visibleDetails = () =>
    [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="task-chat-runner-activity-detail"]',
      ),
    ].filter((detail) => !detail.hidden);
  const openRowIds = () =>
    [
      ...container.querySelectorAll<HTMLElement>(
        '[data-activity-open="true"]',
      ),
    ].map((row) => row.dataset.activityItemId);
  const rowButton = (id: string) =>
    container.querySelector<HTMLButtonElement>(
      `[data-activity-item-id="${id}"] > button`,
    )!;

  it("aligns runner commentary with the following agent reply", () => {
    mount(
      <>
        <TaskChatRunnerActivityGroup
          item={{
            id: "commentary:phase",
            kind: "activity_phase",
            interstitial: {
              id: "commentary",
              kind: "message",
              author: "agent",
              text: "First line",
            },
            items: [],
            active: false,
            summary: "",
          }}
        />
        <TaskChatBubble
          item={{
            id: "reply",
            kind: "message",
            author: "agent",
            text: "Later reply",
          }}
        />
      </>,
    );
    const commentaryNode = container.querySelector(
      '[data-testid="task-chat-phase-interstitial"]',
    );
    const reply = container.querySelector(
      '[data-testid="task-chat-agent-bubble"]',
    );
    expect(commentaryNode?.classList.contains("px-1")).toBe(true);
    expect(reply?.classList.contains("px-1")).toBe(true);
  });

  it("opens exactly the three newest rows of a running phase under a +N earlier control", () => {
    render(tools(18));
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(openRowIds()).toEqual(["t16", "t17", "t18"]);
    expect(visibleDetails()).toHaveLength(3);
    expect(earlierToggle()?.textContent).toBe("+15 earlier");
    expect(earlierToggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(phaseToggle()).toBeNull();
    for (const id of ["t16", "t17", "t18"]) {
      const row = container.querySelector(`[data-activity-item-id="${id}"]`)!;
      expect(row.textContent).toContain(`command-${id}`);
      expect(row.textContent).toContain(`output-${id}`);
    }
    expect(container.textContent).not.toContain("output-t15");
  });

  it("shows no earlier control while a running phase has three rows or fewer", () => {
    render(tools(2));
    expect(earlierToggle()).toBeNull();
    expect(openRowIds()).toEqual(["t1", "t2"]);
  });

  it("bounds open detail height inside its own scroll container", () => {
    render(tools(1));
    const [detail] = visibleDetails();
    expect(detail.classList.contains("overflow-y-auto")).toBe(true);
    expect(
      [...detail.classList].some((name) => name.startsWith("max-h-")),
    ).toBe(true);
    expect(
      [...detail.classList].some(
        (name) => name.includes("[&>*]:shrink-0"),
      ),
    ).toBe(true);
  });

  it("reveals the older one-line rows on +N earlier, each individually expandable", () => {
    render(tools(18));
    act(() => earlierToggle()!.click());
    expect(container.querySelectorAll("li")).toHaveLength(18);
    expect(earlierToggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(earlierToggle()?.textContent).toBe("Hide 15 earlier");
    expect(openRowIds()).toEqual(["t16", "t17", "t18"]);
    expect(visibleDetails()).toHaveLength(3);
    expect(rowButton("t4").getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("command-t4");
    expect(container.textContent).not.toContain("output-t4");
    act(() => rowButton("t4").click());
    expect(rowButton("t4").getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("output-t4");
    expect(visibleDetails()).toHaveLength(4);
    act(() => earlierToggle()!.click());
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("moves the open window forward as new activity streams in", () => {
    render(tools(5));
    expect(openRowIds()).toEqual(["t3", "t4", "t5"]);
    render(tools(6));
    expect(openRowIds()).toEqual(["t4", "t5", "t6"]);
    expect(earlierToggle()?.textContent).toBe("+3 earlier");
  });

  it("keeps the running activity's detail on its newest line as it streams", () => {
    let fireResize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          fireResize = () => callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    render(tools(1));
    const detail = visibleDetails()[0];
    let scrollTop = 0;
    Object.defineProperty(detail, "scrollHeight", { value: 900, configurable: true });
    Object.defineProperty(detail, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(detail, "scrollTop", {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });
    act(() => fireResize());
    expect(scrollTop).toBe(900);
    vi.unstubAllGlobals();
  });

  it("stops following once the reader scrolls up inside the detail", () => {
    let fireResize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          fireResize = () => callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    render(tools(1));
    const detail = visibleDetails()[0];
    let scrollTop = 0;
    Object.defineProperty(detail, "scrollHeight", { value: 900, configurable: true });
    Object.defineProperty(detail, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(detail, "scrollTop", {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });
    act(() => fireResize());
    expect(scrollTop).toBe(900);
    scrollTop = 200;
    act(() => detail.dispatchEvent(new Event("scroll")));
    act(() => fireResize());
    expect(scrollTop).toBe(200);
    vi.unstubAllGlobals();
  });

  it("lets a click override the positional open state and keeps the detail mounted", () => {
    render(tools(4));
    const detail = container.querySelector<HTMLElement>(
      '[data-activity-item-id="t3"] [data-testid="task-chat-runner-activity-detail"]',
    )!;
    detail.scrollTop = 40;
    act(() => rowButton("t3").click());
    expect(openRowIds()).toEqual(["t2", "t4"]);
    const hiddenDetail = container.querySelector<HTMLElement>(
      '[data-activity-item-id="t3"] [data-testid="task-chat-runner-activity-detail"]',
    );
    expect(hiddenDetail).toBe(detail);
    expect(hiddenDetail?.hidden).toBe(true);
    act(() => rowButton("t3").click());
    expect(
      container.querySelector(
        '[data-activity-item-id="t3"] [data-testid="task-chat-runner-activity-detail"]',
      ),
    ).toBe(detail);
    expect(detail.hidden).toBe(false);
    expect(detail.scrollTop).toBe(40);
  });

  it("keeps the newest three open across a mid-turn phase split", () => {
    const items = tools(18);
    renderTurn(items);
    expect(openRowIds()).toEqual(["t16", "t17", "t18"]);
    act(() => rowButton("t17").click());
    expect(openRowIds()).toEqual(["t16", "t18"]);
    act(() => rowButton("t17").click());
    expect(openRowIds()).toEqual(["t16", "t17", "t18"]);
    renderTurn([
      ...items.slice(0, 16),
      commentary("late-commentary", "Checking the remaining files"),
      ...items.slice(16),
    ]);
    const groups = container.querySelectorAll(
      '[data-testid="task-chat-activity-phase"]',
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute("data-activity-group")).toBe(
      `${TURN}:phase:start`,
    );
    expect(groups[1].getAttribute("data-activity-group")).toBe(
      `${TURN}:phase:late-commentary`,
    );
    expect(openRowIds()).toEqual(["t16", "t17", "t18"]);
    expect(visibleDetails()).toHaveLength(3);
    expect(earlierToggle()?.textContent).toBe("+15 earlier");
    expect(phaseToggle()).toBeNull();
  });

  it("remembers a collapsed row by its activity id through a phase split", () => {
    const items = tools(6);
    renderTurn(items);
    act(() => rowButton("t5").click());
    expect(openRowIds()).toEqual(["t4", "t6"]);
    renderTurn([
      ...items.slice(0, 4),
      commentary("late-commentary", "Next step"),
      ...items.slice(4),
    ]);
    expect(openRowIds()).toEqual(["t4", "t6"]);
    expect(rowButton("t5").getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses a finished run to its summary", () => {
    renderTurn(tools(18), false);
    expect(earlierToggle()).toBeNull();
    expect(visibleDetails()).toHaveLength(0);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(phaseToggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(phaseToggle()?.textContent).toContain("Ran commands");
    expect(container.textContent).not.toContain("output-t18");
  });

  it("settles from the open live rows to a summary that can be reopened", () => {
    const items = [tool("one", "failed"), tool("two")];
    render(items);
    expect(openRowIds()).toEqual(["one", "two"]);
    render(items, "live", false);
    expect(visibleDetails()).toHaveLength(0);
    expect(phaseToggle()?.getAttribute("aria-label")).toContain(
      "ran commands",
    );
    expect(container.textContent).not.toContain("command-two");
    act(() => phaseToggle()!.click());
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(phaseToggle()?.textContent).not.toMatch(/\d+ failed/);
    expect(rowButton("one").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps failures discoverable after later activity, with neutral detail and no X", () => {
    render([tool("failed", "failed"), tool("next")], "history", false);
    expect(phaseToggle()?.textContent).not.toMatch(/\d+ failed/);
    act(() => phaseToggle()!.click());
    expect(container.querySelector("li")?.textContent).toContain("failed");
    act(() => rowButton("failed").click());
    expect(container.textContent).toContain("output-failed");
    expect(
      container.querySelector(".lucide-x, .text-destructive"),
    ).toBeNull();
  });

  it("updates provider reasoning text in place without remounting the row", () => {
    render([
      { id: "thought", kind: "thinking", lines: ["First"], streaming: true },
    ]);
    const row = container.querySelector('[data-activity-item-id="thought"]');
    expect(row?.textContent).toContain("Thinking");
    render([
      {
        id: "thought",
        kind: "thinking",
        lines: ["First", "Checking the file"],
        streaming: true,
      },
    ]);
    expect(container.querySelector('[data-activity-item-id="thought"]')).toBe(
      row,
    );
    expect(visibleDetails()[0]?.textContent).toContain("Checking the file");
  });

  it("uses the same expansion memory in the real persisted thread renderer", () => {
    render([tool("one", "failed"), tool("two")]);
    act(() => rowButton("one").click());
    expect(rowButton("one").getAttribute("aria-expanded")).toBe("false");
    mount(
      <TaskChatThreadView
        scroll={false}
        items={[
          {
            id: "saved",
            kind: "message",
            author: "agent",
            text: "Finished",
            attachedTurn: {
              id: "turn",
              kind: "turn",
              settled: true,
              standaloneHeader: true,
              summary: { toolCount: 2, added: 0, removed: 0 },
              items: [
                {
                  id: "commentary:phase",
                  kind: "activity_phase",
                  active: false,
                  summary: "Ran commands",
                  items: [tool("one", "failed"), tool("two")],
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(container.textContent).toContain("Finished");
    act(() => phaseToggle()!.click());
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(rowButton("one").getAttribute("aria-expanded")).toBe("false");
    expect(rowButton("two").getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".text-destructive, .lucide-x")).toBeNull();
  });

  it("uses the compact runner group for a legacy persisted turn", () => {
    mount(
      <TaskChatThreadView
        scroll={false}
        items={[
          {
            id: "legacy-turn",
            kind: "turn",
            settled: true,
            summary: { toolCount: 1, added: 0, removed: 0 },
            items: [
              {
                id: "legacy-phase",
                kind: "activity_phase",
                active: false,
                summary: "Ran a command",
                items: [tool("legacy")],
              },
            ],
          },
        ]}
      />,
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-turn-summary"]',
        )!
        .click(),
    );
    expect(phaseToggle()).not.toBeNull();
    expect(
      container.querySelector('[data-testid="task-chat-phase-summary"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Ran command");
    expect(container.textContent).not.toContain("command-legacy");
  });

  it("does not offer empty disclosures for sparse activities", () => {
    render([
      { id: "thinking-empty", kind: "thinking", lines: [], streaming: true },
      { id: "tool-empty", kind: "tool", name: "read", status: "completed" },
      {
        id: "provider-empty",
        kind: "protocol",
        surface: "provider_activity",
        family: "wait",
        status: "running",
        title: "Wait",
        eventType: "wait.started",
        details: [],
        steps: [],
        links: [],
        children: [],
      },
    ]);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(
      container.querySelectorAll(
        "li button, li [aria-expanded], li [aria-controls]",
      ),
    ).toHaveLength(0);
    expect(
      container.querySelector('[data-testid="task-chat-runner-activity-detail"]'),
    ).toBeNull();
  });
});
