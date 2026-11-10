import { describe, expect, it } from "vitest";
import { operatorRetiredEnvKeys, rewriteRetiredNames, rewriteRetiredNamesInJson } from "./retired-names.js";

describe("rewriteRetiredNames", () => {
  it("renames env, MCP tools, headers, routes and bundled skills in agent instructions", () => {
    const before = [
      "Use $PAPERCLIP_RUN_SCRATCH_DIR and PAPERCLIP_AGENT_ID.",
      "Call paperclipListIssues, then paperclipListExecutionOperations.",
      "Inside fabric use extensions.mcp__paperclip_paperclipaddcomment, never mcp__paperclip_*.",
      "Claude sees mcp__paperclip__write_document and mcp__paperclip-assigned__kv_set.",
      "Send X-Paperclip-Run-Id and x-paperclip-tool-gateway-token to /mcp/paperclip.",
      "Read skill://paperclip, skills/paperclip/scripts/x.sh, skills/paperclip-board and the paperclip-create-agent skill.",
      "Fetch /api/skills/paperclip.",
    ].join("\n");
    const result = rewriteRetiredNames(before);
    expect(result.text).toBe([
      "Use $WARDMOTE_RUN_SCRATCH_DIR and WARDMOTE_AGENT_ID.",
      "Call wardmoteListIssues, then wardmoteListExecutionWorkspaceOperations.",
      "Inside fabric use extensions.mcp__wardmote_wardmoteaddcomment, never mcp__wardmote_*.",
      "Claude sees mcp__wardmote__write_document and mcp__wardmote-assigned__kv_set.",
      "Send X-Wardmote-Run-Id and x-wardmote-tool-gateway-token to /mcp/wardmote.",
      "Read skill://wardmote, skills/wardmote/scripts/x.sh, skills/wardmote-board and the wardmote-create-agent skill.",
      "Fetch /api/skills/wardmote.",
    ].join("\n"));
    expect(result.replacements).toBe(16);
  });

  it("renames the bundled helper scripts", () => {
    expect(rewriteRetiredNames("Use `skills/paperclip/scripts/paperclip-upload-artifact.sh` and scripts/paperclip-issue-update.sh --dry-run.")).toEqual({
      text: "Use `skills/wardmote/scripts/wardmote-upload-artifact.sh` and scripts/wardmote-issue-update.sh --dry-run.",
      replacements: 3,
    });
    expect(rewriteRetiredNames("my-paperclip-upload-artifact.sh paperclip-upload-artifact.shx").replacements).toBe(0);
  });

  it("renames protocol schema ids but keeps the ids bound to pinned runtime artifacts", () => {
    expect(rewriteRetiredNames('Answer with {"schema":"paperclip.question_set.v1"} or paperclip.prp.command.v3.')).toEqual({
      text: 'Answer with {"schema":"wardmote.question_set.v1"} or wardmote.prp.command.v3.',
      replacements: 2,
    });
    expect(rewriteRetiredNames("paperclip.prp.terminal.v1 paperclip.pi.permission.v1:x paperclip.dev paperclip.question_set.v1x").replacements).toBe(0);
  });

  it("maps lowercase OMP tool names through the irregular renames", () => {
    expect(rewriteRetiredNames("mcp__paperclip_paperclipstarttoolconnection").text)
      .toBe("mcp__wardmote_wardmotestartauthorizationtoolconnection");
  });

  it("keeps operator env names, prose, paths and unrelated identifiers", () => {
    const text = "Paperclip runs at ~/.paperclip-pro with $PAPERCLIP_WIRA_API_KEY; see skills/paperclip-page and paperclip-board-token.";
    const result = rewriteRetiredNames(text, { keepEnvKeys: new Set(["PAPERCLIP_WIRA_API_KEY"]) });
    expect(result).toEqual({ text, replacements: 0 });
  });

  it("keeps env names pinned inside the Pi distribution closure", () => {
    const result = rewriteRetiredNames("PAPERCLIP_PI_READ_ONLY=1 PAPERCLIP_ACPX_ISOLATED_CONTEXT=1 PAPERCLIP_PI_PROVIDERS=x");
    expect(result).toEqual({ text: "PAPERCLIP_PI_READ_ONLY=1 PAPERCLIP_ACPX_ISOLATED_CONTEXT=1 WARDMOTE_PI_PROVIDERS=x", replacements: 1 });
  });

  it("is a no-op on already rewritten text", () => {
    const once = rewriteRetiredNames("PAPERCLIP_API_URL paperclipMe mcp__paperclip__x skill://paperclip").text;
    expect(rewriteRetiredNames(once)).toEqual({ text: once, replacements: 0 });
  });
});

describe("rewriteRetiredNamesInJson", () => {
  it("rewrites string leaves and leaves object keys alone", () => {
    const config = { paperclipRuntimeSkills: ["paperclipMe"], env: { PAPERCLIP_WIRA_API_KEY: "PAPERCLIP_API_KEY" }, count: 2 };
    const result = rewriteRetiredNamesInJson(config, { keepEnvKeys: operatorRetiredEnvKeys(config) });
    expect(result.value).toEqual({ paperclipRuntimeSkills: ["wardmoteMe"], env: { PAPERCLIP_WIRA_API_KEY: "WARDMOTE_API_KEY" }, count: 2 });
    expect(result.replacements).toBe(2);
  });
});
