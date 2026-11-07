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

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";

const company = {
  id: companyId,
  name: "Acme",
  issuePrefix: "ACME",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let adapterType = "claude_local";

const agentRecord = () => ({
  id: agentId,
  companyId,
  name: "Maya",
  urlKey: "maya",
  role: "engineer",
  status: "idle",
  lifecycleState: "ready",
  adapterType,
  adapterConfig: { model: "claude-sonnet-5" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

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
  adapterType = "claude_local";
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
    if (path.startsWith("/api/agents/") && path.endsWith("/identity")) return jsonResponse({ error: "Not found" }, 404);
    if (path.startsWith("/api/agents/") && path.split("/").length === 4) return jsonResponse(agentRecord());
    if (path.endsWith("/resource-memberships/me"))
      return jsonResponse({ agentMemberships: {}, projectMemberships: {} });
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

async function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/ACME/agents/maya/overview"]}>
          <CompanyProvider>
            <SidebarProvider>
              <PanelProvider>
                <ToastProvider>
                  <BreadcrumbProvider>
                    <DialogProvider>
                      <Routes>
                        <Route path=":companyPrefix/agents/:agentId/:tab" element={<AgentDetail />} />
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
}

function button(label: string) {
  const match = [...container!.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`no ${label} button: ${container!.textContent?.slice(0, 400)}`);
  return match;
}

it("explains a retired adapter and blocks new work on that agent", async () => {
  await renderOverview();

  expect(container!.textContent).toContain("Claude (removed)");
  expect(container!.textContent).toContain(
    "The claude_local adapter has been removed, so this agent stays disabled until you switch it to OMP (omp_local).",
  );
  expect(button("Assign Task").disabled).toBe(true);
  expect(button("Run now").disabled).toBe(true);
});

it("keeps work actions available once the agent runs on omp_local", async () => {
  adapterType = "omp_local";
  await renderOverview();

  expect(container!.textContent).not.toContain("Adapter removed");
  expect(button("Assign Task").disabled).toBe(false);
  expect(button("Run now").disabled).toBe(false);
});
