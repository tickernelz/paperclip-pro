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
      "packages/plugins/plugin-workspace-diff",
      "packages/plugins/plugin-fake-sandbox",
      "packages/plugins/examples/plugin-authoring-smoke-example",
      "packages/plugins/examples/plugin-orchestration-smoke-example",
      "packages/plugins/sandbox-providers/daytona",
      "packages/plugins/sandbox-providers/cloudflare",
      "packages/plugins/sandbox-providers/createos",
      "packages/plugins/sandbox-providers/e2b",
      "packages/plugins/sandbox-providers/exe-dev",
      "packages/plugins/sandbox-providers/kubernetes",
      "packages/plugins/sandbox-providers/modal",
      "packages/plugins/sandbox-providers/novita",
      "server",
      "ui",
      "cli",
    ],
  },
});
