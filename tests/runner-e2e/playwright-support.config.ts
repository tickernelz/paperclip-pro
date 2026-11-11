import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["screenshot-readiness.spec.ts", "service-worker-reload.spec.ts", "lost-send.spec.ts", "chat-restart.spec.ts", "settings-toggle.spec.ts", "browser-bootstrap-diagnostics.spec.ts", "service-worker-module-loading.spec.ts", "browser-bootstrap-recovery.spec.ts", "blocker-input.spec.ts", "native-blocker-visible.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 10_000,
  use: {
    headless: true,
    ...(process.env.WARDMOTE_PLAYWRIGHT_CHANNEL
      ? { channel: process.env.WARDMOTE_PLAYWRIGHT_CHANNEL }
      : {}),
  },
  outputDir: "./results/browser-support",
  reporter: "list",
});
