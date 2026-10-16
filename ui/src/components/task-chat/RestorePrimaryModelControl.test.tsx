// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunModelFallbackState } from "@tickernelz/paperclip-pro-shared";
import {
  RESTORE_PRIMARY_MODEL_COMMENT,
  RestorePrimaryModelControl,
} from "./RestorePrimaryModelControl";

const mockIssuesApi = vi.hoisted(() => ({ addComment: vi.fn() }));
const mockHeartbeatsApi = vi.hoisted(() => ({ cancel: vi.fn() }));

vi.mock("../../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../../api/heartbeats", () => ({ heartbeatsApi: mockHeartbeatsApi }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fallback: RunModelFallbackState = {
  primaryModel: "openai/gpt-5",
  activeModel: "openrouter/qwen3",
  reason: "rate_limit",
  switchedAt: "2026-10-16T10:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root | null = null;
let queryClient: QueryClient;

function render(node: ReactNode) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

function click(target: Element) {
  flushSync(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function control(issueId = "issue-7", runId = "run-9") {
  return (
    <RestorePrimaryModelControl
      issueId={issueId}
      run={{ id: runId, modelFallback: fallback }}
      companyId="company-1"
      taskLabel="ZHA-1"
    />
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockIssuesApi.addComment.mockReset();
  mockHeartbeatsApi.cancel.mockReset();
});

afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("RestorePrimaryModelControl", () => {
  it("stays hidden while the run is on its primary model", () => {
    render(
      <RestorePrimaryModelControl issueId="issue-7" run={{ id: "run-9", modelFallback: null }} />,
    );
    expect(container.querySelector('[data-slot="restore-primary-model"]')).toBeNull();
  });

  it("cancels the fallback run, then wakes the assignee back to the primary model", async () => {
    const calls: string[] = [];
    mockHeartbeatsApi.cancel.mockImplementation(async (runId: string) => {
      calls.push(`cancel:${runId}`);
    });
    mockIssuesApi.addComment.mockImplementation(async (issueId: string, body: string) => {
      calls.push(`comment:${issueId}:${body}`);
    });

    render(control());
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Back to the primary model on ZHA-1");
    click(button!);

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls).toEqual([
      "cancel:run-9",
      `comment:issue-7:${RESTORE_PRIMARY_MODEL_COMMENT}`,
    ]);
    expect(mockHeartbeatsApi.cancel).toHaveBeenCalledWith("run-9");
    expect(mockIssuesApi.addComment).toHaveBeenCalledWith(
      "issue-7",
      "Kembali ke model utama.",
      undefined,
      undefined,
      undefined,
      expect.any(String),
    );
  });

  it("reports a failed restore instead of stopping the run silently", async () => {
    mockHeartbeatsApi.cancel.mockRejectedValue(new Error("Run already finished."));
    render(control());
    click(container.querySelector("button")!);
    await waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Run already finished."),
    );
    expect(mockIssuesApi.addComment).not.toHaveBeenCalled();
  });
});
