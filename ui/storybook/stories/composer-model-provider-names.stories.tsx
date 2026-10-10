import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { expect, userEvent, within } from "storybook/test";
import type { AgentAdapterConfigBatchPreview } from "@tickernelz/paperclip-pro-shared";
import {
  ComposerRunSettingsPicker,
  useComposerRunSettingsStaging,
} from "@/components/task-chat/ComposerRunSettingsPicker";
import { queryKeys } from "@/lib/queryKeys";

const catalog = [
  ["sub2api-claude", "claude-opus-5-5", "Claude Opus 5.5"],
  ["sub2api-claude", "claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["sub2api-claude", "claude-haiku-5", "Claude Haiku 5"],
  ["sub2api-claude-kaitech", "claude-opus-5-5", "Claude Opus 5.5"],
  ["sub2api-claude-kaitech", "claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["openrouter", "anthropic/claude-opus-5-5", "Anthropic: Claude Opus 5.5"],
  ["openrouter", "deepseek/deepseek-v4", "DeepSeek V4"],
].map(([provider, id, name]) => ({
  value: `${provider}/${id}`,
  label: `${name} (${provider}/${id})`,
  group: provider,
  name,
}));

const agents = [
  { agentId: "fajar", name: "Fajar", model: "sub2api-claude/claude-opus-5-5" },
  { agentId: "wira", name: "Wira", model: "sub2api-claude/claude-sonnet-5-5" },
];

function preview(agentIds: string[]): AgentAdapterConfigBatchPreview {
  return {
    fields: [
      { key: "model", label: "Model", hint: null, freeText: true, options: catalog },
      {
        key: "thinking",
        label: "Thinking",
        hint: null,
        freeText: false,
        options: ["off", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value })),
      },
    ],
    agents: agents
      .filter((agent) => agentIds.includes(agent.agentId))
      .map((agent) => ({
        agentId: agent.agentId,
        name: agent.name,
        adapterType: "omp_local",
        eligible: true,
        reason: null,
        current: { model: agent.model, thinking: "high" },
      })),
  };
}

const assigneeOptions = agents.map((agent) => ({ id: `agent:${agent.agentId}`, label: agent.name }));

function ProviderNamesHarness({ agentId, model }: { agentId: string; model?: string }) {
  const queryClient = useQueryClient();
  const [seeded] = useState(() => {
    queryClient.setQueryData(queryKeys.agents.adapterConfigBatch("__composer__", [agentId]), preview([agentId]));
    const roster = agents.map((agent) => agent.agentId);
    queryClient.setQueryData(queryKeys.agents.adapterConfigBatch("__composer__:roster", roster), preview(roster));
    return true;
  });
  const [assignee, setAssignee] = useState(`agent:${agentId}`);
  const staging = useComposerRunSettingsStaging();
  const { set } = staging;
  useEffect(() => {
    if (model) set("model", model);
  }, [model, set]);
  if (!seeded) return null;
  return (
    <div className="flex min-h-screen items-end justify-center bg-background p-8 text-foreground">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-3 shadow-sm">
        <p className="min-h-16 text-sm text-muted-foreground">Message {assignee.slice(6)}…</p>
        <div className="flex items-center justify-end">
          <ComposerRunSettingsPicker
            companyId="storybook"
            draft
            assigneeValue={assignee}
            currentAssigneeValue={assignee}
            options={assigneeOptions}
            staging={staging}
            onAssigneeChange={(value) => {
              setAssignee(value ?? `agent:${agentId}`);
              staging.clear();
            }}
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Composer/Model display names and providers",
  component: ProviderNamesHarness,
  parameters: { layout: "fullscreen" },
  args: { agentId: "fajar" },
} satisfies Meta<typeof ProviderNamesHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentDefault: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByTestId("task-chat-composer-assignee"));
    await expect(page.getByTestId("composer-run-settings-model-value")).toHaveTextContent("Claude Opus 5.5");
    await expect(page.getByTestId("composer-run-settings-model-value-provider")).toHaveTextContent("sub2api-claude");
  },
};

export const ModelList: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByTestId("task-chat-composer-assignee"));
    await userEvent.click(page.getByTestId("composer-run-settings-model-row"));
    await expect(page.getByTestId("composer-run-settings-model-group-sub2api-claude-kaitech")).toBeVisible();
  },
};

export const OtherProviderOverride: Story = {
  args: { model: "sub2api-claude-kaitech/claude-opus-5-5" },
};

export const CustomModelId: Story = {
  args: { model: "my-gateway/claude-opus-5-5" },
};
