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

const mocks = vi.hoisted(() => ({ inspectOpenwa: vi.fn() }));
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
  gatewayVersion: "0.23.7",
  pinnedVersion: "0.23.7",
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
  const render = () =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <OpenwaConnectStep endpoint={endpoint} agentName="Maya" repairing={false} pending={false} onAction={onAction} onSaveExit={() => {}} />
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
    expect(container.textContent).toContain("0.23.7");
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
});
