import { describe, expect, it } from "vitest";
import { cappedName, NAME_LENGTH_LIMIT } from "../../../scripts/generate-mcp-tools.js";

describe("generated tool name capping", () => {
  it("keeps a name that already fits", () => {
    expect(cappedName("wardmoteGetIssue", "GET", "/api/issues/{id}", new Set())).toBe(
      "wardmoteGetIssue",
    );
  });

  it("drops the trailing interior path words before falling back to a digest", () => {
    const name = cappedName(
      "wardmoteListExecutionWorkspaceWorkspaceOperations",
      "GET",
      "/api/execution-workspaces/{id}/workspace-operations",
      new Set(),
    );
    expect(name).toBe("wardmoteListExecutionWorkspaceOperations");
    expect(name).not.toContain("_");
  });

  it("keeps the parent resource and drops interior words from the right", () => {
    const name = cappedName(
      "wardmoteCreateRoutineDescriptionAnnotationComment",
      "POST",
      "/api/routines/{id}/description/annotations/{threadId}/comments",
      new Set(),
    );
    expect(name).toBe("wardmoteCreateRoutineDescriptionComment");
    expect(name.length).toBeLessThanOrEqual(NAME_LENGTH_LIMIT);
  });

  it("keeps the object's own modifiers while dropping the oldest interior word", () => {
    const name = cappedName(
      "wardmoteGetEnvironmentCustomImageTemplate",
      "GET",
      "/api/environments/{environmentId}/custom-image-templates/{templateId}",
      new Set(),
    );
    expect(name).toBe("wardmoteGetEnvironmentCustomTemplate");
  });

  it("appends a deterministic path digest when shortening cannot reach the limit", () => {
    const long = "wardmoteSupercalifragilisticexpialidociousResourceName";
    const path = "/api/supercalifragilisticexpialidocious-resources/{id}";
    const name = cappedName(long, "POST", path, new Set());
    expect(name.length).toBeLessThanOrEqual(NAME_LENGTH_LIMIT);
    expect(name).toMatch(/^wardmote[A-Za-z]+_[0-9a-f]{6}$/);
    expect(cappedName(long, "POST", path, new Set())).toBe(name);
  });

  it("appends a deterministic path digest when every shortened form is taken", () => {
    const taken = new Set(["wardmoteSupercalifragilisticexpialidociousName"]);
    const name = cappedName(
      "wardmoteSupercalifragilisticexpialidociousResourceName",
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
    const long = "wardmoteSupercalifragilisticexpialidociousResourceName";
    const first = cappedName(long, "POST", "/api/one/deep/path", taken);
    taken.add(first);
    const second = cappedName(long, "POST", "/api/two/deep/path", taken);
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(NAME_LENGTH_LIMIT);
  });

  it("still resolves a collision when the base name fits", () => {
    const taken = new Set(["wardmoteGetIssue"]);
    expect(cappedName("wardmoteGetIssue", "GET", "/api/issues/{id}", taken)).not.toBe(
      "wardmoteGetIssue",
    );
  });
});
