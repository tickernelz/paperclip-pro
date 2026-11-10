import fs from "node:fs";
import path from "node:path";
import { resolveWardmoteEnvPathForConfig } from "@tickernelz/wardmote-shared/home-paths";
import { resolveDefaultConfigPath } from "./home-paths.js";

const WARDMOTE_CONFIG_BASENAME = "config.json";

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const candidate = path.resolve(currentDir, ".paperclip", WARDMOTE_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

export function resolveWardmoteConfigPath(overridePath?: string): string {
  if (overridePath) return path.resolve(overridePath);
  if (process.env.WARDMOTE_CONFIG) return path.resolve(process.env.WARDMOTE_CONFIG);
  return findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
}

export function resolveWardmoteEnvPath(overrideConfigPath?: string): string {
  return resolveWardmoteEnvPathForConfig(resolveWardmoteConfigPath(overrideConfigPath));
}
