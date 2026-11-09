// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { OnboardingFlow } from "./OnboardingFlow";
import { ADMIN_ONLY_MESSAGE } from "./onboarding-flow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statusMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/onboardingOmp", () => ({
  onboardingOmpApi: { status: statusMock, browse: vi.fn(), login: vi.fn(), remote: vi.fn() },
}));
vi.mock("../../context/DialogContext", () => ({
  useDialog: () => ({
    onboardingOpen: true,
    onboardingOptions: {},
    closeOnboarding: vi.fn(),
    onboardingRouteDismissed: false,
    setOnboardingRouteDismissed: vi.fn(),
  }),
}));
vi.mock("../../context/CompanyContext", () => ({
  useCompany: () => ({ companies: [], loading: false, setSelectedCompanyId: vi.fn() }),
}));
vi.mock("../../lib/router", () => ({
  useLocation: () => ({ pathname: "/onboarding" }),
  useNavigate: () => vi.fn(),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  statusMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

async function settle(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("OnboardingFlow", () => {
  it("tells a board user who is not an instance admin why setup cannot continue and stops polling", async () => {
    statusMock.mockRejectedValue(new ApiError("Instance admin access required", 403, { error: "Instance admin access required" }));
    const client = new QueryClient();
    root = createRoot(container!);
    act(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <OnboardingFlow />
        </QueryClientProvider>,
      );
    });
    await settle(100);
    expect(document.body.textContent).toContain(ADMIN_ONLY_MESSAGE);
    expect(document.body.textContent).not.toContain("every 2 s");
    await settle(2_500);
    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it("brands the first screen with the Moot mark and the Wardmote name", async () => {
    statusMock.mockRejectedValue(new ApiError("Instance admin access required", 403, { error: "Instance admin access required" }));
    root = createRoot(container!);
    act(() => {
      root!.render(
        <QueryClientProvider client={new QueryClient()}>
          <OnboardingFlow />
        </QueryClientProvider>,
      );
    });
    await settle(100);
    const name = document.querySelector('[data-testid="onboarding-flow"] main b');
    expect(name?.textContent).toBe("Wardmote");
    expect(name?.previousElementSibling?.tagName.toLowerCase()).toBe("svg");
    expect(document.body.textContent).not.toMatch(/\bPaperclip\b/);
  });
});

