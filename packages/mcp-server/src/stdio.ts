#!/usr/bin/env node
import "@tickernelz/paperclip-pro-shared/env-aliases-bootstrap";
import { runServer } from "./index.js";

void runServer().catch((error) => {
  console.error("Failed to start Paperclip MCP server:", error);
  process.exit(1);
});
