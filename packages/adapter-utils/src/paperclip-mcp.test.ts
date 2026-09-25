import { describe, expect, it } from "vitest";
import {
  paperclipAccessGuidance,
  paperclipAccessMode,
  paperclipMcpEndpoint,
  paperclipMcpHttpHeaders,
  paperclipMcpToolsets,
  renderPaperclipMcpConfig,
} from "./paperclip-mcp.js";
import {
  paperclipMcpHttpTarget,
  renderPaperclipGeminiSettings,
  renderPaperclipGrokConfig,
  renderPaperclipOpenCodeConfig,
} from "./paperclip-mcp-mount.js";
import {
  paperclipAgentPromptTemplate,
  renderPaperclipWakePrompt,
} from "./server-utils.js";

const TOOL_NAME_RE = /\bpaperclip[A-Z]\w*/;

const runEnv = {
  PAPERCLIP_API_URL: "https://paperclip.test",
  PAPERCLIP_API_KEY: "run-key",
  PAPERCLIP_RUN_ID: "run-7",
};

describe("paperclipAccessMode", () => {
  it("arms MCP only when the toggle is on and the run carries a reachable credential", () => {
    expect(paperclipAccessMode({}, runEnv)).toBe("mcp");
    expect(paperclipAccessMode({ paperclipMcp: false }, runEnv)).toBe("rest");
    expect(paperclipAccessMode({ paperclipMcp: "false" }, runEnv)).toBe("rest");
    expect(paperclipAccessMode({}, { ...runEnv, PAPERCLIP_API_KEY: "  " })).toBe("rest");
    expect(paperclipAccessMode({}, { ...runEnv, PAPERCLIP_API_URL: undefined })).toBe("rest");
  });
});

describe("paperclipAgentPromptTemplate", () => {
  it("names the MCP tools only on the mcp surface and the REST routes otherwise", () => {
    const mcp = paperclipAgentPromptTemplate("mcp");
    expect(mcp).toContain("paperclipAddComment");
    expect(mcp).toContain("paperclipSuggestTasks");

    const rest = paperclipAgentPromptTemplate("rest");
    expect(rest).not.toMatch(TOOL_NAME_RE);
    expect(rest).toContain("POST /api/issues/$PAPERCLIP_TASK_ID/interactions");
    expect(rest).toContain("PATCH /api/issues/$PAPERCLIP_TASK_ID");
  });

  it("keeps the execution contract identical apart from the access-surface lines", () => {
    const mcpLines = paperclipAgentPromptTemplate("mcp").split("\n");
    const restLines = paperclipAgentPromptTemplate("rest").split("\n");
    expect(restLines).toHaveLength(mcpLines.length);
    const differing = mcpLines.filter((line, index) => line !== restLines[index]);
    expect(differing).toHaveLength(2);
  });
});

describe("renderPaperclipWakePrompt", () => {
  const wake = {
    reason: "issue_assigned",
    issue: { id: "issue-1", identifier: "PC-1", title: "Ship it", status: "todo" },
    checkedOutByHarness: true,
  };

  it("points the already-checked-out note at the surface the run actually has", () => {
    expect(renderPaperclipWakePrompt(wake)).toContain("`paperclipCheckoutIssue`");
    const rest = renderPaperclipWakePrompt(wake, { paperclipAccess: "rest" });
    expect(rest).not.toMatch(TOOL_NAME_RE);
    expect(rest).toContain("POST /api/issues/$PAPERCLIP_TASK_ID/checkout");
  });
});

describe("paperclipAccessGuidance", () => {
  it("teaches tools on mcp and curl with the run headers on rest", () => {
    const mcp = paperclipAccessGuidance("mcp", { toolsets: "core,extended" });
    expect(mcp).toContain("toolsets: core,extended");
    expect(mcp).toContain("paperclipListIssues");

    const rest = paperclipAccessGuidance("rest", { shellHint: "run_shell_command" });
    expect(rest).not.toMatch(TOOL_NAME_RE);
    expect(rest).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(rest).toContain("X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID");
    expect(rest).toContain("run_shell_command");
  });
});

describe("paperclip MCP endpoint", () => {
  it("normalizes the API base and encodes the toolsets", () => {
    expect(paperclipMcpEndpoint("https://paperclip.test/", "core")).toBe(
      "https://paperclip.test/api/mcp/paperclip?toolsets=core",
    );
    expect(paperclipMcpEndpoint("https://paperclip.test/api", "core,extended")).toBe(
      "https://paperclip.test/api/mcp/paperclip?toolsets=core%2Cextended",
    );
  });

  it("defaults the toolsets and drops empty entries", () => {
    expect(paperclipMcpToolsets({})).toBe("core");
    expect(paperclipMcpToolsets({ paperclipMcpToolsets: " , " })).toBe("core");
    expect(paperclipMcpToolsets({ paperclipMcpToolsets: " extended , core " })).toBe("extended,core");
  });

  it("omits the run-id header when the run does not carry one", () => {
    expect(paperclipMcpHttpHeaders({ apiKey: "k", runId: "  " })).toEqual({
      Authorization: "Bearer k",
    });
  });
});

describe("per-runtime MCP config renderers", () => {
  const target = paperclipMcpHttpTarget({ env: runEnv, toolsets: "core" });

  it("resolves the endpoint and the authenticating headers once", () => {
    expect(target).toEqual({
      url: "https://paperclip.test/api/mcp/paperclip?toolsets=core",
      headers: {
        Authorization: "Bearer run-key",
        "X-Paperclip-Run-Id": "run-7",
      },
    });
  });

  it("renders the shape each runtime reads", () => {
    expect(JSON.parse(renderPaperclipGeminiSettings(target))).toEqual({
      mcpServers: { paperclip: { httpUrl: target.url, headers: target.headers } },
    });
    expect(JSON.parse(renderPaperclipOpenCodeConfig(target)).mcp.paperclip).toEqual({
      type: "remote",
      url: target.url,
      enabled: true,
      oauth: false,
      headers: target.headers,
    });
    const grok = renderPaperclipGrokConfig(target);
    expect(grok).toContain('[mcp_servers."paperclip"]');
    expect(grok).toContain(`url = ${JSON.stringify(target.url)}`);
    expect(grok).toContain('"Authorization" = "Bearer run-key"');
    expect(grok).toContain('"X-Paperclip-Run-Id" = "run-7"');
  });

  it("keeps the credential out of the omp config file as an env reference", () => {
    const config = JSON.parse(
      renderPaperclipMcpConfig({
        enabled: true,
        transport: "http",
        command: { command: "paperclip-mcp-server", args: [], source: "path" },
        toolsets: "core",
        env: runEnv,
      }),
    );
    expect(config.mcpServers.paperclip.headers.Authorization).toBe("Bearer ${PAPERCLIP_API_KEY}");
    expect(config.mcpServers.paperclip.headers["X-Paperclip-Run-Id"]).toBe("run-7");
  });
});
