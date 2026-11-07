import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.CONTRAST_GATE_PORT ?? 4199);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: `pnpm --filter @tickernelz/paperclip-pro-ui exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${BASE_URL}/tests/component-gallery.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  outputDir: "./test-results",
  reporter: [["list"]],
});
