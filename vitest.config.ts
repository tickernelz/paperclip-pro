import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/skills-catalog",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/omp-local",
      "packages/mcp-server",
      "packages/plugins/sdk",
      "packages/plugins/plugin-creator",
      "packages/plugins/plugin-llm-wiki",
      "packages/plugins/sandbox-providers/daytona",
      "server",
      "ui",
      "cli",
    ],
  },
});
