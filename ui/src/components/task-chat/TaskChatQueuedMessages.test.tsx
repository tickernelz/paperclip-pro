// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueQueuedCommentQueue } from "@tickernelz/paperclip-pro-shared";
import {
  reorderQueuedMessageEntries,
  TaskChatQueuedMessages,
} from "./TaskChatQueuedMessages";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const queue: IssueQueuedCommentQueue = {
  issueId: "issue-1",
  queueId: "wake-1",
  state: "deferred",
  targetRunId: "run-1",
  revision: "rev-1",
  protocol: "paperclip_runner_v1",
  steeringDisposition: "available",
  entries: ["First queued message", "Second queued message"].map(
    (body, position) => ({
      comment: {
        id: `comment-${position + 1}`,
        companyId: "company-1",
        issueId: "issue-1",
        authorType: "user",
        authorAgentId: null,
        authorUserId: "user-1",
        body,
        presentation: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      position,
      canEdit: true,
      canDiscard: true,
    }),
  ),
};

function queueWithBodies(bodies: string[]): IssueQueuedCommentQueue {
  return {
    ...queue,
    entries: bodies.map((body, position) => ({
      ...queue.entries[0],
      comment: { ...queue.entries[0].comment, id: `comment-${position + 1}`, body },
      position,
    })),
  };
}

function rowIds(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll('[data-testid^="task-chat-queued-message-"]'),
  ).map((row) => row.getAttribute("data-testid"));
}

