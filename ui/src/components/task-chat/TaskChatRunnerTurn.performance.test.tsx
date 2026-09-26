// @vitest-environment jsdom

import { Profiler } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/context/ThemeContext";
import { TaskChatLiveTail } from "./TaskChatLiveTail";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { TaskChatThreadView } from "./TaskChatThreadView";
import type { TaskChatItem } from "./task-chat-model";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

// The classic (non-streamlined) branch is otherwise unreachable from a test:
// TaskChatThread always mounts the provider with its default mode.
vi.mock("./presentation-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentation-mode")>();
  return { ...actual, useStreamlinedTaskChatPresentation: () => false };
});

const derived = vi.hoisted(() => ({
  buildTurnTimelineRows: 0,
  paperclipRunnerTimelineItems: 0,
}));

vi.mock("./transcript-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcript-adapter")>();
  const count = (key: "buildTurnTimelineRows" | "paperclipRunnerTimelineItems") => {
    return (...args: unknown[]) => {
      derived[key] += 1;
      return (actual[key] as (...a: unknown[]) => unknown)(...args);
    };
  };
  return {
    ...actual,
    buildTurnTimelineRows: count("buildTurnTimelineRows"),
    paperclipRunnerTimelineItems: count("paperclipRunnerTimelineItems"),
  };
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  derived.buildTurnTimelineRows = 0;
  derived.paperclipRunnerTimelineItems = 0;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const PHASES = 40;
const TOOLS_PER_PHASE = 5;

/** A run long enough that per-render transcript work dominates a frame. */
function longRun(thinkingWords: number): TaskChatItem[] {
  const items: TaskChatItem[] = [];
  for (let phase = 0; phase < PHASES; phase += 1) {
    items.push({
      id: `msg-${phase}`,
      kind: "message",
      author: "agent",
      interstitial: true,
      channel: "progress",
      text: `Step ${phase} commentary`,
      atMs: phase * 1000,
    });
    for (let tool = 0; tool < TOOLS_PER_PHASE; tool += 1) {
      items.push({
        id: `tool-${phase}-${tool}`,
        kind: "tool",
        name: "Read",
        target: `server/src/module-${phase}/file-${tool}.ts`,
        status: "completed",
      });
    }
  }
  items.push({
    id: "think-stream",
    kind: "thinking",
    lines: ["reasoning ".repeat(thinkingWords)],
    streaming: true,
  });
  return items;
}

function renderTurn(items: TaskChatItem[], status: string): void {
  flushSync(() =>
    root.render(
      <ThemeProvider>
        <TaskChatRunnerTurn
          runId="run-1"
          agentName="Atlas"
          items={items}
          status={status}
          startedAtMs={1_000}
        />
      </ThemeProvider>,
    ),
  );
}

it("rebuilds the runner timeline only when the transcript actually changes", () => {
  const items = longRun(4);
  renderTurn(items, "running");
  expect(derived.buildTurnTimelineRows).toBe(1);
  expect(derived.paperclipRunnerTimelineItems).toBe(1);

  for (let tick = 0; tick < 30; tick += 1) {
    renderTurn(items, tick % 2 === 0 ? "running" : "in_progress");
  }
  expect(derived.paperclipRunnerTimelineItems).toBe(1);
  expect(derived.buildTurnTimelineRows).toBe(1);
});

it("still rebuilds the runner timeline once per streaming tick", () => {
  const STREAM_TICKS = 8;
  renderTurn(longRun(1), "running");
  for (let tick = 1; tick <= STREAM_TICKS; tick += 1) {
    renderTurn(longRun(tick), "running");
  }
  expect(derived.paperclipRunnerTimelineItems).toBe(STREAM_TICKS + 1);
  expect(derived.buildTurnTimelineRows).toBe(STREAM_TICKS + 1);
});

