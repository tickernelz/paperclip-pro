import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const outDir = path.join(root, "ui", "public", "downloads");
const chromiumZip = path.join(outDir, "local-browser-chromium.zip");
const firefoxXpi = path.join(outDir, "local-browser-firefox.xpi");
const sign = process.argv.includes("--sign");
const FIXED_TIME = new Date("2026-01-01T00:00:00Z");
const SKIP = (entry) => /\.test\.mjs$/.test(entry) || entry.endsWith("test-dom.mjs") || entry.endsWith("protocol.contract.json") || path.basename(entry) === "README.md";

function manifestVersion(dir) {
  return JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")).version;
}

function stage(sourceDir) {
  const staging = path.join(outDir, ".staging");
  rmSync(staging, { recursive: true, force: true });
  cpSync(sourceDir, staging, { recursive: true, filter: (entry) => !SKIP(entry) });
  const entries = execFileSync("find", [staging, "-mindepth", "1"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const entry of entries) utimesSync(entry, FIXED_TIME, FIXED_TIME);
  return staging;
}

function zipStaged(staging, target) {
  rmSync(target, { force: true });
  execFileSync("zip", ["-qrX", target, "."], { cwd: staging, stdio: "inherit" });
  rmSync(staging, { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });

const chromiumDir = path.join(here, "chromium");
zipStaged(stage(chromiumDir), chromiumZip);
console.log("chromium " + manifestVersion(chromiumDir) + " -> " + path.relative(root, chromiumZip));

const firefoxDir = path.join(here, "firefox");
const apiKey = process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.WEB_EXT_API_SECRET;

if (sign && apiKey && apiSecret) {
  const staging = stage(firefoxDir);
  execFileSync("npx", ["--yes", "web-ext", "sign", "--channel=unlisted", "--source-dir", staging, "--artifacts-dir", staging], {
    stdio: "inherit",
    env: { ...process.env, WEB_EXT_API_KEY: apiKey, WEB_EXT_API_SECRET: apiSecret },
  });
  const produced = execFileSync("find", [staging, "-maxdepth", "1", "-name", "*.xpi"], { encoding: "utf8" }).split("\n").filter(Boolean);
  if (produced.length !== 1) throw new Error("expected one signed xpi, found " + produced.length);
  cpSync(produced[0], firefoxXpi);
  rmSync(staging, { recursive: true, force: true });
  console.log("firefox " + manifestVersion(firefoxDir) + " signed -> " + path.relative(root, firefoxXpi));
} else if (existsSync(firefoxXpi)) {
  console.log("firefox " + manifestVersion(firefoxDir) + " keeps the committed signature at " + path.relative(root, firefoxXpi));
} else {
  console.log("firefox " + manifestVersion(firefoxDir) + " has no committed signature; pass --sign with AMO credentials for a loadable xpi");
}

const firefoxUnsigned = path.join(outDir, "local-browser-firefox-unsigned.zip");
zipStaged(stage(firefoxDir), firefoxUnsigned);
console.log("firefox " + manifestVersion(firefoxDir) + " -> " + path.relative(root, firefoxUnsigned));

for (const file of [chromiumZip, firefoxXpi, firefoxUnsigned]) {
  if (existsSync(file)) console.log(path.basename(file) + " " + statSync(file).size + " bytes");
}
