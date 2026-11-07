import type { BrowserContext, Page, Route } from "@playwright/test";
import type { OnboardingOmpStatus, OnboardingRemoteOmpStatus } from "@tickernelz/paperclip-pro-shared";

export const LOGIN_URL = "https://login.example.test/authorize";
export const E2E_MODEL = { id: "anthropic/claude-e2e", label: "Claude E2E", provider: "anthropic" };

export function ompStatus(overrides: Partial<OnboardingOmpStatus> = {}): OnboardingOmpStatus {
  return {
    runtime: "local",
    os: { platform: "linux", label: "Linux" },
    minVersion: "18.1.16",
    state: "ready",
    path: "/home/ada/.local/bin/omp",
    version: "18.18.0",
    copies: [{ path: "/home/ada/.local/bin/omp", version: "18.18.0" }],
    installCommand: "curl -fsSL https://omp.sh/install | sh",
    updateCommand: "omp update",
    network: null,
    models: [E2E_MODEL],
    recommendedModel: E2E_MODEL.id,
    projectFolder: process.cwd(),
    ...overrides,
  };
}

export type OmpMock = {
  status: OnboardingOmpStatus;
  remote: OnboardingRemoteOmpStatus | null;
  logins: string[];
};

export async function mockOnboardingOmp(page: Page | BrowserContext, initial: OnboardingOmpStatus): Promise<OmpMock> {
  const mock: OmpMock = { status: initial, remote: null, logins: [] };
  await page.route(/\/api\/onboarding\/omp(\?.*)?$/, (route: Route) => {
    const url = new URL(route.request().url());
    const network = url.searchParams.get("network") === "1" && mock.status.state === "missing" ? mock.status.network : null;
    return route.fulfill({ json: { ...mock.status, network } });
  });
  await page.route("**/api/onboarding/omp/login", async (route) => {
    const body = route.request().postDataJSON() as { provider: string };
    mock.logins.push(body.provider);
    await route.fulfill({ json: { provider: body.provider, url: LOGIN_URL } });
  });
  await page.route("**/api/onboarding/omp/remote", async (route) => {
    const body = route.request().postDataJSON() as { address: string };
    await route.fulfill({ json: { ...(mock.remote as OnboardingRemoteOmpStatus), address: body.address } });
  });
  await page.route("**/api/onboarding/omp/browse**", (route) =>
    route.fulfill({ json: { path: "/media/usb", parent: "/media", entries: [{ name: "omp", path: "/media/usb/omp", kind: "file" }] } }),
  );
  await page.route(`${LOGIN_URL}**`, (route) => route.fulfill({ contentType: "text/html", body: "<title>Sign in</title>" }));
  return mock;
}
