// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEndpoint } from "@/api/chatEndpoints";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OpenwaConnectStep } from "./OpenwaConnectStep";
import { openwaSetupInput } from "./ChatEndpointSetup";

const mocks = vi.hoisted(() => ({ inspectOpenwa: vi.fn(), runOpenwaGatewayAdmin: vi.fn() }));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: mocks }));

const endpoint = {
  id: "endpoint-1",
  companyId: "company-1",
  provider: "openwa",
  status: "draft",
  assignedAgentId: "agent-1",
  assignedAgentName: "Maya",
  allowUnlinkedPeople: false,
} as ChatEndpoint;

const inspection = {
  baseUrl: "http://localhost:2785",
  gatewayVersion: "0.27.1",
  pinnedVersion: "0.27.1",
  engine: "whatsapp-web.js",
  keyRole: "operator",
  adminKey: null,
  warnings: ["This key can see 2 sessions, so it is not scoped to one session."],
  eligible: true,
  sessions: [
    { sessionId: "session-a", name: "ops", status: "ready", maskedNumber: "+62xxx...5678", pushName: "Ops Desk", eligible: true },
    { sessionId: "session-b", name: "spare", status: "qr_ready", maskedNumber: null, pushName: null, eligible: false, unavailableReason: "The session is qr ready" },
  ],
};

