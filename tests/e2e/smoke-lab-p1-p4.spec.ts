import { test } from "@playwright/test";
import { ciSmokeLabScenarios } from "./smoke-lab.catalog";
import { runSmokeLabLifecycle, SMOKE_LAB_TIMEOUT_MS } from "./smoke-lab.shared";

test.describe.serial("Smoke Lab scenario catalog mirror (P1-P4)", () => {
  test.setTimeout(SMOKE_LAB_TIMEOUT_MS);

  test("records the P1-P4 CI-safe Smoke Lab lifecycle into the results API @smoke-lab", async ({ page, request }) => {
    await runSmokeLabLifecycle({ page, request, label: "P1-P4", scenarios: ciSmokeLabScenarios.slice(0, 4) });
  });
});
