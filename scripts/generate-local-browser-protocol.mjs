import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "packages/shared/src/local-browser-contract.ts");
const sharedLib = path.join(root, "apps/local-browser/shared/lib");

const shared = await import(pathToFileURL(source).href);

const limitKeys = shared.LOCAL_BROWSER_LIMIT_KEYS;
const pick = (field) => Object.fromEntries(limitKeys.map((key) => [key, shared.LOCAL_BROWSER_LIMITS[key][field]]));
const toolNames = Object.keys(shared.LOCAL_BROWSER_TOOL_TIERS);

const contract = {
  protocol: shared.LOCAL_BROWSER_PROTOCOL_VERSION,
  cursorPattern: String(shared.LOCAL_BROWSER_CURSOR_PATTERN),
  apiPathPattern: String(shared.LOCAL_BROWSER_API_PATH_PATTERN),
  tiers: [...shared.LOCAL_BROWSER_TIERS],
  clients: [...shared.LOCAL_BROWSER_CLIENTS],
  errorCodes: [...shared.LOCAL_BROWSER_ERROR_CODES],
  capabilities: [...shared.LOCAL_BROWSER_CAPABILITIES],
  permissions: shared.LOCAL_BROWSER_PERMISSIONS.map((entry) => ({ ...entry })),
  limits: { defaults: pick("default"), min: pick("min"), ceilings: pick("ceiling") },
  guards: {
    defaults: { ...shared.LOCAL_BROWSER_GUARD_DEFAULTS },
    networkBufferSize: { ...shared.LOCAL_BROWSER_NETWORK_BUFFER_RANGE },
  },
  toolNames,
  fullTierToolNames: toolNames.filter((name) => shared.LOCAL_BROWSER_TOOL_TIERS[name] === "full"),
  originExemptToolNames: [...shared.LOCAL_BROWSER_ORIGIN_EXEMPT_TOOL_NAMES],
  internalToolNames: [...shared.LOCAL_BROWSER_INTERNAL_TOOL_NAMES],
  toolCapabilities: { ...shared.LOCAL_BROWSER_TOOL_CAPABILITIES },
  actions: [...shared.LOCAL_BROWSER_ACTIONS],
  mouseActions: [...shared.LOCAL_BROWSER_MOUSE_ACTIONS],
  keyActions: [...shared.LOCAL_BROWSER_KEY_ACTIONS],
  viewerStates: [...shared.LOCAL_BROWSER_VIEWER_STATES],
  uiOps: [...shared.LOCAL_BROWSER_UI_OPS],
  callDefaults: {
    snapshotNodes: shared.LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES,
    readChars: shared.LOCAL_BROWSER_TEXT_DEFAULT_CHARS,
    callTimeoutMs: shared.LOCAL_BROWSER_CALL_TIMEOUT_MS,
    viewerFrameIntervalMs: shared.LOCAL_BROWSER_VIEWER_FRAME_INTERVAL_MS,
    extensionBudgetMarginMs: shared.LOCAL_BROWSER_EXTENSION_BUDGET_MARGIN_MS,
  },
};

const json = JSON.stringify(contract, null, 2);
const outputs = [
  { target: path.join(sharedLib, "protocol.contract.json"), text: json + "\n" },
  {
    target: path.join(sharedLib, "contract.js"),
    text:
      "(function () {\n  \"use strict\";\n  globalThis.LB = globalThis.LB || {};\n  globalThis.LB.contract = " +
      json.replaceAll("\n", "\n  ") +
      ";\n})();\n",
  },
];

const check = process.argv.includes("--check");
let stale = 0;

for (const { target, text } of outputs) {
  if (check) {
    const current = await readFile(target, "utf8").catch(() => null);
    if (current !== text) {
      stale += 1;
      console.error("Stale browser protocol contract: " + path.relative(root, target));
    }
    continue;
  }
  await writeFile(target, text);
  console.log("Wrote " + path.relative(root, target));
}

if (check) {
  if (stale > 0) {
    console.error("Run pnpm generate:local-browser-protocol, then the shared sync, and commit the result.");
    process.exit(1);
  }
  console.log("Browser protocol contract is current (" + toolNames.length + " tools, protocol " + contract.protocol + ").");
}
