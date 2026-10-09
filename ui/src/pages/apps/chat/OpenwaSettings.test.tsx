// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openwaEndpointPolicySchema } from "@tickernelz/paperclip-pro-shared";
import type { ChatEndpoint } from "@/api/chatEndpoints";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { OpenwaSettings } from "./OpenwaSettings";
import { openwaDedicatedGroupSettings } from "./openwa-settings-model";

const mocks = vi.hoisted(() => ({
  api: {
    getOpenwaHealth: vi.fn(),
    updateOpenwaPolicy: vi.fn(),
    listOpenwaOwners: vi.fn(),
    addOpenwaOwner: vi.fn(),
    removeOpenwaOwner: vi.fn(),
    listOpenwaSenderRules: vi.fn(),
    addOpenwaSenderRule: vi.fn(),
    removeOpenwaSenderRule: vi.fn(),
    listOpenwaChats: vi.fn(),
    updateOpenwaChat: vi.fn(),
    listOpenwaGatewayChats: vi.fn(),
    listOpenwaLinkedSessions: vi.fn(),
    setup: vi.fn(),
  },
  getAgent: vi.fn(),
  pushToast: vi.fn(),
  caps: vi.fn(),
}));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: mocks.api }));
vi.mock("@/api/agents", () => ({ agentsApi: { get: mocks.getAgent } }));
vi.mock("@/adapters/use-adapter-capabilities", () => ({ useAdapterCapabilities: () => mocks.caps }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: mocks.pushToast }) }));

const policy = openwaEndpointPolicySchema.parse({ attestations: { pacing: true, soleClient: true } });
const endpoint = {
  id: "endpoint-1",
  companyId: "company-1",
  provider: "openwa",
  status: "active",
  assignedAgentId: "agent-1",
  assignedAgentName: "Maya",
  allowUnlinkedPeople: false,
  policy,
  policyRevision: 3,
  inflightMode: "steer",
} as ChatEndpoint;

const health = {
  gatewayVersion: "0.23.7",
  pinnedVersion: "0.23.7",
  engine: "whatsapp-web.js",
  session: { status: "ready", maskedNumber: "+62xxx...5678", restriction: null },
  pacing: { attested: true, observedAt: null },
  adminKeyConfigured: false,
  gatewayError: null,
  checkedAt: "2026-10-03T00:00:00.000Z",
};

