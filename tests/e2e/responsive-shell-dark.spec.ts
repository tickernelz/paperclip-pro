import { test } from "@playwright/test";
import { checkCoreScreens, coreScreenCases, useResponsiveSeed } from "./responsive-shell.shared";

useResponsiveSeed();

for (const { size, pointer } of coreScreenCases()) {
  test(`core screens fit ${size.width}x${size.height} (dark, ${pointer} pointer)`, async ({ browser, baseURL }) => {
    await checkCoreScreens(browser, baseURL, size, "dark", pointer);
  });
}
