import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalToolName, paperclipToolCatalog } from "./catalog.js";
import { PaperclipApiClient } from "./client.js";
import { connectPaperclipMcpServer, createPaperclipMcpServer } from "./index.js";
import type { PaperclipMcpConfig } from "./config.js";

const config: PaperclipMcpConfig = {
  apiUrl: "http://localhost:3100/api",
  apiKey: "token-123",
  companyId: "11111111-1111-1111-1111-111111111111",
  agentId: "22222222-2222-2222-2222-222222222222",
  runId: "33333333-3333-3333-3333-333333333333",
  toolsets: ["core", "extended"],
  agentRole: null,
};

async function connectedClient() {
  const { server } = createPaperclipMcpServer(config, true);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([connectPaperclipMcpServer(server, serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("tool name aliases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps wardmote* and Features spellings to the advertised name", () => {
    expect(canonicalToolName("wardmoteGetIssue")).toBe("paperclipGetIssue");
    expect(canonicalToolName("paperclipGetIssue")).toBe("paperclipGetIssue");
    expect(canonicalToolName("paperclipGetInstanceSettingFeatures")).toBe("paperclipGetInstanceSettingExperimental");
    expect(canonicalToolName("wardmoteUpdateInstanceFeatures")).toBe("paperclipUpdateInstanceExperimental");
    expect(canonicalToolName("wardmote")).toBe("wardmote");
    expect(canonicalToolName("connections_search")).toBe("connections_search");
  });

  it("keeps tools/list on the paperclip* names only", async () => {
    const client = await connectedClient();
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    const catalog = paperclipToolCatalog(new PaperclipApiClient(config), config.toolsets, true).listing.tools.map((tool) => tool.name);
    expect(listed).toEqual(catalog);
    expect(listed.some((name) => name.startsWith("wardmote"))).toBe(false);
    expect(listed).toContain("paperclipGetInstanceSettingExperimental");
    expect(listed).not.toContain("paperclipGetInstanceSettingFeatures");
  });

  it("answers the old and new tool names with identical requests and results", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "issue-1", title: "Same" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await connectedClient();
    const results = [];
    for (const name of ["paperclipGetIssue", "wardmoteGetIssue", "paperclipGetInstanceSettingExperimental", "paperclipGetInstanceSettingFeatures", "wardmoteGetInstanceSettingFeatures"]) {
      const args = name.includes("Issue") ? { issueId: "PAP-1" } : {};
      results.push({ name, result: await client.callTool({ name, arguments: args }) });
    }
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(results[1]!.result).toEqual(results[0]!.result);
    expect(results[3]!.result).toEqual(results[2]!.result);
    expect(results[4]!.result).toEqual(results[2]!.result);
    expect(urls[1]).toBe(urls[0]);
    expect(new Set(urls.slice(2)).size).toBe(1);
    expect(urls[2]).toContain("/instance/settings/experimental");
  });
});
