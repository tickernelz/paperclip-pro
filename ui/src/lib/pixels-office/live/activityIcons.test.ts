import { describe, expect, it } from "vitest";
import { activityIconForTool } from "./activityIcons";

describe("tool to activity icon", () => {
  it("maps the common adapter tool names onto drawable categories", () => {
    const cases: Array<[string, string]> = [
      ["Read", "read"],
      ["read_file", "read"],
      ["Grep", "read"],
      ["Glob", "read"],
      ["Edit", "write"],
      ["Write", "write"],
      ["MultiEdit", "write"],
      ["apply_patch", "write"],
      ["Bash", "run"],
      ["run_terminal_cmd", "run"],
      ["WebFetch", "web"],
      ["WebSearch", "web"],
      ["browser_navigate", "web"],
      ["TodoWrite", "think"],
      ["sequential_thinking", "think"],
      ["post_comment", "comment"],
      ["send_message", "comment"],
    ];
    for (const [tool, expected] of cases) {
      expect(activityIconForTool(tool), tool).toBe(expected);
    }
  });

  it("strips an MCP server prefix before classifying", () => {
    expect(activityIconForTool("mcp__github__create_pull_request")).toBe("write");
    expect(activityIconForTool("mcp__playwright__browser_click")).toBe("web");
  });

  it("falls back to other for an unknown tool", () => {
    expect(activityIconForTool("quantum_flux")).toBe("other");
  });

  it("shows thinking when the run has no tool in flight", () => {
    expect(activityIconForTool(null)).toBe("think");
    expect(activityIconForTool("")).toBe("think");
  });
});
