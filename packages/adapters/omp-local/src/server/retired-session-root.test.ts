import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveRetiredOmpSessionRoot, RETIRED_OMP_SESSION_PRODUCT_DIR } from "./retired-session-root.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

async function home() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-session-root-"));
  homes.push(dir);
  return dir;
}

describe("moveRetiredOmpSessionRoot", () => {
  it("moves sessions written before the rename and removes the empty retired directory", async () => {
    const root = await home();
    const retired = path.join(root, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR, "sessions", "agent-1");
    await fs.mkdir(retired, { recursive: true });
    await fs.writeFile(path.join(retired, "s1.jsonl"), "{}\n");
    expect(await moveRetiredOmpSessionRoot(root)).toBe("moved");
    expect(await fs.readFile(path.join(root, ".omp", "wardmote", "sessions", "agent-1", "s1.jsonl"), "utf8")).toBe("{}\n");
    await expect(fs.lstat(path.join(root, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await moveRetiredOmpSessionRoot(root)).toBe("absent");
  });

  it("leaves both roots untouched when the Wardmote root already exists", async () => {
    const root = await home();
    await fs.mkdir(path.join(root, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR, "sessions", "old"), { recursive: true });
    await fs.mkdir(path.join(root, ".omp", "wardmote", "sessions", "new"), { recursive: true });
    expect(await moveRetiredOmpSessionRoot(root)).toBe("kept-both");
    expect(await fs.readdir(path.join(root, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR, "sessions"))).toEqual(["old"]);
    expect(await fs.readdir(path.join(root, ".omp", "wardmote", "sessions"))).toEqual(["new"]);
  });
});
