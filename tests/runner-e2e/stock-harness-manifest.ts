import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildContract } from "../../packages/wardmote-runner/scripts/generate-capability-contract.mjs";

/** Canonical derived metadata must match the instruction sources before providers. */
export async function verifyCapabilityManifest(
  read = (path: string) => readFileSync(path, "utf8"),
  checkInventory = () => execFileSync(process.execPath, [fileURLToPath(new URL(
    "../../packages/wardmote-runner/scripts/check-capability-inventory.mjs", import.meta.url,
  ))], { stdio: "pipe" }),
) {
  const expected = await buildContract();
  for (const [path, content] of Object.entries(expected)) {
    if (read(path) !== content) throw new Error(`Generated capability manifest drift: ${path}`);
  }
  checkInventory();
  return true;
}
