// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenwaAuditTab } from "./OpenwaAuditTab";

const mocks = vi.hoisted(() => ({ listOpenwaAudit: vi.fn() }));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: mocks }));

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: "trigger_admitted",
  actorKind: "chat_principal",
  actorRef: "principal-1",
  chatKey: "628444000444@c.us",
  conversationId: null,
  runId: null,
  metadata: { rules: ["direct_message"], triggerClass: "other" },
  content: { text: "Is my order ready?" },
  contentPurged: false,
  occurredAt: "2026-10-03T05:00:00.000Z",
  ...overrides,
});

describe("OpenWA audit tab", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    client.clear();
    container.remove();
  });
  const render = () =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <OpenwaAuditTab endpointId="endpoint-1" />
        </QueryClientProvider>,
      ),
    );
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.trim() === text)!;
  const setValue = (selector: string, value: string) => {
    const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  };

  it("shows content for content readers, the purged badge, and pages with the cursor", async () => {
    mocks.listOpenwaAudit.mockImplementation(async (_id: string, _filters: unknown, cursor?: string) =>
      cursor
        ? { items: [entry("e3", { kind: "tool_called", actorKind: "agent", content: null, contentPurged: true, metadata: { tool: "openwa_send", latencyMs: 40 } })], nextCursor: null, access: "content" }
        : { items: [entry("e1"), entry("e2", { kind: "config_changed", actorKind: "user", content: null })], nextCursor: "cursor-2", access: "content" },
    );
    render();
    await vi.waitFor(() => expect(container.textContent).toContain("Is my order ready?"));
    expect(container.textContent).toContain("Trigger admitted");
    expect(container.textContent).toContain("628444000444@c.us");
    expect(container.textContent).toContain("direct_message");
    expect(container.textContent).not.toContain("You see metadata only");
    expect(mocks.listOpenwaAudit).toHaveBeenCalledWith("endpoint-1", {}, undefined);
    act(() => button("Next").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Content purged"));
    expect(mocks.listOpenwaAudit).toHaveBeenLastCalledWith("endpoint-1", {}, "cursor-2");
    expect(container.textContent).toContain("openwa_send");
    expect(button("Next").disabled).toBe(true);
    act(() => button("Previous").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Is my order ready?"));
  });

  it("explains metadata-only access and never renders returned content", async () => {
    mocks.listOpenwaAudit.mockResolvedValue({ items: [entry("e1", { content: null })], nextCursor: null, access: "metadata" });
    render();
    await vi.waitFor(() => expect(container.textContent).toContain("You see metadata only"));
    expect(container.textContent).not.toContain("Is my order ready?");
  });

  it("applies kind, actor, chat, and time filters and resets paging", async () => {
    mocks.listOpenwaAudit.mockResolvedValue({ items: [], nextCursor: null, access: "content" });
    render();
    await vi.waitFor(() => expect(container.textContent).toContain("No audit entries yet."));
    setValue("#openwa-audit-kind", "tool_called");
    setValue("#openwa-audit-actor", "agent");
    setValue("#openwa-audit-chat", " 628444000444@C.US ");
    setValue("#openwa-audit-from", "2026-10-01T08:00");
    act(() => button("Apply filters").click());
    await vi.waitFor(() =>
      expect(mocks.listOpenwaAudit).toHaveBeenLastCalledWith(
        "endpoint-1",
        { kind: "tool_called", actorKind: "agent", chatKey: "628444000444@c.us", from: new Date("2026-10-01T08:00").toISOString() },
        undefined,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("No audit entries match these filters."));
    act(() => button("Reset").click());
    await vi.waitFor(() => expect(mocks.listOpenwaAudit).toHaveBeenLastCalledWith("endpoint-1", {}, undefined));
  });

  it("shows the server error with a retry", async () => {
    mocks.listOpenwaAudit.mockRejectedValueOnce(new Error("Invalid audit query parameters"));
    mocks.listOpenwaAudit.mockResolvedValue({ items: [], nextCursor: null, access: "content" });
    render();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("Invalid audit query parameters"));
    act(() => button("Try again").click());
    await vi.waitFor(() => expect(container.textContent).toContain("No audit entries yet."));
  });
});