describe("OpenWA connect step", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const onAction = vi.fn();
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
  const render = (target: ChatEndpoint = endpoint, repairing = false) =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <OpenwaConnectStep endpoint={target} agentName="Maya" repairing={repairing} pending={false} onAction={onAction} onSaveExit={() => {}} />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes(text))!;
  const type = (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = (element: HTMLElement) => act(() => element.click());

  it("inspects the gateway, shows the session, and requires both attestations before connecting", async () => {
    mocks.inspectOpenwa.mockResolvedValue(inspection);
    render();
    expect(button("Inspect gateway").disabled).toBe(true);
    type("#openwa-base-url", "http://localhost:2785");
    type("#openwa-api-key", "secret-operator-key");
    click(button("Inspect gateway"));
    await vi.waitFor(() => expect(container.textContent).toContain("whatsapp-web.js"));
    expect(mocks.inspectOpenwa).toHaveBeenCalledWith("endpoint-1", { baseUrl: "http://localhost:2785", apiKey: "secret-operator-key" });
    expect(container.textContent).toContain("0.27.1");
    expect(container.textContent).toContain("operator");
    expect(container.textContent).toContain("+62xxx...5678");
    expect(container.textContent).toContain("not scoped to one session");
    const sessions = container.querySelectorAll<HTMLInputElement>('input[name="openwa-session"]');
    expect(sessions[0].checked).toBe(true);
    expect(sessions[1].disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="openwa-number-mode"]')!.checked).toBe(true);
    expect(container.textContent).toContain("visible prefix");
    const connect = button("Connect session");
    expect(connect.disabled).toBe(true);
    const [pacing, soleClient] = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    click(pacing);
    expect(button("Connect session").disabled).toBe(true);
    click(soleClient);
    expect(button("Connect session").disabled).toBe(false);
    click(container.querySelectorAll<HTMLInputElement>('input[name="openwa-number-mode"]')[1]);
    click(button("Connect session"));
    expect(onAction).toHaveBeenCalledWith("configure", {
      baseUrl: "http://localhost:2785",
      apiKey: "secret-operator-key",
      sessionId: "session-a",
      numberMode: "owner_number",
      pacing: "true",
      soleClient: "true",
    });
    expect(container.textContent).not.toContain("secret-operator-key");
  });

  it("redacts the key from inspection errors", async () => {
    mocks.inspectOpenwa.mockRejectedValue(new Error("OpenWA rejected secret-operator-key"));
    render();
    type("#openwa-base-url", "http://localhost:2785");
    type("#openwa-api-key", "secret-operator-key");
    click(button("Inspect gateway"));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("[redacted]"));
    expect(container.textContent).not.toContain("secret-operator-key");
  });

  it("maps step values to the setup request with keys only in credentials", () => {
    expect(openwaSetupInput("configure", {
      baseUrl: "http://localhost:2785",
      apiKey: "k",
      adminApiKey: "a",
      sessionId: "session-a",
      numberMode: "agent_number",
      pacing: "true",
      soleClient: "false",
    })).toEqual({
      action: "configure",
      credentials: { apiKey: "k", adminApiKey: "a" },
      openwa: { baseUrl: "http://localhost:2785", sessionId: "session-a", numberMode: "agent_number", attestations: { pacing: true, soleClient: false } },
    });
  });
  it("creates a WhatsApp session with only the admin key, shows its QR, and selects it once it is ready", async () => {
    const empty = { ...inspection, keyRole: "admin", adminKey: { role: "admin" }, canManageSessions: true, agentKeyMinted: true, warnings: [], eligible: false, sessions: [] };
    const linked = { ...empty, eligible: true, sessions: [{ sessionId: "new-session", name: "pmo", status: "ready", maskedNumber: "+62xxx...9999", pushName: "PMO", eligible: true }] };
    mocks.inspectOpenwa.mockResolvedValueOnce(empty).mockResolvedValueOnce(linked);
    let status = "qr_ready";
    mocks.runOpenwaGatewayAdmin.mockImplementation(async (_id: string, call: { operationId: string; sessionId?: string }) => {
      const reply = (data: unknown) => ({ operationId: call.operationId, sessionId: call.sessionId ?? null, data, revealed: false });
      if (call.operationId === "SessionController_create") return reply({ id: "new-session", name: "pmo", status: "created" });
      if (call.operationId === "SessionController_findOne") return reply({ id: "new-session", status });
      if (call.operationId === "SessionController_getQRCode") return reply({ qrCode: "data:image/png;base64,QR" });
      return reply({});
    });
    render();
    type("#openwa-base-url", "http://localhost:2785");
    type("#openwa-admin-api-key", "secret-admin-key");
    click(button("Inspect gateway"));
    await vi.waitFor(() => expect(container.textContent).toContain("no WhatsApp session yet"));
    expect(mocks.inspectOpenwa).toHaveBeenCalledWith("endpoint-1", { baseUrl: "http://localhost:2785", adminApiKey: "secret-admin-key" });
    click(button("Create new WhatsApp session"));
    click(button("Create and show QR"));
    expect(container.textContent).toContain("Use 1-64 letters");
    expect(mocks.runOpenwaGatewayAdmin).not.toHaveBeenCalled();
    type("#openwa-new-session-name", "pmo");
    click(button("Create and show QR"));
    await vi.waitFor(() => expect(container.querySelector('img[alt="WhatsApp login QR code"]')).toBeTruthy());
    const connection = { baseUrl: "http://localhost:2785", adminApiKey: "secret-admin-key" };
    expect(mocks.runOpenwaGatewayAdmin.mock.calls.slice(0, 2)).toEqual([
      ["endpoint-1", { operationId: "SessionController_create", args: { name: "pmo" }, connection }],
      ["endpoint-1", { operationId: "SessionController_start", sessionId: "new-session", connection }],
    ]);
    status = "ready";
    await vi.waitFor(() => expect(mocks.inspectOpenwa).toHaveBeenCalledTimes(2), { timeout: 6_000 });
    await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>('input[value="new-session"]')?.checked).toBe(true));
    expect(container.querySelector('img[alt="WhatsApp login QR code"]')).toBeNull();
    const [pacing, soleClient] = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    click(pacing);
    click(soleClient);
    click(button("Connect session"));
    expect(onAction).toHaveBeenCalledWith("configure", {
      baseUrl: "http://localhost:2785",
      adminApiKey: "secret-admin-key",
      sessionId: "new-session",
      numberMode: "agent_number",
      pacing: "true",
      soleClient: "true",
    });
    expect(container.textContent).not.toContain("secret-admin-key");
  });

  it("adds an admin key on reconnect without retyping the operator key", () => {
    const saved = {
      ...endpoint,
      status: "attention",
      providerAccountId: "http://localhost:2785#session-a",
      policy: { numberMode: "agent_number", attestations: { pacing: true, soleClient: true } },
    } as unknown as ChatEndpoint;
    render(saved, true);
    type("#openwa-admin-api-key", "secret-admin-key");
    click(button("Reconnect OpenWA"));
    expect(onAction).toHaveBeenCalledWith("reconnect", {
      baseUrl: "http://localhost:2785",
      sessionId: "session-a",
      adminApiKey: "secret-admin-key",
      numberMode: "agent_number",
      pacing: "true",
      soleClient: "true",
    });
    expect(openwaSetupInput("reconnect", onAction.mock.calls[0]![1])).toMatchObject({ credentials: { adminApiKey: "secret-admin-key" } });
  });
});
