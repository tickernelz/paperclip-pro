// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskChatComposer } from "@/components/task-chat/TaskChatComposer";
import { IssueChatComposer } from "@/components/IssueChatThread";
import type { MessageDeliveryDisposition } from "@/lib/message-delivery-command";

vi.mock("@mdxeditor/editor", async () => {
  const React = await import("react");
  function setForwardedRef<T>(ref: React.ForwardedRef<T | null>, value: T | null) {
    if (typeof ref === "function") ref(value);
    else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
  }
  const MDXEditor = React.forwardRef(function MockMDXEditor(
    { markdown, onChange, contentEditableClassName }: {
      markdown: string;
      onChange?: (value: string) => void;
      contentEditableClassName?: string;
    },
    forwardedRef: React.ForwardedRef<{
      setMarkdown: (value: string) => void;
      insertMarkdown: (value: string) => void;
      focus: (callback?: () => void) => void;
    } | null>,
  ) {
    const editableRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef(markdown);
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    React.useImperativeHandle(forwardedRef, () => ({
      setMarkdown: (value: string) => {
        contentRef.current = value;
        if (editableRef.current) editableRef.current.textContent = value;
      },
      insertMarkdown: () => {},
      focus: (callback?: () => void) => callback?.(),
    }));
    return React.createElement("div", {
      "data-testid": "mdx-editor",
      "data-contenteditable-class-name": contentEditableClassName,
      contentEditable: true,
      suppressContentEditableWarning: true,
      ref: editableRef,
      onInput: (event: React.FormEvent<HTMLDivElement>) => {
        contentRef.current = event.currentTarget.textContent ?? "";
        onChangeRef.current?.(contentRef.current);
      },
    });
  });
  return {
    CodeMirrorEditor: () => null,
    MDXEditor,
    codeBlockPlugin: () => ({}),
    codeMirrorPlugin: () => ({}),
    createRootEditorSubscription$: Symbol("createRootEditorSubscription$"),
    headingsPlugin: () => ({}),
    imagePlugin: () => ({}),
    linkDialogPlugin: () => ({}),
    linkPlugin: () => ({}),
    listsPlugin: () => ({}),
    markdownShortcutPlugin: () => ({}),
    quotePlugin: () => ({}),
    realmPlugin: (plugin: unknown) => plugin,
    tablePlugin: () => ({}),
    thematicBreakPlugin: () => ({}),
  };
});

vi.mock("../lib/mention-deletion", () => ({
  mentionDeletionPlugin: () => ({}),
}));

vi.mock("../lib/paste-normalization", () => ({
  pasteNormalizationPlugin: () => ({}),
}));

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  container.remove();
});

function render(element: ReactElement) {
  flushSync(() => root!.render(element));
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function editable(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-testid="mdx-editor"]')!;
}

