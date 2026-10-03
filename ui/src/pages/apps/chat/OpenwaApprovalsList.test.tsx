// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { OpenwaApprovalsList } from "./OpenwaApprovalsList";

const mocks = vi.hoisted(() => ({ listOpenwaApprovals: vi.fn(), resolveOpenwaApproval: vi.fn() }));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: mocks }));

const approval = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "pending",
  categories: ["create_task", "external_tools"],
  scope: "one_action",
  summary: "Create a task for Budi's refund",
  proposedAction: "Open a task to refund order 812 and email the receipt",
  originChat: "+62xxx...4444",
  originConversationId: null,
  interactionId: null,
  reminderCount: 2,
  resolvedVia: null,
  resolvedByUserId: null,
  ownerText: null,
  agentConditions: null,
  resolvedAt: null,
  createdAt: "2026-10-03T05:00:00.000Z",
  grants: [],
  canResolve: true,
  ...overrides,
});

describe("OpenWA approvals list", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
          <OpenwaApprovalsList endpointId="endpoint-1" />
        </QueryClientProvider>,
      ),
    );
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.trim() === text);
  const click = (text: string) => act(() => button(text)!.click());
  const type = (value: string) => {
    const element = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const selectStatus = (value: string) => {
    const element = container.querySelector<HTMLSelectElement>("#openwa-approvals-status")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("lists pending requests with categories, scope, masked origin chat and reminders", async () => {
    mocks.listOpenwaApprovals.mockResolvedValue([approval("r1")]);
    render();
    await vi.waitFor(() => expect(container.textContent).toContain("Create a task for Budi's refund"));
    expect(mocks.listOpenwaApprovals).toHaveBeenCalledWith("endpoint-1", "pending");
    const text = container.textContent ?? "";
    expect(text).toContain("Open a task to refund order 812");
    expect(text).toContain("Create tasks");
    expect(text).toContain("External tools");
    expect(text).toContain("One action");
    expect(text).toContain("+62xxx...4444");
    expect(text).toContain("Reminders sent2");
    expect(button("Approve")).toBeDefined();
    expect(button("Reject")).toBeDefined();
  });

  it("approves with the typed conditions and refreshes the list", async () => {
    mocks.listOpenwaApprovals.mockResolvedValueOnce([approval("r1")]).mockResolvedValue([]);
    mocks.resolveOpenwaApproval.mockResolvedValue({ requestId: "r1", status: "approved", grantIds: ["g1"] });
    render();
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    click("Approve");
    type("  Only for order 812, no prices  ");
    click("Confirm approval");
    await vi.waitFor(() => expect(container.textContent).toContain("Request approved."));
    expect(mocks.resolveOpenwaApproval).toHaveBeenCalledWith("endpoint-1", "r1", { decision: "approve", reason: "Only for order 812, no prices" });
    await vi.waitFor(() => expect(container.textContent).toContain("No requests are waiting."));
    expect(mocks.listOpenwaApprovals).toHaveBeenCalledTimes(2);
  });

  it("rejects with the typed reason, and without one sends only the decision", async () => {
    mocks.listOpenwaApprovals.mockResolvedValue([approval("r1"), approval("r2", { summary: "Forward the invoice" })]);
    mocks.resolveOpenwaApproval.mockResolvedValue({ requestId: "r1", status: "rejected", grantIds: [] });
    render();
    await vi.waitFor(() => expect(container.querySelectorAll("li")).toHaveLength(2));
    const rowButton = (index: number, text: string) =>
      Array.from(container.querySelectorAll("li")[index]!.querySelectorAll("button")).find((node) => node.textContent?.trim() === text)!;
    act(() => rowButton(0, "Reject").click());
    type("We don't refund without a receipt");
    act(() => rowButton(0, "Confirm rejection").click());
    await vi.waitFor(() => expect(mocks.resolveOpenwaApproval).toHaveBeenCalledWith("endpoint-1", "r1", { decision: "reject", reason: "We don't refund without a receipt" }));
    await vi.waitFor(() => expect(container.textContent).toContain("Request rejected."));
    act(() => rowButton(1, "Reject").click());
    act(() => rowButton(1, "Confirm rejection").click());
    await vi.waitFor(() => expect(mocks.resolveOpenwaApproval).toHaveBeenLastCalledWith("endpoint-1", "r2", { decision: "reject" }));
  });

  it("refreshes and says another owner won when the request was already resolved", async () => {
    mocks.listOpenwaApprovals.mockResolvedValueOnce([approval("r1")]).mockResolvedValue([]);
    mocks.resolveOpenwaApproval.mockRejectedValue(
      new ApiError("This approval request has already been resolved", 409, {
        error: "This approval request has already been resolved",
        code: "already_resolved",
        details: { code: "already_resolved", requestStatus: "rejected" },
      }),
    );
    render();
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    click("Approve");
    click("Confirm approval");
    await vi.waitFor(() => expect(container.textContent).toContain("Another owner already rejected this request."));
    await vi.waitFor(() => expect(mocks.listOpenwaApprovals).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.textContent).toContain("No requests are waiting."));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Another owner already rejected");
  });

  it("explains that only endpoint owners can resolve when the server refuses with 403", async () => {
    mocks.listOpenwaApprovals.mockResolvedValue([approval("r1")]);
    mocks.resolveOpenwaApproval.mockRejectedValue(
      new ApiError("Only a current owner of the chat endpoint can resolve this approval", 403, { error: "Only a current owner of the chat endpoint can resolve this approval" }),
    );
    render();
    await vi.waitFor(() => expect(button("Reject")).toBeDefined());
    click("Reject");
    click("Confirm rejection");
    await vi.waitFor(() => expect(container.querySelector("[role=alert]")?.textContent).toContain("Only owners of this WhatsApp connection can approve or reject requests."));
  });

  it("shows a network error without losing the open decision", async () => {
    mocks.listOpenwaApprovals.mockResolvedValue([approval("r1")]);
    mocks.resolveOpenwaApproval.mockRejectedValue(new TypeError("Failed to fetch"));
    render();
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    click("Approve");
    type("ok");
    click("Confirm approval");
    await vi.waitFor(() => expect(container.querySelector("[role=alert]")?.textContent).toContain("Couldn't reach Paperclip."));
    expect(container.querySelector("textarea")?.value).toBe("ok");
    expect(button("Confirm approval")).toBeDefined();
  });

  it("shows view-only rows to non-owners without resolve actions", async () => {
    mocks.listOpenwaApprovals.mockResolvedValue([approval("r1", { canResolve: false })]);
    render();
    await vi.waitFor(() => expect(container.textContent).toContain("Create a task for Budi's refund"));
    expect(button("Approve")).toBeUndefined();
    expect(container.querySelector("[role=note]")?.textContent).toContain("Only owners of this WhatsApp connection");
  });

  it("shows the empty state and filters resolved requests", async () => {
    mocks.listOpenwaApprovals.mockImplementation(async (_id: string, status?: string) =>
      status === "approved"
        ? [approval("r9", { status: "approved", canResolve: false, resolvedVia: "whatsapp", resolvedAt: "2026-10-03T06:00:00.000Z", ownerText: "oke boleh", agentConditions: "No prices" })]
        : [],
    );
    render();
    await vi.waitFor(() => expect(container.textContent).toContain("No requests are waiting."));
    selectStatus("approved");
    await vi.waitFor(() => expect(mocks.listOpenwaApprovals).toHaveBeenLastCalledWith("endpoint-1", "approved"));
    await vi.waitFor(() => expect(container.textContent).toContain("via WhatsApp"));
    expect(container.textContent).toContain("oke boleh");
    expect(container.textContent).toContain("No prices");
    expect(button("Approve")).toBeUndefined();
    selectStatus("all");
    await vi.waitFor(() => expect(mocks.listOpenwaApprovals).toHaveBeenLastCalledWith("endpoint-1", undefined));
    await vi.waitFor(() => expect(container.textContent).toContain("No approval requests yet."));
  });
});
