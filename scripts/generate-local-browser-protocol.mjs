import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "packages/shared/src/local-browser.ts");
const targets = [
  path.join(root, "apps/local-browser/chromium/lib/protocol.contract.json"),
  path.join(root, "apps/local-browser/firefox/lib/protocol.contract.json"),
];

const text = await readFile(source, "utf8");

function stringArray(name) {
  const match = text.match(new RegExp("export const " + name + " = \\[([\\s\\S]*?)\\] as const;"));
  if (!match) throw new Error("Cannot find " + name + " in the local browser contract");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function numberValue(name) {
  const match = text.match(new RegExp("export const " + name + " = ([0-9_* ]+);"));
  if (!match) throw new Error("Cannot find " + name + " in the local browser contract");
  const expression = match[1].replaceAll("_", "").trim();
  if (!/^[0-9* ]+$/.test(expression)) throw new Error("Unsupported value for " + name + ": " + expression);
  return expression.split("*").reduce((total, part) => total * Number(part.trim()), 1);
}

function regexSource(name) {
  const match = text.match(new RegExp("export const " + name + " = (/[^\\n]+/);"));
  if (!match) throw new Error("Cannot find " + name + " in the local browser contract");
  return match[1];
}

const contract = {
  protocol: numberValue("LOCAL_BROWSER_PROTOCOL_VERSION"),
  cursorPattern: regexSource("LOCAL_BROWSER_CURSOR_PATTERN"),
  tiers: stringArray("LOCAL_BROWSER_TIERS"),
  clients: stringArray("LOCAL_BROWSER_CLIENTS"),
  errorCodes: stringArray("LOCAL_BROWSER_ERROR_CODES"),
  actions: stringArray("LOCAL_BROWSER_ACTIONS"),
  mouseActions: stringArray("LOCAL_BROWSER_MOUSE_ACTIONS"),
  keyActions: stringArray("LOCAL_BROWSER_KEY_ACTIONS"),
  viewerStates: ["connected", "viewer_unavailable", "agent_streaming", "agent_idle", "disconnected"],
  toolNames: [...text.matchAll(/name: "(local_browser_[a-z_]+)"/g)].map((entry) => entry[1]),
  limits: {
    callTimeoutMs: numberValue("LOCAL_BROWSER_CALL_TIMEOUT_MS"),
    snapshotDefaultNodes: numberValue("LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES"),
    snapshotMaxNodes: numberValue("LOCAL_BROWSER_SNAPSHOT_MAX_NODES"),
    textDefaultChars: numberValue("LOCAL_BROWSER_TEXT_DEFAULT_CHARS"),
    textMaxChars: numberValue("LOCAL_BROWSER_TEXT_MAX_CHARS"),
    screenshotMaxBytes: numberValue("LOCAL_BROWSER_SCREENSHOT_MAX_BYTES"),
    viewerFrameIntervalMs: numberValue("LOCAL_BROWSER_VIEWER_FRAME_INTERVAL_MS"),
  },
};

const serialized = JSON.stringify(contract, null, 2) + "\n";
const check = process.argv.includes("--check");
let stale = 0;

for (const target of targets) {
  if (check) {
    const current = await readFile(target, "utf8").catch(() => null);
    if (current !== serialized) {
      stale += 1;
      console.error("Stale browser protocol contract: " + path.relative(root, target));
    }
    continue;
  }
  await writeFile(target, serialized);
  console.log("Wrote " + path.relative(root, target));
}

if (check) {
  if (stale > 0) {
    console.error("Run pnpm generate:local-browser-protocol and commit the result.");
    process.exit(1);
  }
  console.log("Browser protocol contract is current (" + contract.toolNames.length + " tools, protocol " + contract.protocol + ").");
}
