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

async function session(root: string, product: string, agent: string, body: string) {
  const dir = path.join(root, ".omp", product, "sessions", agent);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "s1.jsonl"), body);
}

function read(root: string, product: string, agent: string) {
  return fs.readFile(path.join(root, ".omp", product, "sessions", agent, "s1.jsonl"), "utf8");
}

describe("moveRetiredOmpSessionRoot", () => {
  it("moves sessions written before the rename and removes the empty retired directory", async () => {
    const root = await home();
    await session(root, RETIRED_OMP_SESSION_PRODUCT_DIR, "agent-1", "{}\n");
    expect(await moveRetiredOmpSessionRoot(root)).toEqual({ status: "moved", conflicts: [] });
    expect(await read(root, "wardmote", "agent-1")).toBe("{}\n");
    await expect(fs.lstat(path.join(root, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await moveRetiredOmpSessionRoot(root)).toEqual({ status: "absent" });
  });

  it("moves each retired agent directory into an existing Wardmote root, replacing empty directories", async () => {
    const root = await home();
    await session(root, RETIRED_OMP_SESSION_PRODUCT_DIR, "agent-old", "old\n");
    await session(root, RETIRED_OMP_SESSION_PRODUCT_DIR, "agent-1", "kept\n");
    await fs.mkdir(path.join(root, ".omp", "wardmote", "sessions", "agent-1"), { recursive: true });
    await session(root, "wardmote", "agent-new", "new\n");
    expect(await moveRetiredOmpSessionRoot(root)).toEqual({ status: "moved", conflicts: [] });
    expect(await read(root, "wardmote", "agent-old")).toBe("old\n");
    expect(await read(root, "wardmote", "agent-1")).toBe("kept\n");
    expect(await read(root, "wardmote", "agent-new")).toBe("new\n");
    await expect(fs.lstat(path.join(root, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves a retired agent directory in place when the Wardmote root already holds sessions for it", async () => {
    const root = await home();
    await session(root, RETIRED_OMP_SESSION_PRODUCT_DIR, "agent-1", "old\n");
    await session(root, RETIRED_OMP_SESSION_PRODUCT_DIR, "agent-2", "two\n");
    await session(root, "wardmote", "agent-1", "new\n");
    expect(await moveRetiredOmpSessionRoot(root)).toEqual({ status: "moved", conflicts: ["agent-1"] });
    expect(await read(root, RETIRED_OMP_SESSION_PRODUCT_DIR, "agent-1")).toBe("old\n");
    expect(await read(root, "wardmote", "agent-1")).toBe("new\n");
    expect(await read(root, "wardmote", "agent-2")).toBe("two\n");
  });
});