function typeIntoComposer(value: string) {
  const el = editable();
  flushSync(() => {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickSend() {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) =>
      element.textContent?.trim() === "Send" ||
      element.getAttribute("data-testid") === "task-chat-composer-send",
  ) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  flushSync(() => button!.click());
}

type Harness = {
  name: string;
  render: (props: {
    onAdd: (body: string, ...rest: unknown[]) => Promise<MessageDeliveryDisposition | void>;
    defaultMessageDelivery?: "steer" | "queue";
  }) => ReactElement;
  noticeTestId: string;
  errorTestId: string;
};

const HARNESSES: Harness[] = [
  {
    name: "TaskChatComposer",
    render: ({ onAdd, defaultMessageDelivery }) => (
      <TaskChatComposer
        onAdd={onAdd as never}
        workMode="standard"
        defaultMessageDelivery={defaultMessageDelivery}
      />
    ),
    noticeTestId: "task-chat-delivery-notice",
    errorTestId: "task-chat-goal-error",
  },
  {
    name: "IssueChatComposer",
    render: ({ onAdd, defaultMessageDelivery }) => (
      <IssueChatComposer
        onSend={onAdd as never}
        defaultMessageDelivery={defaultMessageDelivery}
      />
    ),
    noticeTestId: "issue-chat-delivery-notice",
    errorTestId: "issue-chat-delivery-error",
  },
];

describe.each(HARNESSES)("$name delivery commands", (harness) => {
  it("sends the bare prompt with no mode, so the server applies the global default", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(harness.render({ onAdd, defaultMessageDelivery: "queue" }));

    typeIntoComposer("look at the failing test");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(onAdd).toHaveBeenCalledWith(
      "look at the failing test",
      undefined,
      undefined,
      undefined,
      expect.any(String),
      undefined,
    );
  });

  it("strips /steer and forces the steer mode", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(harness.render({ onAdd, defaultMessageDelivery: "queue" }));

    typeIntoComposer("/steer look at the failing test");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(onAdd).toHaveBeenCalledWith(
      "look at the failing test",
      undefined,
      undefined,
      undefined,
      expect.any(String),
      "steer",
    );
  });

  it("strips /queue and forces the queue mode even when the default steers", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(harness.render({ onAdd, defaultMessageDelivery: "steer" }));

    typeIntoComposer("/queue write the summary");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(onAdd).toHaveBeenCalledWith(
      "write the summary",
      undefined,
      undefined,
      undefined,
      expect.any(String),
      "queue",
    );
  });

  it("absorbs the MDXEditor autolink shape for /steer instead of posting a link", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(harness.render({ onAdd, defaultMessageDelivery: "queue" }));

    typeIntoComposer("[/steer](</steer look at the failing test>)");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(onAdd).toHaveBeenCalledWith(
      "look at the failing test",
      undefined,
      undefined,
      undefined,
      expect.any(String),
      "steer",
    );
  });

  it("absorbs the MDXEditor autolink shape for /queue too", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(harness.render({ onAdd, defaultMessageDelivery: "steer" }));

    typeIntoComposer("[/queue](</queue write the summary>)");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(onAdd).toHaveBeenCalledWith(
      "write the summary",
      undefined,
      undefined,
      undefined,
      expect.any(String),
      "queue",
    );
  });

  it("refuses a command with no message rather than sending an empty prompt", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(harness.render({ onAdd }));

    typeIntoComposer("/steer");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(onAdd).not.toHaveBeenCalled();
    const error = container.querySelector(`[data-testid="${harness.errorTestId}"]`);
    expect(error?.textContent).toContain("/steer needs a message");
  });

  it("shows a downgraded steer instead of a silent success", async () => {
    const onAdd = vi
      .fn()
      .mockResolvedValue({ deliveredAs: "queued", steeringUnavailable: "no_active_run" });
    render(harness.render({ onAdd, defaultMessageDelivery: "steer" }));

    typeIntoComposer("/steer look at the failing test");
    clickSend();
    await flushAsync();
    await flushAsync();

    const notice = container.querySelector(`[data-testid="${harness.noticeTestId}"]`);
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toContain("Queued instead of steering");
    expect(notice?.textContent).toContain("no active run");
  });

  it("shows nothing when the steer actually landed", async () => {
    const onAdd = vi.fn().mockResolvedValue({ deliveredAs: "steered" });
    render(harness.render({ onAdd, defaultMessageDelivery: "steer" }));

    typeIntoComposer("look at the failing test");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(container.querySelector(`[data-testid="${harness.noticeTestId}"]`)).toBeNull();
  });

  it("shows nothing for an explicit /queue that queued as asked", async () => {
    const onAdd = vi
      .fn()
      .mockResolvedValue({ deliveredAs: "queued", steeringUnavailable: "not_requested" });
    render(harness.render({ onAdd, defaultMessageDelivery: "steer" }));

    typeIntoComposer("/queue write the summary");
    clickSend();
    await flushAsync();
    await flushAsync();

    expect(container.querySelector(`[data-testid="${harness.noticeTestId}"]`)).toBeNull();
  });

  it("clears the downgrade notice once the user types the next message", async () => {
    const onAdd = vi
      .fn()
      .mockResolvedValue({ deliveredAs: "queued", steeringUnavailable: "board_only" });
    render(harness.render({ onAdd, defaultMessageDelivery: "steer" }));

    typeIntoComposer("/steer look at the failing test");
    clickSend();
    await flushAsync();
    await flushAsync();
    expect(container.querySelector(`[data-testid="${harness.noticeTestId}"]`)).not.toBeNull();

    typeIntoComposer("and again");
    await flushAsync();
    expect(container.querySelector(`[data-testid="${harness.noticeTestId}"]`)).toBeNull();
  });
});
