import { describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "../../../packages/mcp-server/src/client.js";
import { createGeneratedToolDefinitions } from "../../../packages/mcp-server/src/generated-tools.js";

function client() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: null,
    toolsets: ["core", "extended"],
    agentRole: null,
  });
}

function tool(name: string) {
  const found = createGeneratedToolDefinitions(client(), ["core", "extended"], true).find(
    (candidate) => candidate.name === name,
  );
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe("renamed path placeholders keep the wire path", () => {
  it("substitutes a single renamed placeholder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await tool("paperclipListIssueWorkProducts").execute({ issueId: "PAP-1135" });
    expect(String((fetchMock.mock.calls[0] as [URL])[0])).toBe(
      "http://localhost:3100/api/issues/PAP-1135/work-products",
    );
    vi.restoreAllMocks();
  });

  it("substitutes every placeholder on a two-placeholder path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await tool("paperclipAcceptIssueInteraction").execute({
      issueId: "PAP-1",
      interactionId: "interaction-9",
    });
    expect(String((fetchMock.mock.calls[0] as [URL])[0])).toBe(
      "http://localhost:3100/api/issues/PAP-1/interactions/interaction-9/accept",
    );
    vi.restoreAllMocks();
  });

  it("substitutes a renamed key placeholder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await tool("paperclipListCaseDocumentRevisions").execute({ caseId: "case-1", documentKey: "plan" });
    expect(String((fetchMock.mock.calls[0] as [URL])[0])).toBe(
      "http://localhost:3100/api/cases/case-1/documents/plan/revisions",
    );
    vi.restoreAllMocks();
  });
});
