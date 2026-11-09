#!/usr/bin/env node
import "@tickernelz/wardmote-shared/env-aliases-bootstrap";
import { runServer } from "./index.js";

void runServer().catch((error) => {
  console.error("Failed to start Wardmote MCP server:", error);
  process.exit(1);
});
