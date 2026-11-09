import { test } from "@playwright/test";
import { probeFlagsOverflowAndSmallTarget, registerResponsiveShell } from "./responsive-shell.shared";

registerResponsiveShell("light");

test("the probe flags an overflowing rule and an undersized target", async ({ page }) => {
  await probeFlagsOverflowAndSmallTarget(page);
});
