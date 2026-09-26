import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.MOBILE_SHELL_PORT ?? 4198);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    {
      name: "webkit-iphone",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @tickernelz/paperclip-pro-ui exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${BASE_URL}/tests/mobile-chat-shell.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  outputDir: "./test-results",
  reporter: [["list"]],
});
