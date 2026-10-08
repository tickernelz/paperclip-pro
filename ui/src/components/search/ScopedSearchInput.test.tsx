// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScopedSearchInput, type ScopedSearchValue } from "./ScopedSearchInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const context = {
  currentUserId: "user-1",
  agents: [{ id: "agent-1", name: "Codex Coder" }],
  projects: [{ id: "11111111-1111-4111-8111-111111111111", name: "Paperclip App" }],
  labels: [{ id: "22222222-2222-4222-8222-222222222222", name: "bug" }],
};

describe("ScopedSearchInput", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onChange: ReturnType<typeof vi.fn<(value: ScopedSearchValue) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onChange = vi.fn<(value: ScopedSearchValue) => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(value = "") {
    act(() => {
      root.render(<ScopedSearchInput value={value} onChange={onChange} context={context} ariaLabel="Search tasks" />);
    });
  }

  function input() {
    return container.querySelector('input[aria-label="Search tasks"]') as HTMLInputElement;
  }

  function type(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function key(name: string) {
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    });
  }

  function options() {
    return Array.from(container.querySelectorAll('[role="option"]')).map((option) => option.querySelector("span")?.textContent);
  }

  function pills() {
    return Array.from(container.querySelectorAll('[data-testid="scoped-search-pill"]')).map((pill) => pill.textContent);
  }

  function settle() {
    act(() => {
      vi.advanceTimersByTime(250);
    });
  }

  it("shows the field dropdown on focus with every searchable field", () => {
    render();
    expect(input().placeholder).toBe('Search title, ID, description… (pick a field or type "exact phrase")');
    act(() => input().focus());
    expect(options()).toEqual([
      "Title", "ID", "Description", "Comments", "Documents", "All text",
      "Status", "Priority", "Assignee", "Label", "Project", "Author", "Updated",
    ]);
  });

  it("inserts a text field pill from the dropdown and emits the scoped query", () => {
    render();
    act(() => input().focus());
    const title = Array.from(container.querySelectorAll('[role="option"]')).find((option) => option.textContent?.startsWith("Title"))!;
    act(() => title.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector('[data-testid="scoped-search-pending-field"]')?.textContent).toContain("title:");
    type("internal status");
    key("Enter");
    expect(pills()).toEqual(["title:internal status"]);
    expect(onChange).toHaveBeenLastCalledWith({ raw: 'title:"internal status"', q: 'title:"internal status"', filters: {} });
  });

  it("navigates value pickers with the keyboard and turns filters into params", () => {
    render();
    act(() => input().focus());
    type("sta");
    expect(options()).toEqual(["Status"]);
    key("ArrowDown");
    key("Enter");
    expect(options()).toContain("Done");
    type("do");
    expect(options()).toEqual(["Done", "Todo"]);
    key("Enter");
    expect(pills()).toEqual(["status:done"]);
    type("auth");
    settle();
    expect(onChange).toHaveBeenLastCalledWith({ raw: "status:done auth", q: "auth", filters: { status: ["done"] } });
  });

  it("debounces typing by 250 ms", () => {
    render();
    type("au");
    type("auth");
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ raw: "auth", q: "auth", filters: {} });
  });

  it("turns typed tokens into pills after a space and removes the last pill with Backspace", () => {
    render();
    type("label:bug ");
    expect(pills()).toEqual(["label:bug"]);
    expect(input().value).toBe("");
    type("comment:deploy ");
    expect(pills()).toEqual(["label:bug", "comment:deploy"]);
    key("Backspace");
    expect(pills()).toEqual(["label:bug"]);
    settle();
    expect(onChange).toHaveBeenLastCalledWith({
      raw: "label:bug",
      q: "",
      filters: { labelId: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("removes a pill with its remove button", () => {
    render('id:ZHA-9 assignee:"Codex Coder" crash');
    expect(pills()).toEqual(["id:ZHA-9", "assignee:Codex Coder"]);
    expect(input().value).toBe("crash");
    const remove = container.querySelector('button[aria-label="Remove assignee:Codex Coder"]')!;
    act(() => remove.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(pills()).toEqual(["id:ZHA-9"]);
    settle();
    expect(onChange).toHaveBeenLastCalledWith({ raw: "id:ZHA-9 crash", q: "id:ZHA-9 crash", filters: {} });
  });

  it("closes the dropdown on Escape", () => {
    render();
    act(() => input().focus());
    expect(options().length).toBeGreaterThan(0);
    key("Escape");
    expect(options()).toEqual([]);
  });
});
