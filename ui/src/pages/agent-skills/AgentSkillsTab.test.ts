// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@tickernelz/paperclip-pro-shared";
import { queryKeys } from "../../lib/queryKeys";
import { AgentSkillsTab } from "./AgentSkillsTab";
import { TooltipProvider } from "../../components/ui/tooltip";

vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: unknown }) => children }));
vi.mock("./AgentSkillRow", () => ({ AgentSkillRow: ({ variant, data, checked, onCheckedChange }: { variant: string; data: { key: string }; checked?: boolean; onCheckedChange?: (next: boolean) => void }) =>
  createElement("button", {
    "data-skill": data.key,
    "data-variant": variant,
    "data-checked": String(Boolean(checked)),
    onClick: () => onCheckedChange?.(!checked),
  }) }));
import { toDesiredSkillPayload } from "./AgentSkillsTab";

describe("toDesiredSkillPayload", () => {
  const skillKey = "paperclipai/paperclip/paperclip";
  const versionId = "22222222-2222-4222-8222-222222222222";

  it("includes saved version pins while beta skills are enabled", () => {
    expect(toDesiredSkillPayload([skillKey], { [skillKey]: versionId })).toEqual([
      { key: skillKey, versionId },
    ]);
  });

  it("preserves a saved version pin on an unrelated skill autosave", () => {
    expect(toDesiredSkillPayload([skillKey], { [skillKey]: versionId })).toEqual([
      { key: skillKey, versionId },
    ]);
  });

  it("drops the pin from the payload only when the key is no longer assigned", () => {
    expect(toDesiredSkillPayload(["other/skill"], { [skillKey]: versionId })).toEqual([
      "other/skill",
    ]);
  });
});

const syncSkillsMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ desiredSkills: [] as string[] })));

it("keeps a beta pin in the autosave payload while the flag is off", async () => {
  const syncSkills = syncSkillsMock;
  syncSkills.mockClear();
  vi.doMock("../../api/agents", () => ({ agentsApi: { syncSkills } }));
  vi.resetModules();
  const { AgentSkillsTab: Tab } = await import("./AgentSkillsTab");
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const agent = { id: "agent-1", companyId: "company-1", adapterType: "codex_local", adapterConfig: {} } as Agent;
  const pinnedKey = "paperclipai/paperclip/paperclip";
  const versionId = "22222222-2222-4222-8222-222222222222";
  const base = { adapterType: "codex_local", supported: true, mode: "ephemeral", desiredSkills: [], entries: [], warnings: [] };
  client.setQueryData(queryKeys.agents.skills(agent.id), {
    ...base,
    desiredSkills: [pinnedKey],
    desiredSkillEntries: [{ key: pinnedKey, versionId }],
  });
  client.setQueryData(queryKeys.companySkills.list(agent.companyId), [
    { id: "skill-1", key: pinnedKey, name: "paperclip", categories: [], sourceKind: "bundled", sourceType: "bundled" },
    { id: "skill-2", key: "other/skill", name: "other", categories: [], sourceKind: "bundled", sourceType: "bundled" },
  ]);
  client.setQueryData(queryKeys.instance.experimentalSettings, { enableBetaSkills: false });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, { children: createElement(Tab, { agent, companyId: agent.companyId }) }))));
    const row = await vi.waitFor(() => {
      const found = container.querySelector(`[data-skill="other/skill"]`);
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    row.click();
    await vi.waitFor(() => {
      expect(syncSkills).toHaveBeenCalled();
    });
    const payload = syncSkills.mock.calls[0]?.[1];
    expect(JSON.stringify(payload)).toContain(versionId);
  } finally {
    flushSync(() => root.unmount());
    client.clear();
    container.remove();
  }
});


it("removes a connector from editable library rows when its automatic assignment arrives", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const agent = { id: "agent-1", companyId: "company-1", adapterType: "codex_local", adapterConfig: {} } as Agent;
  const key = "paperclipai/paperclip/agentmail";
  const snapshot = { adapterType: "codex_local", supported: true, mode: "ephemeral", desiredSkills: [], entries: [], warnings: [] };
  client.setQueryData(queryKeys.agents.skills(agent.id), snapshot);
  client.setQueryData(queryKeys.companySkills.list(agent.companyId), [{ id: "skill-1", key, name: "agentmail", categories: [], sourceKind: "bundled", sourceType: "bundled" }]);
  client.setQueryData(queryKeys.instance.experimentalSettings, { enableBetaSkills: false });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, { children: createElement(AgentSkillsTab, { agent, companyId: agent.companyId }) }))));
    expect(container.querySelector(`[data-skill="${key}"][data-variant="available"]`)).not.toBeNull();
    client.setQueryData(queryKeys.agents.skills(agent.id), { ...snapshot, desiredSkills: [key], entries: [{ key, runtimeName: "agentmail", desired: true, managed: true, readOnly: true, state: "configured" }] });
    await vi.waitFor(() => {
      expect(container.querySelector(`[data-skill="${key}"][data-variant="available"]`)).toBeNull();
      expect(container.querySelector(`[data-skill="${key}"][data-variant="enabled"]`)).toBeNull();
      expect(container.textContent).toContain("Automatic and detected skills");
    });
  } finally {
    flushSync(() => root.unmount());
    client.clear();
    container.remove();
  }
});
