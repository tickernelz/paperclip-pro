// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@/adapters";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import { TaskChatLiveTail } from "./TaskChatLiveTail";
import { transcriptToTaskChatItems } from "./transcript-adapter";
import type { TaskChatItem } from "./task-chat-model";

const TS = "2026-08-08T12:00:00.000Z";

describe("TaskChatLiveTail", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    root = null;
    container.remove();
  });

  function render(items: TaskChatItem[], emptyMessage?: string) {
    flushSync(() =>
      root!.render(
        <MemoryRouter>
          <ThemeProvider>
            <TaskChatLiveTail items={items} emptyMessage={emptyMessage} />
          </ThemeProvider>
        </MemoryRouter>,
      ),
    );
  }

  function parse(entries: TranscriptEntry[], running = true) {
    return transcriptToTaskChatItems(entries, { runId: "run-1", running });
  }

  const phaseToggle = () => container.querySelector<HTMLButtonElement>(
    '[data-testid="task-chat-activity-phase-toggle"]',
  );
  const earlierToggle = () => container.querySelector<HTMLButtonElement>(
    '[data-testid="task-chat-activity-earlier-toggle"]',
  );
  const viewport = () => container.querySelector(
    '[data-testid="task-chat-activity-current"]',
  )!;
  const openDetails = () => [
    ...container.querySelectorAll<HTMLElement>('[data-testid="task-chat-runner-activity-detail"]'),
  ].filter((detail) => !detail.hidden);

  it("renders streamed reply markdown with one compact activity, without old tool cards", () => {
    const items = parse([
      { kind: "assistant", ts: TS, text: "Looking into the failing test." },
      { kind: "tool_call", ts: TS, name: "Read", toolUseId: "t1", input: { file_path: "src/app.ts" } },
      { kind: "tool_result", ts: TS, toolUseId: "t1", content: "ok", isError: false },
    ]);
    render(items);

    expect(container.querySelector('[data-testid="task-chat-phase-interstitial"]')?.textContent).toContain(
      "Looking into the failing test.",
    );
    expect(phaseToggle()).toBeNull();
    expect(viewport().textContent).toContain("Read a file");
    expect(viewport().textContent).toContain("src/app.ts");
    expect(container.querySelector('[data-testid="task-chat-tool-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="task-chat-phase-child-rail"]')).toBeNull();
  });

  it("keeps tool diff bodies out of the activity feed", () => {
    const items = parse([
      { kind: "tool_call", ts: TS, name: "Edit", toolUseId: "t1", input: { file_path: "a.ts" } },
      { kind: "diff", ts: TS, changeType: "add", text: "const x = 1;" },
      { kind: "diff", ts: TS, changeType: "remove", text: "const x = 0;" },
    ]);
    render(items);

    expect(openDetails()).toHaveLength(1);
    expect(openDetails()[0].textContent).toContain("+1 −1");
    expect(container.textContent).not.toContain("const x = 1;");
    expect(container.textContent).not.toContain("const x = 0;");
  });

  it("drops the debug plumbing kinds RunTranscriptView surfaced", () => {
    // Feed the exact noise the board flagged: init row, stdout/stderr/system
    // dumps, and a result line — interleaved with real content. None of the
    // noise may reach the DOM; only the assistant text + tool row survive.
    const items = parse([
      { kind: "init", ts: TS, model: "claude-opus", sessionId: "sess-INITMARKER" },
      { kind: "system", ts: TS, text: "SYSTEMNOISE hint about the environment" },
      { kind: "stdout", ts: TS, text: "STDOUTNOISE raw log line" },
      { kind: "stderr", ts: TS, text: "STDERRNOISE warning" },
      { kind: "assistant", ts: TS, text: "Here is the real reply." },
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t1", input: { command: "pnpm test" } },
      {
        kind: "result",
        ts: TS,
        text: "RESULTNOISE",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        costUsd: 0.01,
        subtype: "success",
        isError: false,
        errors: [],
      },
    ]);
    render(items);

    expect(container.querySelector('[data-testid="task-chat-phase-interstitial"]')?.textContent).toContain(
      "Here is the real reply.",
    );
    expect(phaseToggle()).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("Here is the real reply.");
    expect(text).toContain("pnpm test");
    // No debug plumbing, no RunTranscriptView chrome.
    for (const noise of [
      "INITMARKER",
      "SYSTEMNOISE",
      "STDOUTNOISE",
      "STDERRNOISE",
      "RESULTNOISE",
      "Streaming",
      "LOG LINES",
      "SYSTEM MESSAGES",
    ]) {
      expect(text).not.toContain(noise);
    }
  });

  it("updates the latest reasoning line in place, with the full text open below it", () => {
    const entries: TranscriptEntry[] = [
      { kind: "thinking", ts: TS, itemId: "reasoning", text: "First line\nChecking" },
    ];
    render(parse(entries));
    const row = viewport().querySelector("[data-activity-row]");
    entries.push({ kind: "thinking", ts: TS, itemId: "reasoning", text: " the file", delta: true });
    render(parse(entries));

    expect(viewport().querySelector("[data-activity-row]")).toBe(row);
    expect(row?.textContent).toContain("Checking the file");
    expect(row?.textContent).not.toContain("First line");
    expect(openDetails()).toHaveLength(1);
    expect(openDetails()[0].textContent).toContain("First line");
    expect(openDetails()[0].textContent).toContain("Checking the file");
    expect(container.querySelector('[data-testid="task-chat-phase-child-rail"]')).toBeNull();
  });

  it("keeps the newest three commands open and moves older ones behind +N earlier", () => {
    const entries: TranscriptEntry[] = [
      { kind: "assistant", ts: TS, text: "Checking the fix.", channel: "progress" },
      { kind: "tool_call", ts: TS, name: "exec_command", toolUseId: "t1", input: { command: "git status" } },
    ];
    render(parse(entries));
    const first = viewport().querySelector("[data-activity-row]");
    entries.push({ kind: "tool_result", ts: TS, toolUseId: "t1", content: "clean", isError: false });
    render(parse(entries));
    expect(viewport().querySelector("[data-activity-row]")).toBe(first);
    expect(viewport().textContent).toContain("Ran a command");

    entries.push(
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t2", input: { command: "pnpm test" } },
      { kind: "tool_result", ts: TS, toolUseId: "t2", content: "passed", isError: false },
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t3", input: { command: "pnpm lint" } },
    );
    render(parse(entries));
    expect(viewport().textContent).toContain("Running a command");
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(openDetails()).toHaveLength(3);
    expect(earlierToggle()).toBeNull();
    expect(container.textContent).toContain("git status");

    entries.push(
      { kind: "tool_result", ts: TS, toolUseId: "t3", content: "clean", isError: false },
      { kind: "tool_call", ts: TS, name: "image_generation", toolUseId: "t4", input: { file_path: "preview.png" } },
    );
    render(parse(entries));
    expect(viewport().textContent).toContain("Generating an image");
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(earlierToggle()?.textContent).toBe("+1 earlier");
    expect(container.textContent).not.toContain("git status");

    flushSync(() => earlierToggle()!.click());
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect(container.textContent).toContain("git status");
    expect(openDetails()).toHaveLength(3);

    entries.push({ kind: "tool_result", ts: TS, toolUseId: "t4", content: "created", isError: false });
    render(parse(entries));
    expect(earlierToggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Generated an image");
  });

  it("keeps the newest three open across a commentary split mid-run", () => {
    const entries: TranscriptEntry[] = [
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t1", input: { command: "echo one" } },
      { kind: "tool_result", ts: TS, toolUseId: "t1", content: "one", isError: false },
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t2", input: { command: "echo two" } },
      { kind: "tool_result", ts: TS, toolUseId: "t2", content: "two", isError: false },
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t3", input: { command: "echo three" } },
      { kind: "tool_result", ts: TS, toolUseId: "t3", content: "three", isError: false },
      { kind: "assistant", ts: TS, text: "Halfway there.", channel: "progress" },
      { kind: "tool_call", ts: TS, name: "Bash", toolUseId: "t4", input: { command: "echo four" } },
    ];
    render(parse(entries));

    const openText = openDetails().map((detail) => detail.textContent ?? "").join("\n");
    expect(openDetails()).toHaveLength(3);
    expect(openText).toContain("two");
    expect(openText).toContain("three");
    expect(openText).toContain("echo four");
    expect(openText).not.toContain("echo one");
  });

  it("bounds long tool targets on the row and wraps the full value in the open detail", () => {
    const longPath =
      "/Users/dotta/paperclip/instances/default/companies/company-id/codex/home/skills/paperclip/references/API-reference.md";
    const items = parse([
      {
        kind: "tool_call",
        ts: TS,
        name: "Read",
        toolUseId: "long-read",
        input: { file_path: longPath },
      },
    ]);
    const renderedTarget = items
      .flatMap((item) =>
        item.kind === "activity_phase" ? item.items : [item],
      )
      .find((item) => item.kind === "tool")?.target;
    render(items);

    const rowTarget = viewport().querySelector("[data-activity-row] [title]");
    expect(rowTarget?.classList.contains("truncate")).toBe(true);
    expect(renderedTarget).toBeTruthy();
    expect(rowTarget?.textContent).toBe(renderedTarget);

    const expandedTarget = openDetails()[0]?.querySelector("p");
    expect(expandedTarget?.textContent).toBe(renderedTarget);
    expect(expandedTarget?.classList.contains("break-all")).toBe(true);

    const rowButton = viewport().querySelector<HTMLButtonElement>(":scope > button")!;
    flushSync(() => rowButton.click());
    expect(rowButton.getAttribute("aria-expanded")).toBe("false");
    expect(openDetails()).toHaveLength(0);
  });

  it("shows the empty message when nothing renderable has streamed yet", () => {
    render([], "Waiting to start...");
    expect(container.textContent).toContain("Waiting to start...");
  });

  it("renders nothing (not even the empty message) once content exists", () => {
    const items = parse([{ kind: "assistant", ts: TS, text: "streaming…" }]);
    render(items, "Waiting to start...");
    expect(container.textContent).not.toContain("Waiting to start...");
    expect(container.textContent).toContain("streaming…");
  });
});
