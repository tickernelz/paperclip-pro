import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { AdapterConfigSchema } from "@tickernelz/paperclip-pro-adapter-utils";
import type { AdapterModel } from "@/api/agents";
import { ModelDropdown } from "@/components/AgentConfigForm";
import { SchemaConfigFields } from "@/adapters/schema-config-fields";

const ADAPTER = "omp_local_model_picker_story";

const MODELS: AdapterModel[] = [
  { id: "sub2api-claude/claude-opus-5-5", label: "Claude Opus 5.5 (sub2api)", provider: "sub2api-claude" },
  { id: "sub2api-claude/claude-opus-5", label: "Claude Opus 5 (sub2api)", provider: "sub2api-claude" },
  { id: "sub2api-claude/claude-sonnet-5-5", label: "Claude Sonnet 5.5 (sub2api)", provider: "sub2api-claude" },
  { id: "sub2api-claude/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (2025-10-01) (sub2api)", provider: "sub2api-claude" },
  { id: "sub2api-claude-kaitech/claude-opus-5-5", label: "Claude Opus 5.5 (sub2api-kaitech)", provider: "sub2api-claude-kaitech" },
  { id: "sub2api-claude-kaitech/claude-sonnet-5-5", label: "Claude Sonnet 5.5 (sub2api-kaitech)", provider: "sub2api-claude-kaitech" },
  { id: "openrouter/anthropic/claude-opus-5-5", label: "Anthropic: Claude Opus 5.5", provider: "openrouter" },
  { id: "openrouter/openai/gpt-6-sol", label: "OpenAI: GPT-6 Sol", provider: "openrouter" },
  { id: "openrouter/google/gemini-3.1-pro", label: "Google: Gemini 3.1 Pro (High)", provider: "openrouter" },
];

const OPTIONS = MODELS.map((model) => ({
  value: model.id,
  label: `${model.label} (${model.id})`,
  group: model.provider,
  name: model.label,
}));

const roleField = (key: string, label: string, hint: string) => ({
  key,
  label,
  type: "combobox" as const,
  options: OPTIONS,
  hint,
  group: "Models",
});

const SCHEMA: AdapterConfigSchema = {
  fields: [
    { key: "model", label: "Model", type: "combobox", options: OPTIONS, group: "Models" },
    {
      key: "fallbackModels",
      label: "Fallback models",
      type: "combobox_list",
      options: OPTIONS,
      hint: "Up to 5 models tried in order when the main model hits a rate limit, an upstream error or a refusal. Small, slow and planning models do not fall back.",
      group: "Models",
      meta: { maxItems: 5, distinctFromKey: "model" },
    },
    roleField("smolModel", "Small/fast model", "Optional selector passed to OMP --smol for cheap auxiliary work."),
    roleField("slowModel", "Slow/reasoning model", "Optional selector passed to OMP --slow for difficult auxiliary work."),
    roleField("planModel", "Planning model", "Optional selector passed to OMP --plan."),
    {
      key: "thinking",
      label: "OMP thinking override",
      type: "select",
      options: ["auto", "off", "low", "medium", "high"].map((value) => ({ value, label: value })),
      hint: "Full OMP thinking level.",
      group: "Models",
    },
    { key: "modelCycle", label: "Model cycle allowlist", type: "text", hint: "Optional comma-separated selectors.", group: "Models" },
  ],
};

if (typeof window !== "undefined") {
  const upstream = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(`/api/adapters/${ADAPTER}/config-schema`)) return Response.json(SCHEMA);
    return upstream(input, init);
  };
}

function ModelsSection({ fallbackModels }: { fallbackModels: string[] }) {
  const [model, setModel] = useState("sub2api-claude/claude-opus-5-5");
  const [open, setOpen] = useState(false);
  const [overlay, setOverlay] = useState<Record<string, unknown>>({
    model,
    fallbackModels,
    smolModel: "sub2api-claude/claude-haiku-4-5-20251001",
  });
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4 sm:p-6">
      <h3 className="text-sm font-semibold">Models</h3>
      <ModelDropdown
        models={MODELS}
        value={model}
        onChange={(next) => {
          setModel(next);
          setOverlay((current) => ({ ...current, model: next }));
        }}
        open={open}
        onOpenChange={setOpen}
        allowDefault={false}
        required
        groupByProvider={false}
        creatable
      />
      <SchemaConfigFields
        mode="edit"
        isCreate={false}
        adapterType={ADAPTER}
        hideModel
        values={null}
        set={null}
        config={overlay}
        eff={<T,>(_group: "adapterConfig", field: string, original: T): T =>
          (field in overlay ? (overlay[field] as T) : original)}
        mark={(_group, field, value) => setOverlay((current) => ({ ...current, [field]: value }))}
        models={MODELS}
      />
    </div>
  );
}

const meta = {
  title: "Agents/Model pickers",
  component: ModelsSection,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ModelsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoFallbacks: Story = {
  args: { fallbackModels: ["sub2api-claude-kaitech/claude-opus-5-5", "openrouter/openai/gpt-6-sol"] },
};

export const FallbackLimit: Story = {
  args: {
    fallbackModels: [
      "sub2api-claude-kaitech/claude-opus-5-5",
      "openrouter/openai/gpt-6-sol",
      "sub2api-claude/claude-sonnet-5-5",
      "openrouter/anthropic/claude-opus-5-5",
      "sub2api-claude-kaitech/claude-sonnet-5-5",
    ],
  },
};