describe("OpenWA settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.api.getOpenwaHealth.mockResolvedValue(health);
    mocks.api.listOpenwaOwners.mockResolvedValue([
      { id: "owner-1", identityLinkId: "l", principalId: "p", numberMasked: "+62xxx...1111", displayName: "Ops Desk", linkStatus: "linked", paperclipUserId: "u", effective: true, createdAt: "2026-10-03T00:00:00.000Z" },
    ]);
    mocks.api.listOpenwaSenderRules.mockResolvedValue([
      { id: "rule-1", list: "allow", e164: "+628444000444", label: "Supplier", createdAt: "2026-10-03T00:00:00.000Z" },
    ]);
    mocks.api.listOpenwaChats.mockResolvedValue([
      {
        id: "res-1",
        chatId: "120363000000000001@g.us",
        chatKey: "120363000000000001@g.us",
        type: "group_chat",
        label: "Ops group",
        availability: "available",
        enabled: true,
        settings: { activation: "on", replyPolicy: "ask_owner" },
        ownerPresent: true,
        participantCount: 4,
      },
    ]);
    mocks.api.listOpenwaLinkedSessions.mockResolvedValue([]);
    mocks.api.listOpenwaGatewayChats.mockResolvedValue([
      { chatId: "628555000555@c.us", isGroup: false, name: "+62xxx...0555", lastActivityAt: null, activation: "auto", configured: false },
    ]);
    mocks.api.updateOpenwaPolicy.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      policy: openwaEndpointPolicySchema.parse({ ...policy, ...patch, approvals: { ...policy.approvals, ...(patch.approvals as object) } }),
      policyRevision: 4,
    }));
    mocks.getAgent.mockResolvedValue({ id: "agent-1", adapterType: "gemini_local", adapterConfig: {} });
    mocks.caps.mockReturnValue({ supportsLiveSteering: false, readOnlyToolProfile: "instruction_only" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(queryKeys.chatEndpoints.detail(endpoint.id), endpoint);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    client.clear();
    container.remove();
  });

  const render = (value: ChatEndpoint = endpoint) =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <OpenwaSettings endpoint={value} />
        </QueryClientProvider>,
      ),
    );
  const section = (title: string) => container.querySelector<HTMLElement>(`section[aria-label="${title}"]`)!;
  const button = (scope: HTMLElement, text: string) =>
    Array.from(scope.querySelectorAll("button")).find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)!;
  const setValue = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const prototype =
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  };
  const field = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const click = (element: HTMLElement) => act(() => element.click());
  const loaded = () => vi.waitFor(() => expect(container.textContent).toContain("whatsapp-web.js"));

  it("shows the health card and adapter capability warnings", async () => {
    render();
    await loaded();
    const card = section("Gateway health");
    expect(card.textContent).toContain("0.23.7");
    expect(card.textContent).toContain("ready · +62xxx...5678");
    expect(card.textContent).toContain("Attested · not yet observed");
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Capability warnings"]')).not.toBeNull());
    const warnings = container.querySelector('[aria-label="Capability warnings"]')!.textContent!;
    expect(warnings).toContain("gemini_local) cannot steer a running turn");
    expect(warnings).toContain("instruction-only for the gemini_local adapter");
    expect(mocks.caps).toHaveBeenCalledWith("gemini_local");
  });

  it("lists owners, validates E.164 inline, and shows the identity-link URL after adding", async () => {
    mocks.api.addOpenwaOwner.mockResolvedValue({ owner: null, created: true, confirmationUrl: "/chat-identity-links/confirm?token=t", expiresAt: "2026-10-03T01:00:00.000Z" });
    render();
    await vi.waitFor(() => expect(section("Owners").textContent).toContain("+62xxx...1111"));
    const owners = section("Owners");
    expect(owners.textContent).toContain("Linked to Ops Desk");
    setValue(field<HTMLInputElement>("#openwa-owner-number"), "0812");
    click(button(owners, "Add owner"));
    expect(field("#openwa-owner-number-error").textContent).toContain("E.164");
    expect(mocks.api.addOpenwaOwner).not.toHaveBeenCalled();
    setValue(field<HTMLInputElement>("#openwa-owner-number"), "+6281234567890");
    click(button(owners, "Add owner"));
    await vi.waitFor(() => expect(owners.textContent).toContain("Private identity-link URL"));
    expect(mocks.api.addOpenwaOwner).toHaveBeenCalledWith("endpoint-1", "+6281234567890");
    expect(owners.textContent).toContain("/chat-identity-links/confirm?token=t");
    click(button(owners, "Remove owner +62xxx...1111"));
    await vi.waitFor(() => expect(mocks.api.removeOpenwaOwner).toHaveBeenCalledWith("endpoint-1", "owner-1"));
  });

  it("saves the sender mode and adds list entries with labels", async () => {
    mocks.api.addOpenwaSenderRule.mockResolvedValue({});
    render();
    await vi.waitFor(() => expect(section("Sender policy").textContent).toContain("+628444000444"));
    const sender = section("Sender policy");
    expect(sender.textContent).toContain("Supplier");
    setValue(field<HTMLSelectElement>("#openwa-sender-mode"), "denylist");
    click(button(sender, "Save sender mode"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenCalledWith("endpoint-1", { senderPolicyMode: "denylist" }));
    await vi.waitFor(() => expect(sender.textContent).toContain("Saved"));
    expect(client.getQueryData<ChatEndpoint>(queryKeys.chatEndpoints.detail(endpoint.id))?.policy?.senderPolicyMode).toBe("denylist");
    click(button(sender, "Answer group members who address the agent"));
    click(button(sender, "Save group replies"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", { groupMemberReplies: false }));
    setValue(field<HTMLInputElement>("#openwa-deny-number"), "12345");
    click(button(sender, "Add to denylist"));
    expect(field("#openwa-deny-number-error").textContent).toContain("E.164");
    setValue(field<HTMLInputElement>("#openwa-deny-number"), "+628777000777");
    setValue(field<HTMLInputElement>("#openwa-deny-label"), "Spam");
    click(button(sender, "Add to denylist"));
    await vi.waitFor(() =>
      expect(mocks.api.addOpenwaSenderRule).toHaveBeenCalledWith("endpoint-1", { list: "deny", e164: "+628777000777", label: "Spam" }),
    );
  });

  it("validates approval bounds inline and saves every approval field", async () => {
    render();
    await loaded();
    const approvals = section("Approvals");
    setValue(field<HTMLInputElement>("#openwa-max-reminders"), "11");
    click(button(approvals, "Save approvals"));
    expect(field("#openwa-max-reminders-error").textContent).toBeTruthy();
    expect(field<HTMLInputElement>("#openwa-max-reminders").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.api.updateOpenwaPolicy).not.toHaveBeenCalled();
    setValue(field<HTMLInputElement>("#openwa-max-reminders"), "5");
    expect(field<HTMLInputElement>("#openwa-pending-ttl").value).toBe("24");
    setValue(field<HTMLInputElement>("#openwa-pending-ttl"), "169");
    click(button(approvals, "Save approvals"));
    expect(field("#openwa-pending-ttl-error").textContent).toBe("Use at most 168");
    expect(mocks.api.updateOpenwaPolicy).not.toHaveBeenCalled();
    setValue(field<HTMLInputElement>("#openwa-pending-ttl"), "0");
    click(button(approvals, "Save approvals"));
    expect(field("#openwa-pending-ttl-error").textContent).toBe("Use at least 1");
    expect(mocks.api.updateOpenwaPolicy).not.toHaveBeenCalled();
    setValue(field<HTMLInputElement>("#openwa-pending-ttl"), "72");
    setValue(field<HTMLInputElement>("#openwa-reminder-minutes"), "45");
    setValue(field<HTMLInputElement>("#openwa-grant-ttl"), "48");
    click(button(approvals, "Creating or delegating tasks"));
    click(button(approvals, "Save approvals"));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaPolicy).toHaveBeenCalledWith("endpoint-1", {
        approvals: { createTask: false, externalTools: true, crossChatSend: true, waAdmin: true, gatewayAdmin: true, reminderMinutes: 45, maxReminders: 5, grantTtlHours: 48, pendingTtlHours: 72 },
      }),
    );
  });

  it("surfaces server validation errors on the matching field", async () => {
    mocks.api.updateOpenwaPolicy.mockRejectedValue(
      new ApiError("Invalid OpenWA policy", 422, { error: "Invalid OpenWA policy", details: { issues: [{ path: ["rotateAfterIdleHours"], message: "Server says no" }] } }),
    );
    render();
    await loaded();
    setValue(field<HTMLInputElement>("#openwa-rotate-hours"), "12");
    click(button(section("Conversation"), "Save conversation"));
    await vi.waitFor(() => expect(field("#openwa-rotate-hours-error").textContent).toBe("Server says no"));
    expect(field<HTMLSelectElement>("#openwa-inflight-mode").value).toBe("steer");
    expect(section("Conversation").textContent).not.toContain("read-only here");
  });

  it("saves the in-flight mode with the conversation settings", async () => {
    mocks.api.updateOpenwaPolicy.mockResolvedValue({ policy, policyRevision: 4, inflightMode: "queue" });
    render();
    await loaded();
    const conversation = section("Conversation");
    expect(conversation.textContent).toContain("steered into the running turn");
    setValue(field<HTMLSelectElement>("#openwa-inflight-mode"), "queue");
    expect(conversation.textContent).toContain("New messages wait for the next run.");
    click(button(conversation, "Save conversation"));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaPolicy).toHaveBeenCalledWith("endpoint-1", { rotateAfterIdleHours: policy.rotateAfterIdleHours, inflightMode: "queue" }),
    );
    await vi.waitFor(() => expect(client.getQueryData<ChatEndpoint>(queryKeys.chatEndpoints.detail(endpoint.id))?.inflightMode).toBe("queue"));
  });

  it("round-trips triggers, progress, prefix, admin level, instructions, and retention", async () => {
    render();
    await loaded();
    setValue(field<HTMLInputElement>("#openwa-keywords"), "invoice, refund");
    setValue(field<HTMLInputElement>("#openwa-absence-seconds"), "300");
    setValue(field<HTMLSelectElement>("#openwa-reply-policy"), "ask_owner");
    click(button(section("Triggers and replies"), "All messages"));
    click(button(section("Triggers and replies"), "Save triggers"));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", {
        replyPolicy: "ask_owner",
        absenceSeconds: 300,
        triggers: { ...policy.triggers, allMessages: true, keywords: ["invoice", "refund"] },
      }),
    );
    setValue(field<HTMLInputElement>("#openwa-nudge-seconds"), "0");
    click(button(section("Progress"), "Typing indicator"));
    click(button(section("Progress"), "Save progress"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", { progressNudgeSeconds: 0, typingIndicator: false }));
    setValue(field<HTMLInputElement>("#openwa-owner-prefix"), "Bot:");
    click(button(section("Owner number label"), "Save label"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", { ownerNumberPrefix: { enabled: true, text: "Bot:" } }));
    setValue(field<HTMLSelectElement>("#openwa-admin-level"), "read");
    click(button(section("Gateway admin tools"), "Save admin level"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", { gatewayAdminTools: "read" }));
    setValue(field<HTMLTextAreaElement>("#openwa-custom-instructions"), "Reply in Indonesian.");
    click(button(section("Custom instructions"), "Save instructions"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", { customInstructions: "Reply in Indonesian." }));
    setValue(field<HTMLInputElement>("#openwa-audit-retention"), "0");
    click(button(section("Audit retention"), "Save retention"));
    expect(field("#openwa-audit-retention-error").textContent).toBeTruthy();
    setValue(field<HTMLInputElement>("#openwa-audit-retention"), "30");
    click(button(section("Audit retention"), "Save retention"));
    await vi.waitFor(() => expect(mocks.api.updateOpenwaPolicy).toHaveBeenLastCalledWith("endpoint-1", { auditContentRetentionDays: 30 }));
  });

  it("rejects over-long custom instructions and prefix with whitespace before saving", async () => {
    render();
    await loaded();
    setValue(field<HTMLTextAreaElement>("#openwa-custom-instructions"), "x".repeat(8001));
    click(button(section("Custom instructions"), "Save instructions"));
    expect(field("#openwa-custom-instructions-error").textContent).toBeTruthy();
    setValue(field<HTMLInputElement>("#openwa-command-prefix"), "two words");
    click(button(section("Triggers and replies"), "Save triggers"));
    expect(field("#openwa-command-prefix-error").textContent).toBeTruthy();
    expect(mocks.api.updateOpenwaPolicy).not.toHaveBeenCalled();
  });

  it("replaces the admin key through reconnect credentials without echoing it", async () => {
    mocks.api.setup.mockRejectedValueOnce(new Error("OpenWA rejected admin-secret-123"));
    mocks.api.setup.mockResolvedValueOnce({ ...endpoint, status: "verifying" });
    render();
    await loaded();
    const admin = section("Gateway admin tools");
    expect(admin.textContent).toContain("No admin key is saved");
    setValue(field<HTMLInputElement>("#openwa-admin-key"), "admin-secret-123");
    click(button(admin, "Save admin key"));
    await vi.waitFor(() => expect(field("#openwa-admin-key-error").textContent).toContain("[redacted]"));
    expect(container.textContent).not.toContain("admin-secret-123");
    expect(mocks.api.setup).toHaveBeenCalledWith("endpoint-1", { action: "reconnect", credentials: { adminApiKey: "admin-secret-123" } });
    click(button(admin, "Save admin key"));
    await vi.waitFor(() => expect(field<HTMLInputElement>("#openwa-admin-key").value).toBe(""));
  });

  it("edits a configured chat and configures a chat picked from the gateway", async () => {
    mocks.api.updateOpenwaChat.mockResolvedValue({});
    render();
    await vi.waitFor(() => expect(section("Chats").textContent).toContain("Ops group"));
    const chats = section("Chats");
    expect(chats.textContent).toContain("an owner is in this group");
    click(button(chats, "Edit"));
    expect(field<HTMLSelectElement>("#openwa-chat-activation").value).toBe("on");
    expect(field<HTMLSelectElement>("#openwa-chat-reply").value).toBe("ask_owner");
    setValue(field<HTMLInputElement>("#openwa-chat-absence"), "5");
    click(button(chats, "Save chat"));
    expect(field("#openwa-chat-absence-error").textContent).toBeTruthy();
    expect(mocks.api.updateOpenwaChat).not.toHaveBeenCalled();
    setValue(field<HTMLInputElement>("#openwa-chat-absence"), "600");
    setValue(field<HTMLSelectElement>("#openwa-chat-trigger-agentMentioned"), "off");
    setValue(field<HTMLTextAreaElement>("#openwa-chat-note"), "Vendors only");
    click(button(chats, "Save chat"));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaChat).toHaveBeenCalledWith("endpoint-1", {
        chatId: "120363000000000001@g.us",
        label: "Ops group",
        settings: { activation: "on", replyPolicy: "ask_owner", absenceSeconds: 600, triggers: { agentMentioned: false }, note: "Vendors only" },
      }),
    );
    click(button(chats, "Add a chat from WhatsApp"));
    await vi.waitFor(() => expect(chats.textContent).toContain("+62xxx...0555"));
    click(button(chats, "Configure"));
    setValue(field<HTMLSelectElement>("#openwa-chat-activation"), "off");
    click(button(chats, "Save chat"));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaChat).toHaveBeenLastCalledWith("endpoint-1", {
        chatId: "628555000555@c.us",
        label: "+62xxx...0555",
        settings: { activation: "off" },
      }),
    );
  });

  it("builds dedicated-group settings by turning the chat on and adding allMessages to the existing overrides", () => {
    expect(openwaDedicatedGroupSettings(null)).toEqual({ activation: "on", triggers: { allMessages: true } });
    expect(
      openwaDedicatedGroupSettings({
        activation: "off",
        replyPolicy: "ask_owner",
        absenceSeconds: 600,
        note: "Warehouse",
        triggers: { agentMentioned: false, keywords: ["invoice"], allMessages: false },
      }),
    ).toEqual({
      activation: "on",
      replyPolicy: "ask_owner",
      absenceSeconds: 600,
      note: "Warehouse",
      triggers: { agentMentioned: false, keywords: ["invoice"], allMessages: true },
    });
  });

  it("turns a group into a dedicated group in one click and offers it only for groups", async () => {
    const group = {
      id: "res-2",
      chatId: "120363000000000002@g.us",
      chatKey: "120363000000000002@g.us",
      type: "group_chat",
      label: "Wira desk",
      availability: "available",
      enabled: false,
      settings: { activation: "auto", replyPolicy: "ask_owner", note: "Warehouse", triggers: { keywords: ["invoice"], agentMentioned: false } },
      ownerPresent: true,
      participantCount: 2,
    };
    const direct = { ...group, id: "res-3", chatId: "628555000555@c.us", chatKey: "628555000555@c.us", type: "direct_message", label: "Supplier", settings: { activation: "on" } };
    mocks.api.listOpenwaChats.mockResolvedValue([group, direct]);
    mocks.api.listOpenwaGatewayChats.mockResolvedValue([
      { chatId: "120363000000000009@g.us", isGroup: true, name: "Fresh group", lastActivityAt: null, activation: "auto", configured: false },
    ]);
    mocks.api.updateOpenwaChat.mockResolvedValue({});
    render();
    await vi.waitFor(() => expect(section("Chats").textContent).toContain("Wira desk"));
    const chats = section("Chats");
    const rows = Array.from(chats.querySelectorAll("li"));
    const label = "Dedicated group: reply to every message";
    expect(rows.map((row) => Array.from(row.querySelectorAll("button")).some((node) => node.textContent?.trim() === label))).toEqual([true, false]);
    click(button(chats, label));
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaChat).toHaveBeenCalledWith("endpoint-1", {
        chatId: "120363000000000002@g.us",
        label: "Wira desk",
        settings: { activation: "on", replyPolicy: "ask_owner", note: "Warehouse", triggers: { keywords: ["invoice"], agentMentioned: false, allMessages: true } },
      }),
    );
    click(button(chats, "Add a chat from WhatsApp"));
    await vi.waitFor(() => expect(chats.textContent).toContain("Fresh group"));
    const picked = Array.from(chats.querySelectorAll('ul[aria-label="Gateway chats"] button')).find((node) => node.textContent?.trim() === label) as HTMLButtonElement;
    click(picked);
    await vi.waitFor(() =>
      expect(mocks.api.updateOpenwaChat).toHaveBeenLastCalledWith("endpoint-1", {
        chatId: "120363000000000009@g.us",
        label: "Fresh group",
        settings: { activation: "on", triggers: { allMessages: true } },
      }),
    );
  });
});
