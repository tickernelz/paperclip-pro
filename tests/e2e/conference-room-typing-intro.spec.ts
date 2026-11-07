import { test, expect, type Page } from "@playwright/test";
import { mockOnboardingOmp, ompStatus } from "./helpers/onboarding-omp";
import {
  expectLandsOnFirstTaskWithoutDashboardBounce,
  instrumentNavLog,
} from "./helpers/onboarding-landing";

async function runOnboarding(page: Page, title: string) {
  await mockOnboardingOmp(page.context(), ompStatus());
  await page.goto("/onboarding");
  const startBtn = page.getByRole("button", { name: /Start Onboarding/i });
  const flow = page.getByTestId("onboarding-flow");
  await expect(flow.or(startBtn.first())).toBeVisible({ timeout: 30_000 });
  if (!(await flow.isVisible())) await startBtn.first().click();
  await page.getByLabel("First task").fill(title);
  await page.getByRole("button", { name: "Start" }).click();
}

async function assertFirstTaskExists(page: Page, title: string) {
  const companiesRes = await page.request.get("/api/companies");
  expect(companiesRes.ok()).toBe(true);
  const companies = await companiesRes.json() as Array<{ id: string }>;
  let firstTask: unknown = null;
  for (const company of companies) {
    const issuesRes = await page.request.get(`/api/companies/${company.id}/issues`);
    expect(issuesRes.ok()).toBe(true);
    const issues = await issuesRes.json() as Array<{ title: string }>;
    firstTask ??= issues.find((candidate) => candidate.title === title) ?? null;
  }
  expect(firstTask).toBeTruthy();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
}

test.describe("First-task launch after onboarding", () => {
  test("creates the first task and opens its detail page", async ({ page }) => {
    await instrumentNavLog(page);
    const title = `E2E first task ${Date.now()}`;
    await runOnboarding(page, title);

    await expectLandsOnFirstTaskWithoutDashboardBounce(page);
    await assertFirstTaskExists(page, title);
  });

  test("lands on the first task even when a company already exists", async ({ page }) => {
    await instrumentNavLog(page);
    const seedRes = await page.request.post("/api/companies", {
      data: { name: `E2E-Seed-${Date.now()}` },
    });
    expect(seedRes.ok()).toBe(true);

    const title = `E2E first task existing ${Date.now()}`;
    await runOnboarding(page, title);

    await expectLandsOnFirstTaskWithoutDashboardBounce(page);
    await assertFirstTaskExists(page, title);
  });
});
