import { expect, test } from "@playwright/test";

test("self-hosted auth still shows the instance sign-in form", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 401, json: { error: "Board authentication required" } }));
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Sign in to Wardmote", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});
