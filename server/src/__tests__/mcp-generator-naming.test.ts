import { describe, expect, it } from "vitest";
import { cappedName, NAME_LENGTH_LIMIT } from "../../../scripts/generate-mcp-tools.js";

describe("generated tool name capping", () => {
  it("keeps a name that already fits", () => {
    expect(cappedName("paperclipGetIssue", "GET", "/api/issues/{id}", new Set())).toBe(
      "paperclipGetIssue",
    );
  });

  it("drops redundant interior path words before falling back to a digest", () => {
    const name = cappedName(
      "paperclipListExecutionWorkspaceWorkspaceOperations",
      "GET",
      "/api/execution-workspaces/{id}/workspace-operations",
      new Set(),
    );
    expect(name).toBe("paperclipListWorkspaceOperations");
    expect(name).not.toContain("_");
  });

  it("appends a deterministic path digest when shortening cannot reach the limit", () => {
    const long = "paperclipSupercalifragilisticexpialidociousResourceName";
    const path = "/api/supercalifragilisticexpialidocious-resources/{id}";
    const name = cappedName(long, "POST", path, new Set());
    expect(name.length).toBeLessThanOrEqual(NAME_LENGTH_LIMIT);
    expect(name).toMatch(/^paperclip[A-Za-z]+_[0-9a-f]{6}$/);
    expect(cappedName(long, "POST", path, new Set())).toBe(name);
  });

  it("appends a deterministic path digest when every shortened form is taken", () => {
    const taken = new Set(["paperclipSupercalifragilisticexpialidociousName"]);
    const name = cappedName(
      "paperclipSupercalifragilisticexpialidociousResourceName",
      "POST",
      "/api/supercalifragilisticexpialidocious-resources/{id}",
      taken,
    );
    expect(name.length).toBeLessThanOrEqual(NAME_LENGTH_LIMIT);
    expect(name).toMatch(/_[0-9a-f]{6}$/);
    expect(taken.has(name)).toBe(false);
  });

  it("gives two different routes different digests", () => {
    const taken = new Set<string>();
    const long = "paperclipSupercalifragilisticexpialidociousResourceName";
    const first = cappedName(long, "POST", "/api/one/deep/path", taken);
    taken.add(first);
    const second = cappedName(long, "POST", "/api/two/deep/path", taken);
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(NAME_LENGTH_LIMIT);
  });

  it("still resolves a collision when the base name fits", () => {
    const taken = new Set(["paperclipGetIssue"]);
    expect(cappedName("paperclipGetIssue", "GET", "/api/issues/{id}", taken)).not.toBe(
      "paperclipGetIssue",
    );
  });
});
