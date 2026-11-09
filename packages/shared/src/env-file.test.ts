import { describe, expect, it } from "vitest";
import { encodeEnvValue, updateEnvFileContents } from "./env-file.js";

describe("env file editor", () => {
  it("pins minimal and JSON value encoding", () => {
    expect(encodeEnvValue("plain-value", "minimal")).toBe("plain-value");
    expect(encodeEnvValue("#439edb", "minimal")).toBe('"#439edb"');
    expect(encodeEnvValue("plain-value", "json")).toBe('"plain-value"');
  });

  it("preserves unrelated content and CRLF while updating every stale duplicate", () => {
    const original = [
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      "export WARDMOTE_HOME = '/old path'  # managed path",
      "WARDMOTE_DUPLICATE=stale",
      'WARDMOTE_DUPLICATE="current"',
      "TRAILING=untouched",
      "",
    ].join("\r\n");

    const updated = updateEnvFileContents(
      original,
      {
        WARDMOTE_HOME: "/new path",
        WARDMOTE_DUPLICATE: "current",
        WARDMOTE_WORKTREE_COLOR: "#439edb",
      },
      { valueEncoding: "minimal" },
    );

    expect(updated).toBe([
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      'export WARDMOTE_HOME = "/new path"  # managed path',
      "WARDMOTE_DUPLICATE=current",
      'WARDMOTE_DUPLICATE="current"',
      "TRAILING=untouched",
      'WARDMOTE_WORKTREE_COLOR="#439edb"',
      "",
    ].join("\r\n"));
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("uses JSON encoding for changed values without re-encoding current assignments", () => {
    const original = [
      "WARDMOTE_CURRENT=plain-value",
      "WARDMOTE_CHANGED=old",
      "UNKNOWN=\"operator value\"",
      "",
    ].join("\n");

    expect(
      updateEnvFileContents(
        original,
        {
          WARDMOTE_CURRENT: "plain-value",
          WARDMOTE_CHANGED: "new",
          WARDMOTE_ADDED: "added",
        },
        { valueEncoding: "json" },
      ),
    ).toBe([
      "WARDMOTE_CURRENT=plain-value",
      'WARDMOTE_CHANGED="new"',
      'UNKNOWN="operator value"',
      'WARDMOTE_ADDED="added"',
      "",
    ].join("\n"));
  });

  it("does not treat an unquoted dotenv comment as the managed value", () => {
    expect(
      updateEnvFileContents(
        ["WARDMOTE_COLOR=#439edb", "WARDMOTE_HOME=old# keep this comment"].join("\n"),
        {
          WARDMOTE_COLOR: "#439edb",
          WARDMOTE_HOME: "new",
        },
        { valueEncoding: "minimal" },
      ),
    ).toBe(
      ['WARDMOTE_COLOR="#439edb"#439edb', "WARDMOTE_HOME=new# keep this comment"].join("\n"),
    );
  });

  it("is a no-op when every managed duplicate is already current", () => {
    const original = [
      "export WARDMOTE_HOME = '/same path' # first",
      'WARDMOTE_HOME="/same path"',
      "UNKNOWN=value",
    ].join("\n");

    expect(updateEnvFileContents(original, { WARDMOTE_HOME: "/same path" })).toBe(original);
  });
});
