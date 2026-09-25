#!/usr/bin/env node
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(packageRoot, "dist/generated");
mkdirSync(target, { recursive: true });
cpSync(join(packageRoot, "src/generated"), target, { recursive: true });
