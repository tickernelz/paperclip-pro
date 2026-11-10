import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL =
  process.env.WARDMOTE_RELEASE_SMOKE_EMAIL ??
  process.env.SMOKE_ADMIN_EMAIL ??
  "smoke-admin@wardmote.local";
const ADMIN_PASSWORD =
  process.env.WARDMOTE_RELEASE_SMOKE_PASSWORD ??
  process.env.SMOKE_ADMIN_PASSWORD ??
  "paperclip-smoke-password";
const EXPECTED_OMP_VERSION = process.env.WARDMOTE_RELEASE_SMOKE_OMP_VERSION ?? null;

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth/);

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

test.describe("Docker authenticated onboarding smoke", () => {
  test("logs in and onboards on the bundled OMP without the local OMP gate", async ({ page }) => {
    await signIn(page);
    const baseUrl = new URL(page.url()).origin;

    const companiesBefore = await getJson<Array<{ id: string }>>(page, `${baseUrl}/api/companies`);
    if (companiesBefore.length === 0) {
      await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    }

    const omp = await getJson<{ runtime: string; state: string; version: string | null; models: unknown[] }>(
      page,
      `${baseUrl}/api/onboarding/omp`,
    );
    expect(omp.runtime).toBe("bundled");
    expect(omp.state).toBe("ready");
    if (EXPECTED_OMP_VERSION) expect(omp.version).toBe(EXPECTED_OMP_VERSION);

    await page.goto("/onboarding");
    const flow = page.getByTestId("onboarding-flow");
    const start = page.getByRole("button", { name: /Start Onboarding/ });
    await expect(flow.or(start.first())).toBeVisible({ timeout: 20_000 });
    if (!(await flow.isVisible())) await start.first().click();

    await expect(flow.getByRole("heading", { name: "Install OMP" })).toHaveCount(0);
    if (omp.models.length === 0) {
      await expect(flow.getByRole("heading", { name: "Connect a model" })).toBeVisible({ timeout: 20_000 });
      await expect(flow.getByText("omp login anthropic", { exact: true })).toBeVisible();
      return;
    }

    await expect(flow.getByRole("heading", { name: "What should your first agent do?" })).toBeVisible({ timeout: 20_000 });
    const title = `Release smoke ${Date.now()}`;
    await flow.getByLabel("First task").fill(title);
    await flow.getByRole("button", { name: "Start" }).click();
    await expect(page).toHaveURL(/\/issues\//, { timeout: 30_000 });

    const companies = await getJson<Array<{ id: string }>>(page, `${baseUrl}/api/companies`);
    let assignee: string | null = null;
    for (const company of companies) {
      const issues = await getJson<Array<{ title: string; assigneeAgentId: string | null }>>(page, `${baseUrl}/api/companies/${company.id}/issues`);
      assignee ??= issues.find((issue) => issue.title === title)?.assigneeAgentId ?? null;
    }
    expect(assignee).toBeTruthy();
    const agent = await getJson<{ name: string; role: string; adapterType: string }>(page, `${baseUrl}/api/agents/${assignee}`);
    expect(agent).toMatchObject({ name: "Atlas", role: "general", adapterType: "omp_local" });
  });
});
