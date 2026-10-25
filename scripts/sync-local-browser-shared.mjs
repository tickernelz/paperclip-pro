import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "apps", "local-browser");
const sharedDir = path.join(appDir, "shared");
const manifestPath = path.join(sharedDir, ".synced-files.json");
const targets = ["chromium", "firefox"].map((name) => path.join(appDir, name));
const check = process.argv.includes("--check");

function synced(relative) {
  const base = path.posix.basename(relative);
  return !relative.endsWith(".mjs") && base !== "README.md" && base !== ".synced-files.json";
}

function walk(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(dir, entry.name), relative));
    else if (entry.isFile() && synced(relative)) files.push(relative);
  }
  return files;
}

function readManifest() {
  if (!existsSync(manifestPath)) return [];
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  return Array.isArray(parsed.files) ? parsed.files.filter((file) => typeof file === "string" && !file.includes("..")) : [];
}

const files = walk(sharedDir).sort();
const previous = readManifest();
const retired = previous.filter((file) => !files.includes(file));
const manifestText = JSON.stringify({ source: "apps/local-browser/shared", files }, null, 2) + "\n";
const problems = [];
let written = 0;
let removed = 0;

for (const target of targets) {
  const label = path.relative(root, target);
  for (const file of files) {
    const from = path.join(sharedDir, file);
    const to = path.join(target, file);
    const body = readFileSync(from);
    const current = existsSync(to) ? readFileSync(to) : null;
    if (current && current.equals(body)) continue;
    if (check) {
      problems.push((current ? "drifted: " : "missing: ") + label + "/" + file);
      continue;
    }
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, body);
    written += 1;
  }
  for (const file of retired) {
    const stale = path.join(target, file);
    if (!existsSync(stale)) continue;
    if (check) {
      problems.push("no longer shared but still present: " + label + "/" + file);
      continue;
    }
    rmSync(stale);
    removed += 1;
  }
}

const manifestCurrent = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null;
if (manifestCurrent !== manifestText) {
  if (check) problems.push("stale manifest: " + path.relative(root, manifestPath));
  else writeFileSync(manifestPath, manifestText);
}

if (check) {
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error("Run node scripts/sync-local-browser-shared.mjs and commit the result. Edit apps/local-browser/shared, never the synced copies.");
    process.exit(1);
  }
  console.log("Local browser shared files are in sync (" + files.length + " files x " + targets.length + " browsers).");
} else {
  console.log("Synced " + files.length + " shared files into " + targets.length + " browsers: " + written + " written, " + removed + " removed.");
}
