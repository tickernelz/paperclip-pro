// @vitest-environment jsdom

import { act, useState } from "react";
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

function rawCalls() {
    return onChange.mock.calls.map(([value]) => value.raw);
  }

  function startTitleField() {
    type("title:");
    expect(container.querySelector('[data-testid="scoped-search-pending-field"]')?.textContent).toContain("title:");
  }

  it("does not re-emit an already emitted quoted field value when Enter commits the pill", () => {
    render();
    act(() => input().focus());
    startTitleField();
    type('"internal status"');
    settle();
    expect(rawCalls()).toEqual(['title:"internal status"']);
    key("Enter");
    settle();
    expect(pills()).toEqual(["title:internal status"]);
    expect(rawCalls()).toEqual(['title:"internal status"']);
  });

  it("emits a quoted field value once and immediately when Enter beats the debounce", () => {
    render();
    act(() => input().focus());
    startTitleField();
    type('"internal status"');
    key("Enter");
    expect(rawCalls()).toEqual(['title:"internal status"']);
    settle();
    expect(rawCalls()).toEqual(['title:"internal status"']);
    expect(pills()).toEqual(["title:internal status"]);
  });

  it("emits each Enter shape exactly once", () => {
    render();
    type("auth");
    key("Enter");
    expect(rawCalls()).toEqual(["auth"]);

    type("");
    startTitleField();
    type("deploy");
    key("Enter");
    expect(pills()).toEqual(["title:deploy"]);
    expect(rawCalls()).toEqual(["auth", "title:deploy"]);

    type("status:done");
    key("Enter");
    expect(pills()).toEqual(["title:deploy", "status:done"]);
    expect(input().value).toBe("");
    settle();
    expect(rawCalls()).toEqual(["auth", "title:deploy", "title:deploy status:done"]);
    expect(onChange).toHaveBeenLastCalledWith({
      raw: "title:deploy status:done",
      q: "title:deploy",
      filters: { status: ["done"] },
    });
  });

  it("picks the highlighted option on Enter without emitting a search", () => {
    render();
    act(() => input().focus());
    type("pri");
    key("ArrowDown");
    key("Enter");
    expect(container.querySelector('[data-testid="scoped-search-pending-field"]')?.textContent).toContain("priority:");
    key("ArrowDown");
    key("Enter");
    expect(pills()).toEqual(["priority:high"]);
    expect(rawCalls()).toEqual([]);
    settle();
    expect(rawCalls()).toEqual(["priority:high"]);
  });

  it("keeps the committed pill when a controlled parent echoes the emitted value back", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ScopedSearchInput
          value={value}
          context={context}
          ariaLabel="Search tasks"
          onChange={(next) => {
            onChange(next);
            setValue(next.raw);
          }}
        />
      );
    }
    act(() => {
      root.render(<Harness />);
    });
    act(() => input().focus());
    startTitleField();
    type('"internal status"');
    settle();
    key("Enter");
    settle();
    expect(pills()).toEqual(["title:internal status"]);
    expect(input().value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith({ raw: 'title:"internal status"', q: 'title:"internal status"', filters: {} });
  });

  function listbox() {
    return container.querySelector('[role="listbox"]');
  }

  it("closes the dropdown after Enter commits a filter typed character by character", () => {
    render();
    act(() => input().focus());
    type("s");
    type("status:");
    type("d");
    type("do");
    type("done");
    expect(container.querySelector('[data-testid="scoped-search-pending-field"]')?.textContent).toContain("status:");
    key("Enter");
    expect(pills()).toEqual(["status:done"]);
    expect(listbox()).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    settle();
    expect(onChange).toHaveBeenLastCalledWith({ raw: "status:done", q: "", filters: { status: ["done"] } });
  });

  it("closes the dropdown after Enter commits a pasted filter token", () => {
    render();
    act(() => input().focus());
    type("status:done");
    key("Enter");
    expect(pills()).toEqual(["status:done"]);
    expect(listbox()).toBeNull();
  });

  it("closes the dropdown after Enter picks a highlighted picker option", () => {
    render();
    act(() => input().focus());
    type("pri");
    key("ArrowDown");
    key("Enter");
    expect(listbox()).not.toBeNull();
    key("ArrowDown");
    key("Enter");
    expect(pills()).toEqual(["priority:high"]);
    expect(listbox()).toBeNull();
    key("ArrowDown");
    expect(listbox()).not.toBeNull();
  });

  it("keeps suggesting the next field after a value is committed with a space", () => {
    render();
    act(() => input().focus());
    type("label:bug ");
    expect(pills()).toEqual(["label:bug"]);
    expect(listbox()).not.toBeNull();
  });

  function keyEvent(name: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    act(() => {
      input().dispatchEvent(event);
    });
    return event;
  }

  function pendingField() {
    return container.querySelector('[data-testid="scoped-search-pending-field"]');
  }

  it("keeps spaces inside a pending field value without committing a pill", () => {
    render();
    act(() => input().focus());
    startTitleField();
    type("internal ");
    type("internal status ");
    expect(pills()).toEqual([]);
    expect(pendingField()?.textContent).toContain("title:");
    expect(input().value).toBe("internal status ");
  });

  it("commits the pending value on Tab and keeps focus in the input", () => {
    render();
    act(() => input().focus());
    startTitleField();
    type("internal status ");
    const event = keyEvent("Tab");
    expect(event.defaultPrevented).toBe(true);
    expect(pills()).toEqual(["title:internal status"]);
    expect(pendingField()).toBeNull();
    expect(document.activeElement).toBe(input());
    settle();
    expect(onChange).toHaveBeenLastCalledWith({ raw: 'title:"internal status"', q: 'title:"internal status"', filters: {} });
  });

  it("commits a multi-word value on Enter and emits once", () => {
    render();
    act(() => input().focus());
    startTitleField();
    type("internal status");
    key("Enter");
    settle();
    expect(pills()).toEqual(["title:internal status"]);
    expect(rawCalls()).toEqual(['title:"internal status"']);
  });

  it("leaves Tab alone when nothing is pending and the dropdown is closed", () => {
    render();
    type("auth");
    key("Escape");
    expect(keyEvent("Tab").defaultPrevented).toBe(false);
  });

  it("still commits a status picker selection immediately", () => {
    render();
    act(() => input().focus());
    type("status:");
    const done = Array.from(container.querySelectorAll('[role="option"]')).find((option) => option.textContent?.startsWith("Done"))!;
    act(() => done.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(pills()).toEqual(["status:done"]);
  });

  it("splits a pasted quoted field and filter into two pills", () => {
    render();
    type('title:"internal status" status:done ');
    expect(pills()).toEqual(["title:internal status", "status:done"]);
  });

  it("closes the dropdown on Escape", () => {
    render();
    act(() => input().focus());
    expect(options().length).toBeGreaterThan(0);
    key("Escape");
    expect(options()).toEqual([]);
  });
});
