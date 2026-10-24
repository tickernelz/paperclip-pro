// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TaskChatExpansionState,
  useIssueExpansionMemory,
  useTaskChatExpansion,
} from "./expansion-state";

function Disclosure({ id }: { id: string }) {
  const [open, setOpen] = useTaskChatExpansion(id, true);
  return (
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      {id}
    </button>
  );
}

const seen: Map<string, boolean>[] = [];

function Thread({ issueId }: { issueId: string | null }) {
  const memory = useIssueExpansionMemory(issueId);
  seen.push(memory);
  return (
    <TaskChatExpansionState.Provider value={memory}>
      <Disclosure key={issueId ?? "none"} id="runner-detail:shared" />
    </TaskChatExpansionState.Provider>
  );
}

describe("useIssueExpansionMemory", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    seen.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (issueId: string | null) =>
    act(() => root.render(<Thread issueId={issueId} />));
  const expanded = () =>
    container.querySelector("button")?.getAttribute("aria-expanded");

  it("keeps one memory per issue and drops choices when the issue changes", () => {
    render("issue-a");
    act(() => container.querySelector("button")!.click());
    expect(expanded()).toBe("false");
    const first = seen.at(-1)!;
    expect(first.get("runner-detail:shared")).toBe(false);

    render("issue-a");
    expect(seen.at(-1)).toBe(first);
    expect(expanded()).toBe("false");

    render("issue-b");
    const second = seen.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
    expect(expanded()).toBe("true");
  });
});
