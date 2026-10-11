// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterConfigSchema, CreateConfigValues } from "@tickernelz/paperclip-pro-adapter-utils";
import { SchemaConfigFields, buildSchemaAdapterConfig, invalidateConfigSchemaCache } from "./schema-config-fields";
import { TooltipProvider } from "../components/ui/tooltip";
import { defaultCreateValues } from "../components/agent-config-defaults";

const ADAPTER = "list-field-test";
const OPTIONS = [
  { value: "anthropic/opus", label: "Opus (anthropic/opus)", group: "anthropic", name: "Opus" },
  { value: "openai/gpt", label: "GPT (openai/gpt)", group: "openai", name: "GPT" },
  { value: "google/gemini", label: "Gemini (google/gemini)", group: "google", name: "Gemini" },
];
const SCHEMA: AdapterConfigSchema = {
  fields: [
    { key: "model", label: "Model", type: "combobox", options: OPTIONS, group: "Models" },
    {
      key: "fallbackModels",
      label: "Fallback models",
      type: "combobox_list",
      options: OPTIONS,
      group: "Models",
      meta: { maxItems: 5, distinctFromKey: "model" },
    },
  ],
};

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invalidateConfigSchemaCache(ADAPTER);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => SCHEMA })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function CreateHarness({ initial, onValues }: { initial: CreateConfigValues; onValues: (values: CreateConfigValues) => void }) {
  const [values, setValues] = useState(initial);
  return (
    <TooltipProvider>
      <SchemaConfigFields
        mode="create"
        isCreate
        adapterType={ADAPTER}
        hideModel
        values={values}
        set={(patch) => setValues((prev) => {
          const next = { ...prev, ...patch };
          onValues(next);
          return next;
        })}
        config={{}}
        eff={(_group, _field, original) => original}
        mark={vi.fn()}
        models={[]}
      />
    </TooltipProvider>
  );
}

function EditHarness({ config, onMark }: { config: Record<string, unknown>; onMark: (field: string, value: unknown) => void }) {
  const [overlay, setOverlay] = useState<Record<string, unknown>>({});
  return (
    <TooltipProvider>
      <SchemaConfigFields
        mode="edit"
        isCreate={false}
        adapterType={ADAPTER}
        hideModel
        values={null}
        set={null}
        config={config}
        eff={<T,>(_group: "adapterConfig", field: string, original: T): T => (field in overlay ? overlay[field] as T : original)}
        mark={(_group, field, value) => {
          onMark(field, value);
          setOverlay((prev) => ({ ...prev, [field]: value }));
        }}
        models={[]}
      />
    </TooltipProvider>
  );
}

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const items = () => Array.from(container.querySelectorAll('[data-testid="schema-config-list-fallbackModels-item"]'))
  .map((item) => item.textContent ?? "");

async function render(node: React.ReactNode) {
  await act(async () => root?.render(node));
  await act(async () => { await Promise.resolve(); });
}

async function pick(text: string) {
  const input = q<HTMLInputElement>('[data-testid="schema-config-list-fallbackModels-picker"] input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => {
    q<HTMLButtonElement>('[data-testid="schema-config-list-fallbackModels-add"]')!.click();
  });
}

async function clickLabel(label: string) {
  await act(async () => {
    q<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  });
}

describe("combobox_list schema field", () => {
  it("adds entries in create mode and emits the ordered array in the built adapter config", async () => {
    const onValues = vi.fn();
    await render(
      <CreateHarness initial={{ ...defaultCreateValues, model: "anthropic/opus", adapterSchemaValues: {} }} onValues={onValues} />,
    );
    expect(container.textContent).toContain("Fallback models");

    await pick("openai/gpt");
    await pick("custom/free-text");

    expect(items()).toHaveLength(2);
    expect(items()[0]).toContain("GPT");
    expect(items()[0]).toContain("openai");
    expect(items()[1]).toContain("custom/free-text");
    const last = onValues.mock.calls.at(-1)![0] as CreateConfigValues;
    expect(buildSchemaAdapterConfig(last).fallbackModels).toEqual(["openai/gpt", "custom/free-text"]);
  });

  it("reorders and removes entries in edit mode and clears the key when the list empties", async () => {
    const onMark = vi.fn();
    await render(
      <EditHarness
        config={{ model: "anthropic/opus", fallbackModels: ["openai/gpt", "google/gemini", "custom/x"] }}
        onMark={onMark}
      />,
    );
    expect(items()).toHaveLength(3);

    await clickLabel("Move custom/x up");
    expect(onMark).toHaveBeenLastCalledWith("fallbackModels", ["openai/gpt", "custom/x", "google/gemini"]);

    await clickLabel("Move openai/gpt down");
    expect(onMark).toHaveBeenLastCalledWith("fallbackModels", ["custom/x", "openai/gpt", "google/gemini"]);

    await clickLabel("Remove openai/gpt");
    expect(onMark).toHaveBeenLastCalledWith("fallbackModels", ["custom/x", "google/gemini"]);

    await clickLabel("Remove custom/x");
    await clickLabel("Remove google/gemini");
    expect(onMark).toHaveBeenLastCalledWith("fallbackModels", undefined);
    expect(items()).toHaveLength(0);
  });

  it("rejects a sixth entry, duplicates and the primary model without changing the value", async () => {
    const onMark = vi.fn();
    await render(
      <EditHarness
        config={{ model: "anthropic/opus", fallbackModels: ["openai/gpt"] }}
        onMark={onMark}
      />,
    );

    await pick("openai/gpt");
    expect(onMark).not.toHaveBeenCalled();
    expect(q('[data-testid="schema-config-list-fallbackModels-error"]')?.textContent).toContain("listed twice");

    await pick("anthropic/opus");
    expect(onMark).not.toHaveBeenCalled();
    expect(q('[data-testid="schema-config-list-fallbackModels-error"]')?.textContent).toContain("primary model");

    for (const entry of ["a/1", "b/2", "c/3", "d/4"]) await pick(entry);
    expect(items()).toHaveLength(5);
    onMark.mockClear();

    await pick("e/5");
    expect(q<HTMLButtonElement>('[data-testid="schema-config-list-fallbackModels-add"]')?.disabled).toBe(true);
    expect(onMark).not.toHaveBeenCalled();
    expect(items()).toHaveLength(5);
  });
});
