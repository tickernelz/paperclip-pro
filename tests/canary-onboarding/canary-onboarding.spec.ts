import { expect, test, type APIRequestContext } from "@playwright/test";

const expectedVersion = process.env.WARDMOTE_VERSION!;
const ONBOARDING_HEADINGS = /^(Install OMP|Update OMP|You are offline|Connect a model|What should your first agent do\?)$/;

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

test("the exact published canary installs and opens onboarding without creating anything", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const health = await getJson<{
    status: string;
    version: string;
    serverVersion: string;
  }>(page.request, "/api/health");
  expect(health.status).toBe("ok");
  expect(health.version).toBe(expectedVersion);
  expect(health.serverVersion).toBe(expectedVersion);

  const companiesBefore = await getJson<Array<{ id: string }>>(page.request, "/api/companies");

  await page.goto("/onboarding");
  const flow = page.getByTestId("onboarding-flow");
  const start = page.getByRole("button", { name: /Start Onboarding/ });
  await expect(flow.or(start.first())).toBeVisible({ timeout: 30_000 });
  if (!(await flow.isVisible())) await start.first().click();
  await expect(flow.getByRole("heading", { level: 1, name: ONBOARDING_HEADINGS })).toBeVisible({ timeout: 30_000 });

  const omp = await getJson<{ minVersion: string }>(page.request, "/api/onboarding/omp");
  expect(omp.minVersion).toBe("18.1.16");
  expect(await getJson<Array<{ id: string }>>(page.request, "/api/companies")).toHaveLength(companiesBefore.length);
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
