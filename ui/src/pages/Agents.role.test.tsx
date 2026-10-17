// @vitest-environment jsdom

import { act, type MouseEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { ToastProvider } from "../context/ToastContext";
import { CEO_ACCESS_WARNING } from "../components/agent-role/use-agent-role-change";
import { Agents } from "./Agents";

const mockNavigate = vi.hoisted(() => vi.fn());

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  org: vi.fn(),
  update: vi.fn(),
  batchAdapterConfigPreview: vi.fn(),
  batchAdapterConfig: vi.fn(),
  adapterModels: vi.fn(),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, onClick, ...props }: { children: ReactNode; to: string; onClick?: (event: MouseEvent) => void }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) mockNavigate(to);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/agents/all", search: "", hash: "", state: null }),
  useNavigate: () => mockNavigate,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewAgent: vi.fn() }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

vi.mock("../api/builtInAgents", () => ({
  builtInAgentsApi: { list: vi.fn().mockResolvedValue([]), provision: vi.fn(), reset: vi.fn() },
}));

vi.mock("../api/environments", () => ({
  environmentsApi: { list: vi.fn().mockResolvedValue([]), capabilities: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: { liveRunsForCompany: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: {
    get: vi.fn().mockResolvedValue({
      id: "instance-settings-1",
      defaultEnvironmentId: null,
      experimental: { enableEnvironments: false, enableAgentChat: false, enableBuiltInAgents: false },
    }),
  },
}));

vi.mock("../api/resourceMemberships", () => ({
  resourceMembershipsApi: {
    listMine: vi.fn().mockResolvedValue({ projectMemberships: {}, agentMemberships: {}, updatedAt: null }),
    updateAgent: vi.fn(),
  },
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => `label:${type}`,
}));

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-alpha",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "general",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const alpha = makeAgent({ id: "agent-alpha", name: "Alpha", urlKey: "alpha" });
const beta = makeAgent({ id: "agent-beta", name: "Beta", urlKey: "beta", role: "qa" });
const chief = makeAgent({ id: "agent-chief", name: "Chief", urlKey: "chief", role: "ceo" });

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
const byTestId = <T extends Element = HTMLElement>(id: string) => $<T>(`[data-testid="${id}"]`);

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderPage(agents: Agent[]) {
  mockAgentsApi.list.mockResolvedValue(agents);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Agents />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await settle();
    if (byTestId(`agent-role-${agents[0]!.id}`)) break;
  }
}

function roleOption(agentId: string, role: string) {
  return $<HTMLButtonElement>(`[data-testid="agent-role-option-${agentId}"][data-value="${role}"]`)!;
}

function selectAgents(ids: string[]) {
  return act(async () => {
    for (const id of ids) byTestId<HTMLButtonElement>(`agent-select-${id}`)!.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAgentsApi.org.mockResolvedValue([]);
  mockAgentsApi.batchAdapterConfigPreview.mockImplementation(async (agentIds: string[]) => ({
    fields: [],
    agents: agentIds.map((agentId) => ({
      agentId,
      name: agentId,
      adapterType: "codex_local",
      eligible: false,
      reason: "no fields",
      current: {},
    })),
  }));
  mockAgentsApi.adapterModels.mockResolvedValue([]);
  mockAgentsApi.update.mockImplementation(async (id: string, data: { role: string }) => ({
    ...[alpha, beta, chief].find((agent) => agent.id === id)!,
    role: data.role,
  }));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  queryClient.clear();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Agents role editing", () => {
  it("changes a role inline from the row without following the row link", async () => {
    const user = userEvent.setup();
    await renderPage([alpha, beta]);

    await act(async () => {
      await user.click(byTestId("agent-role-agent-alpha")!);
    });
    expect(byTestId("agent-role-options-agent-alpha")).not.toBeNull();
    await act(async () => {
      await user.click(roleOption("agent-alpha", "engineer"));
    });
    await settle();

    expect(mockAgentsApi.update).toHaveBeenCalledTimes(1);
    expect(mockAgentsApi.update).toHaveBeenCalledWith("agent-alpha", { role: "engineer" }, "company-1");
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(byTestId("agent-role-agent-alpha")?.textContent).toContain("Engineer");
    expect(byTestId("agent-role-confirm")).toBeNull();
  });

  it("closes the inline role picker on Escape without saving", async () => {
    const user = userEvent.setup();
    await renderPage([alpha]);

    byTestId<HTMLButtonElement>("agent-role-agent-alpha")!.focus();
    await act(async () => {
      await user.keyboard("{Enter}");
    });
    expect(byTestId("agent-role-options-agent-alpha")).not.toBeNull();
    await act(async () => {
      await user.keyboard("{Escape}");
    });
    await settle();

    expect(byTestId("agent-role-options-agent-alpha")).toBeNull();
    expect(mockAgentsApi.update).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("asks for confirmation before making an agent CEO inline", async () => {
    const user = userEvent.setup();
    await renderPage([alpha]);

    await act(async () => {
      await user.click(byTestId("agent-role-agent-alpha")!);
    });
    await act(async () => {
      await user.click(roleOption("agent-alpha", "ceo"));
    });
    await settle();

    expect(byTestId("agent-role-ceo-warning")?.textContent).toContain(CEO_ACCESS_WARNING);
    expect(mockAgentsApi.update).not.toHaveBeenCalled();

    await act(async () => {
      await user.click(byTestId("agent-role-confirm-apply")!);
    });
    await settle();

    expect(mockAgentsApi.update).toHaveBeenCalledWith("agent-alpha", { role: "ceo" }, "company-1");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the server error inline when the inline change is denied", async () => {
    const user = userEvent.setup();
    mockAgentsApi.update.mockRejectedValueOnce(
      new ApiError("Only a board user or a CEO agent may set the CEO role", 403, {
        error: "Only a board user or a CEO agent may set the CEO role",
        details: { code: "AGENT_ROLE_ESCALATION_DENIED" },
      }),
    );
    await renderPage([chief]);

    await act(async () => {
      await user.click(byTestId("agent-role-agent-chief")!);
    });
    await act(async () => {
      await user.click(roleOption("agent-chief", "engineer"));
    });
    expect(byTestId("agent-role-ceo-warning")?.textContent).toContain(CEO_ACCESS_WARNING);
    await act(async () => {
      await user.click(byTestId("agent-role-confirm-apply")!);
    });
    await settle();

    expect(mockAgentsApi.update).toHaveBeenCalledWith("agent-chief", { role: "engineer" }, "company-1");
    expect(byTestId("agent-role-error-agent-chief")?.textContent).toContain("AGENT_ROLE_ESCALATION_DENIED");
    expect(byTestId("agent-role-agent-chief")?.textContent).toContain("CEO");
  });

  it("changes roles in bulk with one PATCH per agent and reports a denial per agent", async () => {
    const user = userEvent.setup();
    const gamma = makeAgent({ id: "agent-gamma", name: "Gamma", urlKey: "gamma", role: "designer" });
    mockAgentsApi.update.mockImplementation(async (id: string, data: { role: string }) => {
      if (id === "agent-beta") {
        throw new ApiError("Agents cannot change their own role, permissions, or reporting chain", 403, {
          error: "Agents cannot change their own role, permissions, or reporting chain",
          details: { code: "AGENT_ROLE_ESCALATION_DENIED" },
        });
      }
      return { ...[alpha, beta, gamma].find((agent) => agent.id === id)!, role: data.role };
    });
    await renderPage([alpha, beta, gamma]);

    await selectAgents(["agent-alpha", "agent-beta", "agent-gamma"]);
    expect(byTestId("agents-bulk-role")?.textContent).toContain("Change role (3)");
    await act(async () => {
      await user.click(byTestId("agents-bulk-role")!);
    });
    await act(async () => {
      await user.selectOptions(byTestId<HTMLSelectElement>("bulk-agent-role-select")!, "engineer");
    });
    expect(byTestId("bulk-agent-role-ceo-warning")).toBeNull();
    await act(async () => {
      await user.click(byTestId("bulk-agent-role-submit")!);
    });
    await settle();

    expect(mockAgentsApi.update).toHaveBeenCalledTimes(3);
    for (const id of ["agent-alpha", "agent-beta", "agent-gamma"]) {
      expect(mockAgentsApi.update).toHaveBeenCalledWith(id, { role: "engineer" }, "company-1");
    }
    expect(byTestId("bulk-agent-role-result-agent-alpha")?.dataset.status).toBe("updated");
    expect(byTestId("bulk-agent-role-result-agent-gamma")?.dataset.status).toBe("updated");
    const denied = byTestId("bulk-agent-role-result-agent-beta");
    expect(denied?.dataset.status).toBe("failed");
    expect(denied?.textContent).toContain("Agents cannot change their own role");
    expect(denied?.textContent).toContain("AGENT_ROLE_ESCALATION_DENIED");
    expect(byTestId("bulk-agent-role-results")?.textContent).toContain("2 updated, 1 failed");

    const closeButton = [...byTestId("bulk-agent-role-dialog")!.querySelectorAll("button")].find(
      (button) => button.textContent === "Close",
    )!;
    await act(async () => {
      await user.click(closeButton);
    });
    await settle();
    expect(byTestId("bulk-agent-role-dialog")).toBeNull();
    expect(byTestId("agents-bulk-role")?.textContent).toContain("Change role (3)");
  });

  it("warns and requires confirmation in bulk when a selected agent is currently CEO", async () => {
    const user = userEvent.setup();
    await renderPage([alpha, chief]);

    await selectAgents(["agent-alpha", "agent-chief"]);
    await act(async () => {
      await user.click(byTestId("agents-bulk-role")!);
    });
    await act(async () => {
      await user.selectOptions(byTestId<HTMLSelectElement>("bulk-agent-role-select")!, "engineer");
    });

    const warning = byTestId("bulk-agent-role-ceo-warning");
    expect(warning?.textContent).toContain(CEO_ACCESS_WARNING);
    expect(warning?.textContent).toContain("Chief will lose that access.");
    expect(byTestId("bulk-agent-role-submit")?.textContent).toBe("Review change");

    await act(async () => {
      await user.click(byTestId("bulk-agent-role-submit")!);
    });
    expect(mockAgentsApi.update).not.toHaveBeenCalled();
    expect(byTestId("bulk-agent-role-submit")?.textContent).toBe("Apply to 2 agents");

    await act(async () => {
      await user.click(byTestId("bulk-agent-role-submit")!);
    });
    await settle();

    expect(mockAgentsApi.update).toHaveBeenCalledTimes(2);
    expect(mockAgentsApi.update).toHaveBeenCalledWith("agent-chief", { role: "engineer" }, "company-1");
  });
});
