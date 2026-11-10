import { describe, expect, it } from "vitest";
import {
  wardmoteAccessGuidance,
  wardmoteAccessMode,
  wardmoteMcpEndpoint,
  wardmoteMcpHttpHeaders,
  wardmoteMcpToolsets,
  renderWardmoteMcpConfig,
} from "./wardmote-mcp.js";
import {
  wardmoteMcpHttpTarget,
  renderWardmoteGeminiSettings,
  renderWardmoteGrokConfig,
  renderWardmoteOpenCodeConfig,
} from "./wardmote-mcp-mount.js";
import {
  wardmoteAgentPromptTemplate,
  renderWardmoteWakePrompt,
} from "./server-utils.js";

const TOOL_NAME_RE = /\bpaperclip[A-Z]\w*/;

const runEnv = {
  WARDMOTE_API_URL: "https://wardmote.test",
  WARDMOTE_API_KEY: "run-key",
  WARDMOTE_RUN_ID: "run-7",
};

describe("wardmoteAccessMode", () => {
  it("arms MCP only when the toggle is on and the run carries a reachable credential", () => {
    expect(wardmoteAccessMode({}, runEnv)).toBe("mcp");
    expect(wardmoteAccessMode({ wardmoteMcp: false }, runEnv)).toBe("rest");
    expect(wardmoteAccessMode({ wardmoteMcp: "false" }, runEnv)).toBe("rest");
    expect(wardmoteAccessMode({}, { ...runEnv, WARDMOTE_API_KEY: "  " })).toBe("rest");
    expect(wardmoteAccessMode({}, { ...runEnv, WARDMOTE_API_URL: undefined })).toBe("rest");
  });
});

describe("wardmoteAgentPromptTemplate", () => {
  it("names the MCP tools only on the mcp surface and the REST routes otherwise", () => {
    const mcp = wardmoteAgentPromptTemplate("mcp");
    expect(mcp).toContain("wardmoteAddComment");
    expect(mcp).toContain("wardmoteSuggestTasks");

    const rest = wardmoteAgentPromptTemplate("rest");
    expect(rest).not.toMatch(TOOL_NAME_RE);
    expect(rest).toContain("POST /api/issues/$WARDMOTE_TASK_ID/interactions");
    expect(rest).toContain("PATCH /api/issues/$WARDMOTE_TASK_ID");
  });

  it("keeps the execution contract identical apart from the access-surface lines", () => {
    const mcpLines = wardmoteAgentPromptTemplate("mcp").split("\n");
    const restLines = wardmoteAgentPromptTemplate("rest").split("\n");
    expect(restLines).toHaveLength(mcpLines.length);
    const differing = mcpLines.filter((line, index) => line !== restLines[index]);
    expect(differing).toHaveLength(2);
  });
});

describe("renderWardmoteWakePrompt", () => {
  const wake = {
    reason: "issue_assigned",
    issue: { id: "issue-1", identifier: "PC-1", title: "Ship it", status: "todo" },
    checkedOutByHarness: true,
  };

  it("points the already-checked-out note at the surface the run actually has", () => {
    expect(renderWardmoteWakePrompt(wake)).toContain("`wardmoteCheckoutIssue`");
    const rest = renderWardmoteWakePrompt(wake, { wardmoteAccess: "rest" });
    expect(rest).not.toMatch(TOOL_NAME_RE);
    expect(rest).toContain("POST /api/issues/$WARDMOTE_TASK_ID/checkout");
  });
});

