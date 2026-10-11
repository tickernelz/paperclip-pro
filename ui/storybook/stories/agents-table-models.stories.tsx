import { agentAvatarUrl } from "@/lib/agent-avatar-url";
import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { Route, Routes, useLocation, useNavigate } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { PluginLauncherProvider } from "@/plugins/launchers";
import { Layout } from "@/components/Layout";
import { Agents } from "@/pages/Agents";
import { queryKeys } from "@/lib/queryKeys";
import {
  AGENT_FALLBACK_MODELS_KEY,
  fitAgentFallbackModels,
  readAgentFallbackModels,
  resolveAgentAppearance,
  type Agent,
  type AgentAdapterConfigBatchPreview,
} from "@tickernelz/paperclip-pro-shared";
import { storybookAgents, storybookDashboardSummary } from "../fixtures/paperclipData";

const companyId = "company-storybook";

const ompCatalog = [
  { id: "sub2api-claude-kaitech/claude-opus-5-5", label: "Claude Opus 5.5", provider: "kaitech" },
  { id: "sub2api-claude/claude-opus-5-5", label: "Claude Opus 5.5", provider: "sub2api" },
  { id: "sub2api-claude/claude-sonnet-5", label: "Claude Sonnet 5", provider: "sub2api" },
  { id: "sub2api-claude/claude-haiku-5", label: "Claude Haiku 5", provider: "sub2api" },
  { id: "openai/gpt-5.5", label: "GPT-5.5", provider: "openai" },
  { id: "openai/gpt-5.5-mini", label: "GPT-5.5 mini", provider: "openai" },
  { id: "openrouter/google/gemini-3-pro", label: "Gemini 3 Pro", provider: "openrouter" },
  { id: "openrouter/google/gemini-3-flash", label: "Gemini 3 Flash", provider: "openrouter" },
  { id: "zai/glm-5", label: "GLM 5", provider: "zai" },
  { id: "dashscope/qwen3-coder-plus", label: "Qwen3 Coder Plus", provider: "dashscope" },
];
const codexCatalog = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
];
const options = ompCatalog.map((model) => ({
  value: model.id,
  label: `${model.label} (${model.id})`,
  group: model.provider,
  name: model.label,
}));
const efforts = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

const [opusKaitech, opus, sonnet, haiku, gpt, gptMini, geminiPro, geminiFlash, glm, qwen] = ompCatalog.map((model) => model.id);

const roster: Array<[string, string, string, Record<string, unknown>]> = [
  ["Atlas", "ceo", "Chief Executive", { model: opusKaitech, fallbackModels: [opus, gpt, geminiPro], thinking: "high" }],
  ["Beacon", "cto", "Chief Technology Officer", { model: opus, fallbackModels: [opusKaitech], thinking: "xhigh" }],
  ["Cinder", "engineer", "Backend Engineer", { model: sonnet, fallbackModels: [gpt, glm], thinking: "medium" }],
  ["Dahlia", "engineer", "Frontend Engineer", { model: gpt, thinking: "high" }],
  ["Ember", "qa", "QA Engineer", { model: haiku, fallbackModels: [gptMini], thinking: "low" }],
  ["Fable", "designer", "Product Designer", { model: geminiPro }],
  ["Garnet", "engineer", "Platform Engineer", { model: opusKaitech, fallbackModels: [opus, sonnet, gpt, geminiPro, glm], thinking: "max" }],
  ["Harbor", "devops", "Release Captain", { model: glm, fallbackModels: [qwen], thinking: "auto" }],
  ["Iris", "researcher", "Research Analyst", { model: geminiFlash, thinking: "minimal" }],
  ["Juniper", "pm", "Product Manager", { model: sonnet, fallbackModels: [opus], thinking: "medium" }],
  ["Kestrel", "engineer", "Data Engineer", { model: qwen, fallbackModels: [glm, gptMini] }],
  ["Lumen", "general", "Support Lead", {}],
  ["Marlow", "cmo", "Growth Lead", { model: gptMini, thinking: "off" }],
  ["Nimbus", "engineer", "Mobile Engineer", { model: "custom-gateway/kimi-k3", fallbackModels: [sonnet], thinking: "high" }],
  ["Onyx", "security", "Security Reviewer", { model: opus, fallbackModels: [opusKaitech, gpt], thinking: "xhigh" }],
];

const base = storybookAgents[0]!;
const agents: Agent[] = [
  ...roster.map(([name, role, title, adapterConfig], index) => ({
    ...base,
    id: `agent-table-${index + 1}`,
    name,
    urlKey: name.toLowerCase(),
    role,
    title,
    status: index % 5 === 1 ? "running" : index === 11 ? "paused" : "idle",
    pausedAt: null,
    reportsTo: null,
    adapterType: "omp_local",
    adapterConfig,
    lastHeartbeatAt: new Date(Date.now() - (index + 1) * 37 * 60_000),
  })),
  {
    ...base,
    id: "agent-table-codex",
    name: "Quill",
    urlKey: "quill",
    role: "engineer",
    title: "Codex Reviewer",
    status: "idle",
    reportsTo: null,
    adapterType: "codex_local",
    adapterConfig: { model: "gpt-5.4" },
    lastHeartbeatAt: new Date(Date.now() - 5 * 60_000),
  },
].map((agent) => {
  const appearance = resolveAgentAppearance(agent.appearance, agent.id);
  return { ...agent, appearance, avatarUrl: agentAvatarUrl(appearance) } as Agent;
});

