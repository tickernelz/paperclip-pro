import { describe, expect, it } from "vitest";
import { RETIRED_ADAPTER_TYPES } from "@tickernelz/paperclip-pro-shared";
import { findServerAdapter, getServerAdapter } from "../adapters/index.js";
import { isRetiredAdapterModule } from "../adapters/retired.js";
import { evaluateAgentInvokability, type AgentOrgRow } from "../services/agent-invokability.js";

function legacyAgent(adapterType: string): AgentOrgRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    name: "Legacy",
    reportsTo: null,
    status: "idle",
    adapterType,
  };
}

describe("agents stored with a removed adapter type", () => {
  it.each(RETIRED_ADAPTER_TYPES)("keeps %s resolvable instead of falling back to the process adapter", (type) => {
    const adapter = findServerAdapter(type);
    expect(adapter?.type).toBe(type);
    expect(isRetiredAdapterModule(adapter)).toBe(true);
    expect(getServerAdapter(type)).toBe(adapter);
  });

  it("blocks a legacy agent from running and explains why in one sentence", () => {
    const agent = legacyAgent("claude_local");
    const result = evaluateAgentInvokability(agent, [agent]);
    expect(result).toMatchObject({
      invokable: false,
      reason: "adapter_retired",
      details: { adapterType: "claude_local" },
    });
    if (result.invokable) throw new Error("expected a blocked agent");
    expect(result.message.split(". ").length).toBe(1);
    expect(result.message).toContain("omp_local");
  });

  it("leaves an omp_local agent invokable", () => {
    const agent = legacyAgent("omp_local");
    expect(evaluateAgentInvokability(agent, [agent])).toEqual({ invokable: true });
  });

  it("fails a run on a removed adapter without touching any runtime", async () => {
    const logs: string[] = [];
    const result = await getServerAdapter("gemini_local").execute({
      runId: "run-1",
      agent: { id: "a", companyId: "c", name: "Legacy", adapterType: "gemini_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: {},
      context: {},
      onLog: async (_stream: string, chunk: string) => { logs.push(chunk); },
    } as unknown as Parameters<ReturnType<typeof getServerAdapter>["execute"]>[0]);
    expect(result).toMatchObject({ exitCode: 1, errorCode: "adapter_retired" });
    expect(logs.join("")).toContain("gemini_local");
  });
});
