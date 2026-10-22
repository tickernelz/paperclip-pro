import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const committed = path.join(root, "ui", "public", "downloads", "local-browser-chromium.zip");

function contents(file) {
  const rows = execFileSync("unzip", ["-v", file], { encoding: "utf8" }).split("\n");
  return rows
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 8 && /^[0-9a-f]{8}$/.test(fields[6] ?? ""))
    .map((fields) => fields[7] + " " + fields[0] + " " + fields[6])
    .filter((entry) => !entry.endsWith(" 00000000"))
    .sort()
    .join("\n");
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "lb-artifacts-"));
const rebuilt = path.join(scratch, "rebuilt.zip");
copyFileSync(committed, path.join(scratch, "committed.zip"));

try {
  execFileSync(process.execPath, [path.join(here, "..", "apps", "local-browser", "build-artifacts.mjs")], {
    stdio: "inherit",
  });
  copyFileSync(committed, rebuilt);
  const before = contents(path.join(scratch, "committed.zip"));
  const after = contents(rebuilt);
  if (before !== after) {
    console.error("ui/public/downloads/local-browser-chromium.zip does not match the extension source.");
    const beforeLines = new Set(before.split("\n"));
    const afterLines = new Set(after.split("\n"));
    for (const line of beforeLines) if (!afterLines.has(line)) console.error("  committed only: " + line);
    for (const line of afterLines) if (!beforeLines.has(line)) console.error("  source only: " + line);
    console.error("Run pnpm build:local-browser-extensions and commit the result.");
    process.exit(1);
  }
  console.log("Chromium download matches the extension source (" + after.split("\n").length + " entries).");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
