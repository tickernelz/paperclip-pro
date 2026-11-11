import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { capabilityExplorerFixturesPlugin } from "./scripts/capability-explorer-fixtures.mjs";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(packageRoot, "examples"),
  base: "./",
  plugins: [react(), capabilityExplorerFixturesPlugin()],
  resolve: {
    alias: [
      {
        find: "@tickernelz/wardmote-runner/react",
        replacement: resolve(packageRoot, "src/react/index.ts"),
      },
      {
        find: "@tickernelz/wardmote-runner/styles.css",
        replacement: resolve(packageRoot, "styles.css"),
      },
      {
        find: "@paperclip-runner-local/capability",
        replacement: resolve(packageRoot, "src/scenarios/index.ts"),
      },
    ],
  },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    outDir: resolve(packageRoot, "dist-scenarios"),
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: resolve(packageRoot, "examples/scenario-explorer/index.html"),
    },
  },
});
