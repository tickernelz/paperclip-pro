// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentDetail, HeartbeatRun, Issue } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { CEO_ACCESS_WARNING } from "../components/agent-role/use-agent-role-change";
import { AgentProperties } from "../components/AgentProperties";
import { AgentOverview } from "./AgentDetail";

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  getIdentity: vi.fn(),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div>{children}</div>,
}));

const agent = {
  id: "agent-1",
  companyId: "company-1",
  name: "Codex Coder",
  urlKey: "codexcoder",
  role: "general",
  title: "Product engineer",
  status: "active",
  reportsTo: null,
  capabilities: "Builds and verifies product changes.",
  adapterType: "codex_local",
  adapterConfig: { model: "gpt-5.6-sol" },
  runtimeConfig: {},
  chainOfCommand: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  access: { canAssignTasks: true, taskAssignSource: "explicit_grant", membership: null, grants: [] },
} as unknown as AgentDetail;

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

const byTestId = <T extends Element = HTMLElement>(id: string) =>
  document.body.querySelector<T>(`[data-testid="${id}"]`);

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function render(node: ReactNode) {
  root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
  await settle();
}

async function pickRole(user: ReturnType<typeof userEvent.setup>, role: string) {
  await act(async () => {
    await user.click(byTestId("agent-role-agent-1")!);
  });
  await act(async () => {
    await user.click(
      document.body.querySelector<HTMLButtonElement>(`[data-testid="agent-role-option-agent-1"][data-value="${role}"]`)!,
    );
  });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAgentsApi.list.mockResolvedValue([]);
  mockAgentsApi.getIdentity.mockResolvedValue(null);
  mockAgentsApi.update.mockImplementation(async (_id: string, data: { role: string }) => ({ ...agent, role: data.role }));
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

describe("Agent page role editor", () => {
  it("changes the role from the agent overview and refreshes agent queries", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await render(
      <AgentOverview
        agent={agent}
        runs={[] as HeartbeatRun[]}
        assignedIssues={[] as Issue[]}
        directReportCount={0}
        skillNames={[]}
        agentRouteId="codexcoder"
      />,
    );

    expect(byTestId("agent-role-agent-1")?.textContent).toContain("General");
    await pickRole(user, "engineer");

    expect(mockAgentsApi.update).toHaveBeenCalledWith("agent-1", { role: "engineer" }, "company-1");
    expect(byTestId("agent-role-agent-1")?.textContent).toContain("Engineer");
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toContain(JSON.stringify(queryKeys.agents.list("company-1")));
    expect(keys).toContain(JSON.stringify(queryKeys.agents.detail("agent-1")));
    expect(keys).toContain(JSON.stringify(queryKeys.agents.detail("codexcoder")));
    expect(keys).toContain(JSON.stringify(queryKeys.org("company-1")));
  });

  it("confirms a CEO change from the properties panel before saving", async () => {
    const user = userEvent.setup();
    await render(<AgentProperties agent={agent} />);

    await pickRole(user, "ceo");
    expect(byTestId("agent-role-ceo-warning")?.textContent).toContain(CEO_ACCESS_WARNING);
    expect(mockAgentsApi.update).not.toHaveBeenCalled();

    await act(async () => {
      await user.click(byTestId("agent-role-confirm-cancel")!);
    });
    await settle();
    expect(mockAgentsApi.update).not.toHaveBeenCalled();

    await pickRole(user, "ceo");
    await act(async () => {
      await user.click(byTestId("agent-role-confirm-apply")!);
    });
    await settle();
    expect(mockAgentsApi.update).toHaveBeenCalledWith("agent-1", { role: "ceo" }, "company-1");
  });
});
