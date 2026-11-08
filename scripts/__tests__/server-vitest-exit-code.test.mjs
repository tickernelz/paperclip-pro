import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverRoot = path.join(repoRoot, "server");

test("a failing server test fails the server vitest process under CI", { timeout: 180_000 }, () => {
  const probe = path.join(serverRoot, "src", "__tests__", `exit-code-probe-${process.pid}.test.ts`);
  writeFileSync(probe, 'import { expect, it } from "vitest";\nit("fails", () => { expect(1).toBe(2); });\n');
  try {
    const result = spawnSync("pnpm", ["exec", "vitest", "run", "--maxWorkers=2", path.relative(serverRoot, probe)], {
      cwd: serverRoot,
      env: { ...process.env, CI: "true", NODE_ENV: "test" },
      encoding: "utf8",
    });
    assert.equal(result.error, undefined);
    assert.match(result.stdout + result.stderr, /1 failed/);
    assert.notEqual(result.status, 0, "vitest reported a failure but exited 0");
  } finally {
    rmSync(probe, { force: true });
  }
});