it("keeps a settled final answer when the transcript identity stops changing", () => {
  const items = longRun(4);
  renderTurn(
    [...items, { id: "final", kind: "message", author: "agent", channel: "final", text: "All done.", atMs: 9_000 }],
    "running",
  );
  expect(host.textContent).toContain("All done.");
  const rows = host.querySelectorAll('[data-testid="task-chat-turn-timeline-row"]').length;
  for (let tick = 0; tick < 5; tick += 1) {
    renderTurn(
      [...items, { id: "final", kind: "message", author: "agent", channel: "final", text: "All done.", atMs: 9_000 }],
      "running",
    );
  }
  expect(host.textContent).toContain("All done.");
  expect(host.querySelectorAll('[data-testid="task-chat-turn-timeline-row"]').length).toBe(rows);
});

it("announces run progress at minute granularity, not once per second", () => {
  flushSync(() =>
    root.render(
      <ThemeProvider>
        <TaskChatRunnerTurn
          runId="run-1"
          agentName="Atlas"
          items={longRun(2)}
          status="running"
          startedAtMs={Date.now() - 90_000}
        />
      </ThemeProvider>,
    ),
  );
  const header = host.querySelector('[data-testid="task-chat-turn-status-header"]')!;
  expect(header.querySelector('[aria-hidden="true"]')!.textContent).toBe("Working for 1m 30s");
  expect(header.querySelector(".sr-only")!.textContent).toBe("Working for 2 minutes");
});

it("keeps row anchors and the visible status stable across idle renders", () => {
  const items = longRun(3);
  const render = (status: string) =>
    flushSync(() =>
      root.render(
        <ThemeProvider>
          <TaskChatRunnerTurn
            runId="run-1"
            agentName="Atlas"
            items={items}
            status={status}
            startedAtMs={Date.now() - 5_000}
          />
        </ThemeProvider>,
      ),
    );
  render("running");
  const anchors = () =>
    [...host.querySelectorAll("[data-thread-anchor]")].map((node) =>
      node.getAttribute("data-thread-anchor"),
    );
  const before = anchors();
  const headerBefore = host.querySelector(
    '[data-testid="task-chat-turn-status-header"]',
  )!.textContent;
  for (let tick = 0; tick < 5; tick += 1) {
    render(tick % 2 === 0 ? "running" : "in_progress");
  }
  expect(anchors()).toEqual(before);
  expect(
    host.querySelector('[data-testid="task-chat-turn-status-header"]')!.textContent,
  ).toBe(headerBefore);
});

it("keeps the Open skill affordance wired in the classic presentation", () => {
  const items: TaskChatItem[] = [
    {
      id: "skill-1",
      kind: "skill_created",
      skillId: "skill-1",
      name: "release-notes",
      description: null,
      slug: "release-notes",
      versionId: "v1",
      timestamp: "2:31 PM",
    },
  ];
  const onOpenSkill = vi.fn();
  flushSync(() =>
    root.render(
      <TaskChatThreadView items={items} scroll={false} onOpenSkill={onOpenSkill} />,
    ),
  );
  expect(host.querySelector("article")!.textContent).toContain("release-notes");
  flushSync(() =>
    host.querySelector<HTMLButtonElement>("article button")!.click(),
  );
  expect(onOpenSkill).toHaveBeenCalledWith("skill-1", "release-notes");
});

it("rebuilds the live tail only when its transcript actually changes", () => {
  const items = longRun(4);
  const render = (next: TaskChatItem[]) =>
    flushSync(() =>
      root.render(
        <ThemeProvider>
          <TaskChatLiveTail items={next} />
        </ThemeProvider>,
      ),
    );
  render(items);
  const afterMount = derived.buildTurnTimelineRows;
  expect(afterMount).toBe(1);
  for (let tick = 0; tick < 20; tick += 1) {
    render(items);
    flushSync(() => root.render(<ThemeProvider><TaskChatLiveTail items={items} /></ThemeProvider>));
  }
  expect(derived.buildTurnTimelineRows).toBe(afterMount);
});