describe("wardmoteAccessGuidance", () => {
  it("teaches tools on mcp and curl with the run headers on rest", () => {
    const mcp = wardmoteAccessGuidance("mcp", { toolsets: "core,extended" });
    expect(mcp).toContain("toolsets: core,extended");
    expect(mcp).toContain("wardmoteListIssues");

    const rest = wardmoteAccessGuidance("rest", { shellHint: "run_shell_command" });
    expect(rest).not.toMatch(TOOL_NAME_RE);
    expect(rest).toContain("Authorization: Bearer $WARDMOTE_API_KEY");
    expect(rest).toContain("X-Wardmote-Run-Id: $WARDMOTE_RUN_ID");
    expect(rest).toContain("run_shell_command");
  });

  it("advertises the escape hatch only when the mounted surface is large", () => {
    const escapeHatch = /escape hatch is cheaper than carrying the extended surface/;

    expect(wardmoteAccessGuidance("mcp", { toolsets: "core" })).not.toMatch(escapeHatch);
    expect(wardmoteAccessGuidance("mcp", { toolsets: "extended" })).toMatch(escapeHatch);
    expect(wardmoteAccessGuidance("mcp", { toolsets: "all" })).toMatch(escapeHatch);
    expect(wardmoteAccessGuidance("mcp", { toolsets: "extended,core" })).toMatch(escapeHatch);
    expect(wardmoteAccessGuidance("mcp", { toolsets: "extended" })).toContain(
      "wardmoteApiRequest is always available",
    );
  });

  it("advertises the escape hatch for the canonical full toolset", () => {
    const escapeHatch = /escape hatch is cheaper than carrying the extended surface/;

    expect(wardmoteAccessGuidance("mcp", { toolsets: "full" })).toMatch(escapeHatch);
    expect(wardmoteAccessGuidance("mcp", { toolsets: "full,core" })).toMatch(escapeHatch);
    expect(wardmoteAccessGuidance("mcp", { toolsets: "core" })).not.toMatch(escapeHatch);
  });
});

describe("paperclip MCP endpoint", () => {
  it("normalizes the API base and encodes the toolsets", () => {
    expect(wardmoteMcpEndpoint("https://wardmote.test/", "core")).toBe(
      "https://wardmote.test/api/mcp/wardmote?toolsets=core",
    );
    expect(wardmoteMcpEndpoint("https://wardmote.test/api", "core,extended")).toBe(
      "https://wardmote.test/api/mcp/wardmote?toolsets=core%2Cextended",
    );
  });

  it("defaults the toolsets and drops empty entries", () => {
    expect(wardmoteMcpToolsets({})).toBe("core");
    expect(wardmoteMcpToolsets({ wardmoteMcpToolsets: " , " })).toBe("core");
    expect(wardmoteMcpToolsets({ wardmoteMcpToolsets: " extended , core " })).toBe("extended,core");
  });

  it("omits the run-id header when the run does not carry one", () => {
    expect(wardmoteMcpHttpHeaders({ apiKey: "k", runId: "  " })).toEqual({
      Authorization: "Bearer k",
    });
  });
});

describe("per-runtime MCP config renderers", () => {
  const target = wardmoteMcpHttpTarget({ env: runEnv, toolsets: "core" });

  it("resolves the endpoint and the authenticating headers once", () => {
    expect(target).toEqual({
      url: "https://wardmote.test/api/mcp/wardmote?toolsets=core",
      headers: {
        Authorization: "Bearer run-key",
        "X-Wardmote-Run-Id": "run-7",
      },
    });
  });

  it("renders the shape each runtime reads", () => {
    expect(JSON.parse(renderWardmoteGeminiSettings(target))).toEqual({
      mcpServers: { wardmote: { httpUrl: target.url, headers: target.headers } },
    });
    expect(JSON.parse(renderWardmoteOpenCodeConfig(target)).mcp.wardmote).toEqual({
      type: "remote",
      url: target.url,
      enabled: true,
      oauth: false,
      headers: target.headers,
    });
    const grok = renderWardmoteGrokConfig(target);
    expect(grok).toContain('[mcp_servers."wardmote"]');
    expect(grok).toContain(`url = ${JSON.stringify(target.url)}`);
    expect(grok).toContain('"Authorization" = "Bearer run-key"');
    expect(grok).toContain('"X-Wardmote-Run-Id" = "run-7"');
  });

  it("keeps the credential out of the omp config file as an env reference", () => {
    const config = JSON.parse(
      renderWardmoteMcpConfig({
        enabled: true,
        transport: "http",
        command: { command: "paperclip-mcp-server", args: [], source: "path" },
        toolsets: "core",
        env: runEnv,
      }),
    );
    expect(config.mcpServers.wardmote.headers.Authorization).toBe("Bearer ${WARDMOTE_API_KEY}");
    expect(config.mcpServers.wardmote.headers["X-Wardmote-Run-Id"]).toBe("run-7");
  });
});
