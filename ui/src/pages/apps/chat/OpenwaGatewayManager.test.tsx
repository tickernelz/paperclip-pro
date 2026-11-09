// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { OPENWA_QR_REFRESH_MS, OpenwaGatewayManager } from "./OpenwaGatewayManager";

const mocks = vi.hoisted(() => ({
  api: { runOpenwaGatewayAdmin: vi.fn(), setup: vi.fn() },
  pushToast: vi.fn(),
}));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: mocks.api }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: mocks.pushToast }) }));

const OWN = "own-session";
const OTHER = "sales-session";
type Call = { operationId: string; sessionId?: string; args?: Record<string, unknown>; confirmOwnSession?: boolean };

describe("OpenWA gateway manager", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let sessionStatus: string[];
  let qrCodes: string[];
  let keys: Array<Record<string, unknown>>;

  const reply = (call: Call, data: unknown) => ({ operationId: call.operationId, sessionId: call.sessionId ?? null, data, revealed: false });

  beforeEach(() => {
    vi.resetAllMocks();
    sessionStatus = ["qr_ready", "qr_ready", "ready"];
    qrCodes = ["data:image/png;base64,FIRST", "data:image/png;base64,SECOND", "data:image/png;base64,THIRD"];
    keys = [];
    mocks.api.runOpenwaGatewayAdmin.mockImplementation(async (_endpointId: string, call: Call) => {
      switch (call.operationId) {
        case "SessionController_findAll":
          return reply(call, [
            { id: OWN, name: "agent", status: "ready", phone: "628111" },
            { id: OTHER, name: "sales", status: "qr_ready", phone: null },
          ]);
        case "SessionController_findOne":
          return reply(call, { id: call.sessionId, status: sessionStatus.length > 1 ? sessionStatus.shift() : sessionStatus[0], pushName: "Sales", phone: "628999" });
        case "SessionController_getQRCode":
          return { ...reply(call, { qrCode: qrCodes.length > 1 ? qrCodes.shift() : qrCodes[0], status: "qr_ready" }), revealed: true };
        case "AuthController_findAll":
          return reply(call, keys);
        case "AuthController_create":
          keys = [{ id: "k1", name: String(call.args?.name), keyPrefix: "owa_k1_abcd", role: "operator", isActive: true }];
          return { ...reply(call, { ...keys[0], apiKey: "owa_k1_abcd_FULL_SECRET" }), revealed: true };
        default:
          return reply(call, []);
      }
    });
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
    vi.useRealTimers();
  });

  const render = () =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <OpenwaGatewayManager endpointId="endpoint-1" ownSessionId={OWN} />
        </QueryClientProvider>,
      ),
    );
  const calls = (operationId: string) => mocks.api.runOpenwaGatewayAdmin.mock.calls.map((entry) => entry[1] as Call).filter((call) => call.operationId === operationId);
  const row = (label: string) => document.querySelector<HTMLElement>('li[aria-label="' + label + '"]')!;
  const button = (scope: ParentNode, text: string) => Array.from(scope.querySelectorAll("button")).find((node) => node.textContent?.trim() === text)!;
  const click = (element: HTMLElement) => act(() => element.click());
  const setValue = (element: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    act(() => element.dispatchEvent(new Event("input", { bubbles: true })));
  };
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

  it("reloads the QR code until the session connects, then stops asking the gateway for it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render();
    await vi.waitFor(() => expect(row("Session sales")).toBeTruthy());
    click(button(row("Session sales"), "Connect"));
    const qr = () => dialog()?.querySelector<HTMLImageElement>('img[alt="WhatsApp login QR code"]');
    await vi.waitFor(() => expect(qr()?.getAttribute("src")).toBe("data:image/png;base64,FIRST"));
    await act(() => vi.advanceTimersByTimeAsync(OPENWA_QR_REFRESH_MS));
    await vi.waitFor(() => expect(qr()?.getAttribute("src")).toBe("data:image/png;base64,SECOND"));
    await act(() => vi.advanceTimersByTimeAsync(OPENWA_QR_REFRESH_MS));
    await vi.waitFor(() => expect(dialog().textContent).toContain("Connected as Sales · 628999"));
    expect(qr()).toBeNull();
    const fetched = calls("SessionController_getQRCode").length;
    await act(() => vi.advanceTimersByTimeAsync(OPENWA_QR_REFRESH_MS * 3));
    expect(calls("SessionController_getQRCode").length).toBe(fetched);
  });

  it("asks for an explicit acknowledgement before stopping the agent's own session", async () => {
    render();
    await vi.waitFor(() => expect(row("Session agent")).toBeTruthy());
    click(button(row("Session agent"), "Stop"));
    const confirm = () => button(dialog(), "Stop");
    expect(confirm().disabled).toBe(true);
    click(dialog().querySelector<HTMLElement>("#openwa-own-session-ack")!);
    expect(confirm().disabled).toBe(false);
    click(confirm());
    await vi.waitFor(() => expect(calls("SessionController_stop")).toEqual([{ operationId: "SessionController_stop", sessionId: OWN, confirmOwnSession: true }]));

    click(button(row("Session sales"), "Stop"));
    expect(dialog().querySelector("#openwa-own-session-ack")).toBeNull();
    click(button(dialog(), "Stop"));
    await vi.waitFor(() => expect(calls("SessionController_stop")[1]).toEqual({ operationId: "SessionController_stop", sessionId: OTHER, confirmOwnSession: undefined }));
  });

  it("shows a new API key once and keeps only its prefix after it is dismissed", async () => {
    render();
    const section = () => document.querySelector<HTMLElement>('section[aria-label="OpenWA API keys"]')!;
    await vi.waitFor(() => expect(section().textContent).not.toContain("Loading keys"));
    setValue(section().querySelector<HTMLInputElement>('input[aria-label="Key name"]')!, "ops");
    click(button(section(), "Create key"));
    await vi.waitFor(() => expect(section().textContent).toContain("owa_k1_abcd_FULL_SECRET"));
    expect(calls("AuthController_create")[0]!.args).toEqual({ name: "ops", role: "operator" });
    click(button(section(), "Done"));
    await vi.waitFor(() => expect(row("Key ops").textContent).toContain("owa_k1_abcd…"));
    expect(section().textContent).not.toContain("FULL_SECRET");
  });
  it("asks for the admin key right where session management was refused, then loads the sessions", async () => {
    let saved = false;
    const fallback = mocks.api.runOpenwaGatewayAdmin.getMockImplementation()!;
    mocks.api.runOpenwaGatewayAdmin.mockImplementation(async (endpointId: string, call: Call) => {
      if (!saved && call.operationId === "SessionController_findAll")
        throw new ApiError("Managing OpenWA sessions needs the OpenWA admin key.", 422, { error: "x", details: { code: "openwa_admin_key_required" }, code: "openwa_admin_key_required" });
      return fallback(endpointId, call);
    });
    mocks.api.setup.mockImplementation(async () => {
      saved = true;
      return { id: "endpoint-1" };
    });
    render();
    const field = () => document.querySelector<HTMLInputElement>("#openwa-sessions-admin-key");
    await vi.waitFor(() => expect(field()).toBeTruthy());
    setValue(field()!, "admin-secret-123");
    click(button(field()!.parentElement!, "Save admin key"));
    await vi.waitFor(() => expect(mocks.api.setup).toHaveBeenCalledWith("endpoint-1", { action: "reconnect", credentials: { adminApiKey: "admin-secret-123" } }));
    await vi.waitFor(() => expect(row("Session sales")).toBeTruthy());
    expect(field()).toBeNull();
    expect(document.body.textContent).not.toContain("admin-secret-123");
  });
});
