// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDetail } from "./AgentDetail";
import { BreadcrumbProvider } from "../context/BreadcrumbContext";
import { CompanyProvider } from "../context/CompanyContext";
import { DialogProvider } from "../context/DialogContext";
import { PanelProvider } from "../context/PanelContext";
import { SidebarProvider } from "../context/SidebarContext";
import { ToastProvider } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const denial = "This chat source is no longer authorized.";

const company = {
  id: companyId,
  name: "Acme",
  issuePrefix: "ACME",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let agentUrlKey = "maya";

const agentRecord = () => ({
  id: agentId,
  companyId,
  name: "Maya",
  urlKey: agentUrlKey,
  role: "process",
  status: "active",
  adapterType: "codex_app_server",
  adapterConfig: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const run = {
  id: runId,
  companyId,
  agentId,
  status: "failed",
  invocationSource: "assignment",
  triggerDetail: "system",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:30.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:30.000Z",
  error: "The fixture provider turn failed.",
  errorCode: "adapter_failed",
  exitCode: 1,
  runtimeMode: "native",
  driverKind: "codex_app_server",
  logBytes: 0,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function settle(turns = 12) {
  for (let index = 0; index < turns; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  agentUrlKey = "maya";
  localStorage.setItem("paperclip.selectedCompanyId", companyId);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const path = url.pathname;
    if (path === "/api/companies") return jsonResponse([company]);
    if (path === "/api/cli-auth/me")
      return jsonResponse({ source: "local_implicit", isInstanceAdmin: true, companyIds: [companyId], memberships: [] });
    if (path.startsWith("/api/agents/") && path.endsWith("/wakeup"))
      return jsonResponse({ error: denial, details: { code: "chat_failed_run_retry_source_denied" } }, 409);
    if (path.startsWith("/api/agents/")) return jsonResponse(agentRecord());
    if (path.endsWith("/resource-memberships/me"))
      return jsonResponse({ agentMemberships: {}, projectMemberships: {} });
    if (path === `/api/companies/${companyId}/heartbeat-runs`) return jsonResponse([run]);
    if (path === `/api/heartbeat-runs/${runId}`) return jsonResponse(run);
    if (path === `/api/heartbeat-runs/${runId}/log`)
      return jsonResponse({ runId, content: "", nextOffset: 0 });
    return jsonResponse([]);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a retry denial readable when the agent route key is re-canonicalized", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/ACME/agents/maya/runs/${runId}`]}>
          <CompanyProvider>
            <SidebarProvider>
              <PanelProvider>
                <ToastProvider>
                  <BreadcrumbProvider>
                    <DialogProvider>
                      <Routes>
                        <Route
                          path=":companyPrefix/agents/:agentId/runs/:runId"
                          element={<AgentDetail />}
                        />
                      </Routes>
                    </DialogProvider>
                  </BreadcrumbProvider>
                </ToastProvider>
              </PanelProvider>
            </SidebarProvider>
          </CompanyProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();

  const retry = [...container!.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Retry",
  );
  if (!retry) throw new Error(`no retry button: ${container!.textContent?.slice(0, 400)}`);
  await act(async () => {
    retry.click();
  });
  await settle();
  expect(container!.textContent).toContain(denial);

  agentUrlKey = "maya-2";
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.agents.detail("maya") });
  });
  await settle();

  expect(container!.textContent).toContain(denial);
});