describe("TaskChatQueuedMessages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  function render(
    overrides: Partial<ComponentProps<typeof TaskChatQueuedMessages>> = {},
  ) {
    const props = {
      queue,
      onEdit: vi.fn(),
      onReorder: vi.fn().mockResolvedValue(undefined),
      onSteer: vi.fn().mockResolvedValue(undefined),
      onDiscard: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    flushSync(() => root.render(<TaskChatQueuedMessages {...props} />));
    return props;
  }

  it("shows the saved message's wait reason and removes it when admission succeeds", () => {
    const message = "Waiting for the previous environment to stop. Your message will start automatically.";
    render({ queue: { ...queue, executionWait: { reason: "remote_cleanup", message } } });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(message);
    expect(container.textContent).toContain("First queued message");
    render();
    expect(container.textContent).not.toContain(message);
  });

  it("renders each queued message once as a compact one-line row", () => {
    render();
    const pane = container.querySelector(
      '[data-testid="task-chat-queued-messages"]',
    );
    expect(pane?.classList).toContain("mx-3");
    expect(pane?.classList).toContain("rounded-b-none");
    expect(pane?.classList).toContain("border-b-0");
    expect(pane?.classList).toContain("-mb-px");
    expect(
      container.querySelectorAll('[data-testid^="task-chat-queued-message-"]'),
    ).toHaveLength(2);
    expect(container.textContent).toContain("First queued message");
    expect(container.textContent).toContain("Second queued message");
  });

  it.each(["legacy", "native", "native-plan"] as const)("shows a read-only response and sends it only on click for %s", async (runtime) => {
    const entry = { ...queue.entries[0], canEdit: false, canDiscard: false,
      comment: { ...queue.entries[0].comment, body: 'Accepted: Build the app\n\n{"revision": "v1"}' },
      source: { kind: "interaction" as const, interactionId: "confirmation-1", interactionKind: "request_confirmation",
        requiresFreshSession: runtime === "native-plan" } };
    const props = render({ queue: { ...queue, entries: [entry],
      protocol: runtime === "legacy" ? "legacy" : "paperclip_runner_v1" },
      onInterrupt: vi.fn().mockResolvedValue(undefined) });
    expect(props.onSteer).not.toHaveBeenCalled();
    expect(props.onInterrupt).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Accepted: Build the app");
    expect(container.textContent).not.toContain('"revision"');
    expect(container.querySelector<HTMLButtonElement>('[aria-label^="Reorder"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid^="task-chat-queued-discard-"]')?.disabled).toBe(true);
    expect(reorderQueuedMessageEntries([entry, queue.entries[1]], "comment-1", "comment-2")).toBeNull();
    const action = runtime === "native" ? "steer" : "interrupt";
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="task-chat-queued-${action}-comment-1"]`)!.click(); });
    if (action === "steer") expect(props.onSteer).toHaveBeenCalledWith("comment-1", "rev-1");
    else expect(props.onInterrupt).toHaveBeenCalledOnce();
  });

  it("reorders the complete queue and rewrites contiguous positions", () => {
    const next = reorderQueuedMessageEntries(
      queue.entries,
      "comment-2",
      "comment-1",
    );

    expect(next?.map((entry) => entry.comment.id)).toEqual([
      "comment-2",
      "comment-1",
    ]);
    expect(next?.map((entry) => entry.position)).toEqual([0, 1]);
  });

  it("promotes only the selected steering row immediately", async () => {
    const acknowledgement = deferred<void>();
    const props = render({
      onSteer: vi.fn().mockReturnValue(acknowledgement.promise),
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-steer-comment-1"]',
        )
        ?.click();
      await Promise.resolve();
    });
    expect(props.onSteer).toHaveBeenCalledWith("comment-1", "rev-1");
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-1"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-2"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      acknowledgement.resolve();
      await acknowledgement.promise;
    });
  });

  it("keeps a row queued when steering fails and announces the retryable state", async () => {
    render({
      onSteer: vi.fn().mockRejectedValue(new Error("steering_timeout")),
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-steer-comment-1"]',
        )
        ?.click();
    });
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-1"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Couldn’t steer. Message is still queued.",
    );
  });

  it("names the identity mismatch instead of the generic steer failure", async () => {
    render({
      onSteer: vi.fn().mockRejectedValue(
        Object.assign(new Error("steering identity mismatch"), {
          body: { details: { code: "steering_identity_mismatch" } },
        }),
      ),
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-steer-comment-1"]',
        )
        ?.click();
    });
    expect(container.textContent).toContain(
      "This message answers to a different user than the running turn.",
    );
    expect(container.textContent).not.toContain("Couldn’t steer.");
  });

  it("disables steering when the provider does not advertise it", () => {
    render({ queue: { ...queue, steeringDisposition: "unsupported" } });
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="task-chat-queued-steer-comment-1"]',
      )?.disabled,
    ).toBe(true);
  });

  it("waits for authoritative discard acknowledgement before removing the row", async () => {
    const acknowledgement = deferred<void>();
    render({ onDiscard: vi.fn().mockReturnValue(acknowledgement.promise) });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-comment-1"]',
        )
        ?.click();
      await Promise.resolve();
    });
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-1"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Queued message discarded.");

    await act(async () => {
      acknowledgement.resolve();
      await acknowledgement.promise;
    });
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-1"]',
      ),
    ).toBeNull();
    expect(container.textContent).toContain("Queued message discarded.");
  });

  it("keeps a too-late discard visible with an explicit error", async () => {
    render({
      onDiscard: vi.fn().mockRejectedValue({
        body: { details: { code: "queued_comment_already_dispatching" } },
      }),
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-comment-1"]',
        )
        ?.click();
    });
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-1"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Too late to discard: this message is already being sent.",
    );
  });

  it("shows stale revisions without announcing a discard", async () => {
    render({
      onDiscard: vi.fn().mockRejectedValue({
        body: { details: { code: "queued_comment_revision_conflict" } },
      }),
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-comment-1"]',
        )
        ?.click();
    });
    expect(container.textContent).toContain(
      "The queue changed in another session. Review it and try again.",
    );
    expect(container.textContent).not.toContain("Queued message discarded.");
  });

  it("does not expose queue controls before a real queue id is acknowledged", () => {
    const props = render({ queue: { ...queue, queueId: null, state: null } });
    const discard = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-chat-queued-discard-comment-1"]',
    );
    expect(discard?.disabled).toBe(true);
    discard?.click();
    expect(props.onDiscard).not.toHaveBeenCalled();
  });

  it("can discard a local optimistic row before the queue id is acknowledged", async () => {
    const optimisticQueue = {
      ...queue,
      queueId: null,
      state: "deferred" as const,
      entries: [
        {
          ...queue.entries[0],
          comment: {
            ...queue.entries[0].comment,
            id: "optimistic-local-1",
          },
        },
      ],
    };
    const props = render({ queue: optimisticQueue });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-optimistic-local-1"]',
        )
        ?.click();
    });

    expect(props.onDiscard).toHaveBeenCalledWith("optimistic-local-1", "rev-1");
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-optimistic-local-1"]',
      ),
    ).toBeNull();
  });

  it.each(["run-1", null])("delivers legacy queued messages with target %s", async (targetRunId) => {
    const onInterrupt = vi.fn().mockResolvedValue(undefined);
    render({
      queue: {
        ...queue,
        targetRunId,
        protocol: "legacy",
        steeringDisposition: "unsupported",
      },
      onInterrupt,
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-interrupt-comment-1"]',
        )
        ?.click();
    });

    expect(onInterrupt).toHaveBeenCalledOnce();
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-steer-comment-1"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="task-chat-queued-message-comment-1"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Queued messages will be sent when the previous run has stopped.",
    );
  });
  it("starts collapsed to the next message when more than three are queued", async () => {
    render({ queue: queueWithBodies(["One", "Two", "Three", "Four"]) });
    expect(container.textContent).toContain("4 queued");
    expect(rowIds(container)).toEqual(["task-chat-queued-message-comment-1"]);
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-chat-queued-toggle"]',
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rowIds(container)).toHaveLength(4);
    expect(
      container.querySelector('[data-testid="task-chat-queued-list"]')?.classList,
    ).toContain("max-h-44");
  });

  it("shows every message without a toggle when three or fewer are queued", () => {
    render({ queue: queueWithBodies(["One", "Two", "Three"]) });
    expect(container.textContent).toContain("3 queued");
    expect(rowIds(container)).toHaveLength(3);
    expect(
      container.querySelector('[data-testid="task-chat-queued-toggle"]'),
    ).toBeNull();
  });

  it("collapses consecutive identical messages and discards all of them", async () => {
    const props = render({ queue: queueWithBodies(["Same", "Same", "Same", "Other"]) });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="task-chat-queued-toggle"]')
        ?.click();
    });
    expect(rowIds(container)).toEqual([
      "task-chat-queued-message-comment-1",
      "task-chat-queued-message-comment-4",
    ]);
    expect(
      container.querySelector('[data-testid="task-chat-queued-count-comment-1"]')
        ?.textContent,
    ).toBe("×3");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-comment-1"]',
        )
        ?.click();
    });
    expect(vi.mocked(props.onDiscard).mock.calls).toEqual([
      ["comment-1", "rev-1"],
      ["comment-2", "rev-1"],
      ["comment-3", "rev-1"],
    ]);
    expect(rowIds(container)).toEqual(["task-chat-queued-message-comment-4"]);
    expect(container.textContent).toContain("3 queued messages discarded.");
  });

  it("keeps identical messages from different authors as separate rows", () => {
    const base = queueWithBodies(["ok", "ok", "ok"]);
    const queue = {
      ...base,
      entries: base.entries.map((entry, index) =>
        index === 1 ? { ...entry, comment: { ...entry.comment, authorUserId: "user-2" } } : entry,
      ),
    };
    render({ queue });
    expect(rowIds(container)).toEqual([
      "task-chat-queued-message-comment-1",
      "task-chat-queued-message-comment-2",
      "task-chat-queued-message-comment-3",
    ]);
    expect(container.querySelector('[data-testid^="task-chat-queued-count-"]')).toBeNull();
  });

  it("keeps identical messages from external chat senders as separate rows", () => {
    const base = queueWithBodies(["ok", "ok"]);
    const queue = {
      ...base,
      entries: base.entries.map((entry) => ({
        ...entry,
        comment: { ...entry.comment, authorType: "system" as const, authorUserId: null, authorAgentId: null },
      })),
    };
    render({ queue });
    expect(rowIds(container)).toEqual([
      "task-chat-queued-message-comment-1",
      "task-chat-queued-message-comment-2",
    ]);
  });

  it("steers only the first message of a collapsed group", async () => {
    const props = render({ queue: queueWithBodies(["Same", "Same"]) });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="task-chat-queued-steer-comment-1"]')
        ?.click();
    });
    expect(props.onSteer).toHaveBeenCalledOnce();
    expect(props.onSteer).toHaveBeenCalledWith("comment-1", "rev-1");
    expect(rowIds(container)).toEqual(["task-chat-queued-message-comment-2"]);
  });

  it("discards every real message after confirming discard all", async () => {
    const base = queueWithBodies(["One", "Two", "Three"]);
    const props = render({
      queue: {
        ...base,
        entries: [
          ...base.entries,
          {
            ...base.entries[0],
            comment: { ...base.entries[0].comment, id: "optimistic-local-1", body: "Local" },
            position: 3,
          },
        ],
      },
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="task-chat-queued-discard-all"]')
        ?.click();
    });
    expect(props.onDiscard).not.toHaveBeenCalled();
    const dialog = document.querySelector(
      '[data-testid="task-chat-queued-discard-all-dialog"]',
    );
    expect(dialog?.textContent).toContain("3 queued messages will be removed");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-all-confirm"]',
        )
        ?.click();
    });
    expect(vi.mocked(props.onDiscard).mock.calls).toEqual([
      ["comment-1", "rev-1"],
      ["comment-2", "rev-1"],
      ["comment-3", "rev-1"],
    ]);
    expect(rowIds(container)).toEqual([
      "task-chat-queued-message-optimistic-local-1",
    ]);
  });

  it("stops discard all at the first failure and keeps the rest queued", async () => {
    const onDiscard = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({
        body: { details: { code: "queued_comment_already_dispatching" } },
      });
    render({ queue: queueWithBodies(["One", "Two", "Three"]), onDiscard });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="task-chat-queued-discard-all"]')
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-chat-queued-discard-all-confirm"]',
        )
        ?.click();
    });
    expect(onDiscard).toHaveBeenCalledTimes(2);
    expect(rowIds(container)).toEqual([
      "task-chat-queued-message-comment-2",
      "task-chat-queued-message-comment-3",
    ]);
    expect(container.textContent).toContain(
      "Too late to discard: this message is already being sent.",
    );
  });

  it("disables discard all until the queue id is acknowledged", () => {
    render({ queue: { ...queue, queueId: null, state: null } });
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="task-chat-queued-discard-all"]',
      )?.disabled,
    ).toBe(true);
  });
});
