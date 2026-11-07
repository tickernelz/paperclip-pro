import { expect, type Page } from "@playwright/test";

const ONBOARDING_OMP_MODEL = "e2e/onboarding-model";

/** Report OMP as installed with one model, so the connect step offers a real choice without the CLI. */
export async function mockOnboardingOmp(page: Page) {
  await page.route("**/adapters/omp_local/test-environment", (route) =>
    route.fulfill({
      json: {
        adapterType: "omp_local",
        status: "pass",
        checks: [{ code: "omp_version_ok", level: "info", message: "omp 15.0.0 is installed." }],
        testedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/adapters/omp_local/models**", (route) =>
    route.fulfill({ json: [{ id: ONBOARDING_OMP_MODEL, label: ONBOARDING_OMP_MODEL }] }),
  );
}

/** Pick the mocked OMP model on the connect step and continue to the review step. */
export async function chooseOnboardingOmpModel(page: Page) {
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: ONBOARDING_OMP_MODEL }).click();
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await expect(next).toBeEnabled({ timeout: 30_000 });
  await next.click();
}
