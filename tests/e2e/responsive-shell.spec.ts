import { test } from "@playwright/test";
import { checkCoreScreens, coreScreenCases, probeFlagsOverflowAndSmallTarget, useResponsiveSeed } from "./responsive-shell.shared";

useResponsiveSeed();

for (const { size, pointer } of coreScreenCases()) {
  test(`core screens fit ${size.width}x${size.height} (light, ${pointer} pointer)`, async ({ browser, baseURL }) => {
    await checkCoreScreens(browser, baseURL, size, "light", pointer);
  });
}

test("the probe flags an overflowing rule and an undersized target", async ({ page }) => {
  await probeFlagsOverflowAndSmallTarget(page);
});