function preview(agentIds: string[]): AgentAdapterConfigBatchPreview {
  const targets = agents.filter((agent) => agentIds.includes(agent.id));
  const omp = targets.every((agent) => agent.adapterType === "omp_local");
  return {
    fields: omp
      ? [
          { key: "model", label: "Model", hint: null, freeText: true, options },
          { key: AGENT_FALLBACK_MODELS_KEY, label: "Fallback models", hint: null, freeText: true, options, list: { maxItems: 5, distinctFromKey: "model" } },
          { key: "thinking", label: "OMP thinking override", hint: null, freeText: false, options: efforts.map((value) => ({ value, label: value })) },
        ]
      : [],
    agents: targets.map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      adapterType: agent.adapterType,
      eligible: omp,
      reason: omp ? null : `Adapter "${agent.adapterType}" exposes no batch-editable model setting.`,
      current: {},
    })),
  };
}

function applyBatch(agentIds: string[], values: Record<string, string | string[] | null>) {
  const results = [];
  for (const agent of agents.filter((entry) => agentIds.includes(entry.id))) {
    const config = { ...(agent.adapterConfig as Record<string, unknown>) };
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete config[key];
      else config[key] = value;
    }
    const fitted = fitAgentFallbackModels(readAgentFallbackModels(config[AGENT_FALLBACK_MODELS_KEY]), config.model as string | undefined);
    if (fitted.list.length > 0) config[AGENT_FALLBACK_MODELS_KEY] = fitted.list;
    else delete config[AGENT_FALLBACK_MODELS_KEY];
    agent.adapterConfig = config;
    results.push({ agentId: agent.id, name: agent.name, status: "updated", changedKeys: Object.keys(values) });
  }
  return { updated: results.length, unchanged: 0, results };
}

function installTableFixtures() {
  const previous = window.fetch;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    const path = url.pathname;
    if (!path.startsWith("/api/") || path.startsWith("/api/agent-avatars/")) return previous(input, init);
    const json = (data: unknown) => Response.json(data);
    const body = () => JSON.parse(String(init?.body ?? "{}"));
    if (path === "/api/agents/batch/adapter-config/preview") return json(preview(body().agentIds));
    if (path === "/api/agents/batch/adapter-config") {
      const { agentIds, values } = body();
      await new Promise((resolve) => setTimeout(resolve, 700));
      return json(applyBatch(agentIds, values));
    }
    if (path === `/api/companies/${companyId}/adapters/omp_local/models`) return json(ompCatalog);
    if (path === `/api/companies/${companyId}/adapters/codex_local/models`) return json(codexCatalog);
    if (path === "/api/cli-auth/me") return json({ source: "local_implicit", isInstanceAdmin: true, companyIds: [companyId], memberships: [] });
    if (path === "/api/health") return json({ status: "ok", deploymentMode: "local_trusted", authReady: true, bootstrapStatus: "ready" });
    if (path === "/api/instance/settings") return json({ experimental: {} });
    if (path === "/api/instance/settings/experimental") {
      const settings = await (await previous(input, init)).json();
      return json({ ...settings, enableAgentChat: true });
    }
    if (path.endsWith("/resource-memberships/me")) return json({ projectMemberships: {}, agentMemberships: {}, starredProjectIds: [], starredAgentIds: [], starredDocumentIds: [], projectStarredAt: {}, agentStarredAt: {}, documentStarredAt: {}, updatedAt: null });
    if (path === `/api/companies/${companyId}/agents`) return json(agents);
    if (path === `/api/companies/${companyId}/live-runs`) return json([]);
    if (path.endsWith("/dashboard")) return json(storybookDashboardSummary);
    if (path.endsWith("/budgets/overview")) return json({ companyId, policies: [], activeIncidents: [], pausedAgentCount: 0, pausedProjectCount: 0, pendingApprovalCount: 0 });
    if (path === "/api/companies" || path.startsWith("/api/auth/") || path.includes("/adapters") || path.includes("/environments") || path.endsWith("/issues") || path.endsWith("/projects") || path.endsWith("/approvals") || path.endsWith("/sidebar-badges") || path.endsWith("/user-directory")) return previous(input, init);
    if (path.includes("/settings")) return json({});
    return json([]);
  };
  return () => { window.fetch = previous; };
}

function AgentsTablePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  useEffect(() => installTableFixtures(), []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    queryClient.setQueryData(queryKeys.agents.list(companyId), agents);
    setSelectedCompanyId(companyId);
    navigate("/PAP/agents/all", { replace: true });
    setReady(true);
  }, [navigate, queryClient, setSelectedCompanyId]);
  if (!ready || selectedCompanyId !== companyId || location.pathname === "/PAP/storybook") return null;
  return (
    <PluginLauncherProvider>
      <Routes>
        <Route path="/:companyPrefix" element={<Layout />}>
          <Route path="agents/all" element={<Agents />} />
        </Route>
      </Routes>
    </PluginLauncherProvider>
  );
}

const meta = {
  title: "Agents/Table/Inline models",
  parameters: { layout: "fullscreen", a11y: { test: "off" } },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** Sixteen agents with mixed providers, fallbacks and one Codex agent; every model cell edits in place. */
export const InlineModelEditing: Story = { render: () => <AgentsTablePage /> };
