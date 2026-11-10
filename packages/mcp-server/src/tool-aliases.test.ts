import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalToolName, paperclipToolCatalog } from "./catalog.js";
import { WardmoteApiClient } from "./client.js";
import { connectWardmoteMcpServer, createWardmoteMcpServer } from "./index.js";
import type { WardmoteMcpConfig } from "./config.js";

const config: WardmoteMcpConfig = {
  apiUrl: "http://localhost:3100/api",
  apiKey: "token-123",
  companyId: "11111111-1111-1111-1111-111111111111",
  agentId: "22222222-2222-2222-2222-222222222222",
  runId: "33333333-3333-3333-3333-333333333333",
  toolsets: ["core", "extended"],
  agentRole: null,
};

async function connectedClient() {
  const { server } = createWardmoteMcpServer(config, true);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([connectWardmoteMcpServer(server, serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("tool name aliases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the Features spellings to the advertised name and leaves retired names unmapped", () => {
    expect(canonicalToolName("wardmoteGetIssue")).toBe("wardmoteGetIssue");
    expect(canonicalToolName("paperclipGetIssue")).toBe("paperclipGetIssue");
    expect(canonicalToolName("wardmoteGetInstanceSettingFeatures")).toBe("wardmoteGetInstanceSettingExperimental");
    expect(canonicalToolName("wardmoteUpdateInstanceFeatures")).toBe("wardmoteUpdateInstanceExperimental");
    expect(canonicalToolName("wardmote")).toBe("wardmote");
    expect(canonicalToolName("connections_search")).toBe("connections_search");
  });

  it("keeps tools/list on the wardmote* names only", async () => {
    const client = await connectedClient();
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    const catalog = paperclipToolCatalog(new WardmoteApiClient(config), config.toolsets, true).listing.tools.map((tool) => tool.name);
    expect(listed).toEqual(catalog);
    expect(listed.some((name) => name.startsWith("paperclip"))).toBe(false);
    expect(listed).toContain("wardmoteGetInstanceSettingExperimental");
    expect(listed).not.toContain("wardmoteGetInstanceSettingFeatures");
  });

  it("answers the Features spelling like the advertised name and rejects retired names", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "issue-1", title: "Same" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await connectedClient();
    const results = [];
    for (const name of ["wardmoteGetInstanceSettingExperimental", "wardmoteGetInstanceSettingFeatures"]) {
      results.push({ name, result: await client.callTool({ name, arguments: {} }) });
    }
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(results[1]!.result).toEqual(results[0]!.result);
    expect(urls).toHaveLength(2);
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).toContain("/instance/settings/experimental");

    const retired = await client
      .callTool({ name: "paperclipGetIssue", arguments: { issueId: "PAP-1" } })
      .then((result) => ({ isError: Boolean(result.isError) }), () => ({ isError: true }));
    expect(retired.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
