// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenwaLinkedNumbers } from "./OpenwaLinkedNumbers";

const mocks = vi.hoisted(() => ({
  api: {
    listOpenwaLinkedSessions: vi.fn(),
    listOpenwaLinkableSessions: vi.fn(),
    linkOpenwaSession: vi.fn(),
    updateOpenwaLinkedChats: vi.fn(),
    unlinkOpenwaSession: vi.fn(),
    listOpenwaLinkedGatewayChats: vi.fn(),
  },
  pushToast: vi.fn(),
}));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: mocks.api }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: mocks.pushToast }) }));

const linked = {
  id: "linked-1",
  sessionId: "session-2",
  label: "Personal",
  phoneMasked: "+62xxx...0123",
  pushName: "Zhafron",
  status: "active",
  allowedChats: [{ chatId: "628333000444@c.us", label: "Friend", isGroup: false }],
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};

describe("OpenWA linked numbers settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.api.listOpenwaLinkedSessions.mockResolvedValue([linked]);
    mocks.api.listOpenwaLinkableSessions.mockResolvedValue([
      { sessionId: "session-3", name: "work", status: "ready", phoneMasked: "+62xxx...0999", pushName: "Work" },
    ]);
    mocks.api.listOpenwaLinkedGatewayChats.mockResolvedValue([
      { chatId: "628333000444@c.us", isGroup: false, name: "Friend", allowed: true },
      { chatId: "120363000000000777@g.us", isGroup: true, name: "Family", allowed: false },
      { chatId: "628444000555@c.us", isGroup: false, name: "Landlord", allowed: false },
    ]);
    mocks.api.linkOpenwaSession.mockResolvedValue({ ...linked, id: "linked-2", sessionId: "session-3", label: "Work", allowedChats: [] });
    mocks.api.updateOpenwaLinkedChats.mockResolvedValue(linked);
    mocks.api.unlinkOpenwaSession.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    client.clear();
    container.remove();
    document.body.innerHTML = "";
  });

  const render = () =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <OpenwaLinkedNumbers endpointId="endpoint-1" />
        </QueryClientProvider>,
      ),
    );
  const section = () => container.querySelector<HTMLElement>('section[aria-label="Linked numbers"]')!;
  const button = (scope: ParentNode, text: string) =>
    Array.from(scope.querySelectorAll("button")).find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)!;
  const click = (element: HTMLElement) => act(() => element.click());
  const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  };

  it("lists linked numbers with their masked number and allowed chat count, never a key", async () => {
    render();
    await vi.waitFor(() => expect(section().textContent).toContain("Personal"));
    expect(section().textContent).toContain("+62xxx...0123 · Read-only · 1 chats allowed");
    expect(section().textContent).not.toMatch(/apiKey|secret/i);
  });

  it("links a gateway session with a label through the dialog", async () => {
    render();
    await vi.waitFor(() => expect(section().textContent).toContain("Personal"));
    click(button(section(), "Link a number"));
    await vi.waitFor(() => expect(document.querySelector("#openwa-linked-session")).not.toBeNull());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    click(button(dialog, "Link number"));
    expect(document.querySelector("#openwa-linked-label-error")?.textContent).toBe("Choose a WhatsApp session");
    expect(mocks.api.linkOpenwaSession).not.toHaveBeenCalled();
    setValue(document.querySelector<HTMLSelectElement>("#openwa-linked-session")!, "session-3");
    setValue(document.querySelector<HTMLInputElement>("#openwa-linked-label")!, "  Work phone ");
    click(button(dialog, "Link number"));
    await vi.waitFor(() => expect(mocks.api.linkOpenwaSession).toHaveBeenCalledWith("endpoint-1", { sessionId: "session-3", label: "Work phone" }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it("shows the server's admin-key requirement in the link dialog", async () => {
    mocks.api.listOpenwaLinkableSessions.mockRejectedValue(new Error("Linking a number needs the OpenWA admin key."));
    render();
    await vi.waitFor(() => expect(section().textContent).toContain("Personal"));
    click(button(section(), "Link a number"));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain("needs the OpenWA admin key"));
  });

  it("picks chats with search across groups and contacts and saves the allowlist", async () => {
    render();
    await vi.waitFor(() => expect(section().textContent).toContain("Personal"));
    click(button(section(), "Choose chats"));
    const picker = () => container.querySelector<HTMLElement>('[aria-label="Chats for Personal"]')!;
    await vi.waitFor(() => expect(picker().textContent).toContain("Family"));
    expect(picker().textContent).toContain("Groups");
    expect(picker().textContent).toContain("Contacts");
    expect(picker().textContent).toContain("1 selected");
    setValue(picker().querySelector<HTMLInputElement>('input[aria-label="Search chats"]')!, "fam");
    expect(picker().textContent).not.toContain("Landlord");
    click(picker().querySelector<HTMLElement>('[id="openwa-linked-chat-linked-1-120363000000000777@g.us"]')!);
    expect(picker().textContent).toContain("2 selected");
    click(button(picker(), "Save chats"));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaLinkedChats).toHaveBeenCalledWith("endpoint-1", "linked-1", [
        { chatId: "628333000444@c.us", label: "Friend", isGroup: false },
        { chatId: "120363000000000777@g.us", label: "Family", isGroup: true },
      ]),
    );
  });

  it("unlinks only after confirmation", async () => {
    render();
    await vi.waitFor(() => expect(section().textContent).toContain("Personal"));
    click(button(section(), "Unlink Personal"));
    const confirm = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(confirm.textContent).toContain("revokes the key");
    click(button(confirm, "Keep"));
    expect(mocks.api.unlinkOpenwaSession).not.toHaveBeenCalled();
    click(button(section(), "Unlink Personal"));
    click(button(container.querySelector<HTMLElement>('[role="alertdialog"]')!, "Unlink"));
    await vi.waitFor(() => expect(mocks.api.unlinkOpenwaSession).toHaveBeenCalledWith("endpoint-1", "linked-1"));
  });
});
