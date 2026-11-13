import { mkdtemp, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureWardmoteWorkspace, diffWardmoteWorkspace } from "./workspace-diff.js";

describe("runner-verified workspace diffs", () => {
  it("captures create, modify, delete, and rename without runner-owned noise", async () => {
    const root = await mkdtemp(join(tmpdir(), "wardmote-workspace-diff-"));
    await mkdir(join(root, ".wardmote-runner-prp"));
    await writeFile(join(root, ".wardmote-runner-prp", "state.json"), "before");
    await writeFile(join(root, "modify.txt"), "old\n");
    await writeFile(join(root, "delete.txt"), "gone\n");
    await writeFile(join(root, "rename.txt"), "same\n");
    const before = await captureWardmoteWorkspace(root);

    await writeFile(join(root, ".wardmote-runner-prp", "state.json"), "after");
    await writeFile(join(root, "modify.txt"), "new\n");
    await writeFile(join(root, "create.txt"), "created\n");
    await writeFile(join(root, "delete.txt"), "");
    await rename(join(root, "rename.txt"), join(root, "renamed.txt"));
    const after = await captureWardmoteWorkspace(root);
    const diff = diffWardmoteWorkspace(before, after, "turn-1:workspace");

    expect(diff?.schema).toBe("wardmote.workspace.diff.v1");
    expect(diff?.source).toBe("runner_verified");
    expect(diff?.files.map((file) => [file.path, file.operation])).toEqual([
      ["create.txt", "create"],
      ["delete.txt", "modify"],
      ["modify.txt", "modify"],
      ["renamed.txt", "rename"],
    ]);
    expect(diff?.files.find((file) => file.path === "renamed.txt")?.previousPath).toBe("rename.txt");
    expect(JSON.stringify(diff)).not.toContain(".wardmote-runner-prp");
  });

  it("returns no record when the workspace did not change", async () => {
    const root = await mkdtemp(join(tmpdir(), "wardmote-workspace-stable-"));
    await writeFile(join(root, "stable.txt"), "same\n");
    const before = await captureWardmoteWorkspace(root);
    const after = await captureWardmoteWorkspace(root);
    expect(diffWardmoteWorkspace(before, after, "turn-1:workspace")).toBeNull();
  });
});
