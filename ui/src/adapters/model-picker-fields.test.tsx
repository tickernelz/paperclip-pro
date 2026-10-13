// @vitest-environment jsdom
import { act, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComboboxField, effortLevelsFor, keepsEffort, ModelListField, OMP_EFFORT_LEVELS } from "./model-picker-fields";

const OPTIONS = [
  { value: "sub2api-claude/claude-opus-5-5", label: "Claude Opus 5.5 (sub2api) (sub2api-claude/claude-opus-5-5)", group: "sub2api-claude", name: "Claude Opus 5.5 (sub2api)", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { value: "sub2api-claude-kaitech/claude-opus-5-5", label: "Claude Opus 5.5 (sub2api-kaitech) (sub2api-claude-kaitech/claude-opus-5-5)", group: "sub2api-claude-kaitech", name: "Claude Opus 5.5 (sub2api-kaitech)", efforts: ["low", "medium", "high"] },
  { value: "openrouter/openai/gpt-6", label: "GPT-6 (openrouter/openai/gpt-6)", group: "openrouter", name: "GPT-6" },
];

let root: Root;
let container: HTMLDivElement;
const flushBeforeDocumentListeners = () => flushSync(() => {});

function commitFocusUpdatesBeforeDocumentListenersLikeABrowser() {
  document.body.addEventListener("focusin", flushBeforeDocumentListeners);
}

function stopCommittingFocusUpdatesEarly() {
  document.body.removeEventListener("focusin", flushBeforeDocumentListeners);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  commitFocusUpdatesBeforeDocumentListenersLikeABrowser();
});

afterEach(async () => {
  stopCommittingFocusUpdatesEarly();
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const OPUS = "sub2api-claude/claude-opus-5-5";
const OPUS_KAITECH = "sub2api-claude-kaitech/claude-opus-5-5";
const GPT = "openrouter/openai/gpt-6";

function Single({ initial = "", onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div data-testid="field">
      <ComboboxField
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        label="Small/fast model"
        testId="model"
      />
    </div>
  );
}

function List({ initial = [], primary = null }: { initial?: string[]; primary?: string | null }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <ModelListField
      value={value}
      options={OPTIONS}
      maxItems={5}
      primary={primary}
      onChange={setValue}
      label="Fallback models"
      testId="list"
    />
  );
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
const listbox = () => $('[role="listbox"]');
const optionTexts = () => Array.from(document.body.querySelectorAll('[role="option"]')).map((node) => node.textContent ?? "");
const items = () => Array.from(document.body.querySelectorAll('[data-testid="list-item"]')).map((node) => node.textContent ?? "");

const settle = () => act(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => setTimeout(resolve, 200));
});

describe("ComboboxField", () => {
  it("keeps the option list open after a click on the field", async () => {
    const user = userEvent.setup();
    await act(async () => root.render(<Single />));
    const control = container.querySelector<HTMLElement>('[data-testid="field"] input, [data-testid="field"] [role="combobox"]')!;
    await act(async () => { await user.click(control); });
    await settle();
    expect(document.body.textContent).toContain("GPT-6");
    expect(listbox()).not.toBeNull();
    expect(document.activeElement).toBe($('[data-testid="model-search"]'));
  });

  it("shows a short empty label instead of help text", async () => {
    await act(async () => root.render(<Single />));
    expect($('[data-testid="model-value"]')?.textContent).toBe("Not set");
    expect($('[data-testid="model-clear"]')).toBeNull();
  });

  it("filters by display name and by provider", async () => {
    const user = userEvent.setup();
    await act(async () => root.render(<Single />));
    await act(async () => { await user.click($('[data-testid="model-trigger"]')!); });
    await act(async () => { await user.keyboard("kaitech"); });
    expect(optionTexts()).toEqual([`Claude Opus 5.5${OPUS_KAITECH}`, "Use kaitech"]);
    await act(async () => { await user.clear($('[data-testid="model-search"]')!); await user.keyboard("gpt"); });
    expect(optionTexts()).toEqual([`GPT-6${GPT}`, "Use gpt"]);
    expect($('[data-testid="model-group-openrouter"]')?.textContent).toBe("openrouter");
    await act(async () => { await user.clear($('[data-testid="model-search"]')!); await user.keyboard("sub2api-claude"); });
    expect(optionTexts()).toEqual([`Claude Opus 5.5${OPUS}`, `Claude Opus 5.5${OPUS_KAITECH}`, "Use sub2api-claude"]);
  });

  it("closes on select and shows the name with its provider once", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    await act(async () => root.render(<Single onValue={onValue} />));
    await act(async () => { await user.click($('[data-testid="model-trigger"]')!); });
    await act(async () => { await user.click($(`[data-testid="model-option"][data-value="${OPUS_KAITECH}"]`)!); });
    await settle();
    expect(onValue).toHaveBeenCalledWith(OPUS_KAITECH);
    expect(listbox()).toBeNull();
    expect($('[data-testid="model-value"]')?.textContent).toBe("Claude Opus 5.5");
    expect($('[data-testid="model-value-provider"]')?.textContent).toBe("sub2api-claude-kaitech");
    expect($('[data-testid="model-trigger"]')?.getAttribute("title")).toBe(OPUS_KAITECH);
    expect($('[data-testid="model-trigger"]')?.textContent).not.toContain("(sub2api");
  });

  it("works from the keyboard and closes on Escape and outside clicks", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    await act(async () => root.render(<Single onValue={onValue} />));
    await act(async () => { $<HTMLButtonElement>('[data-testid="model-trigger"]')!.focus(); });
    await act(async () => { await user.keyboard("{ArrowDown}"); });
    expect(listbox()).not.toBeNull();
    await act(async () => { await user.keyboard("{Escape}"); });
    await settle();
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe($('[data-testid="model-trigger"]'));

    await act(async () => { await user.keyboard("o"); });
    expect($<HTMLInputElement>('[data-testid="model-search"]')?.value).toBe("o");
    await act(async () => { await user.keyboard("{ArrowDown}{Enter}"); });
    await settle();
    expect(onValue).toHaveBeenLastCalledWith(OPUS_KAITECH);
    expect(listbox()).toBeNull();

    await act(async () => { await user.click($('[data-testid="model-trigger"]')!); });
    expect(listbox()).not.toBeNull();
    await act(async () => { await user.click(document.body); });
    await settle();
    expect(listbox()).toBeNull();
  });

  it("toggles closed when the field is clicked again", async () => {
    const user = userEvent.setup();
    await act(async () => root.render(<Single />));
    const trigger = $('[data-testid="model-trigger"]')!;
    await act(async () => { await user.click(trigger); });
    await settle();
    expect(listbox()).not.toBeNull();
    await act(async () => { await user.click(trigger); });
    await settle();
    expect(listbox()).toBeNull();
  });

  it("accepts a typed custom value and clears it", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    await act(async () => root.render(<Single onValue={onValue} />));
    await act(async () => { await user.click($('[data-testid="model-trigger"]')!); });
    await act(async () => { await user.keyboard("custom/xyz"); });
    expect(optionTexts()).toEqual(["Use custom/xyz"]);
    await act(async () => { await user.keyboard("{Enter}"); });
    await settle();
    expect(onValue).toHaveBeenLastCalledWith("custom/xyz");
    expect($('[data-testid="model-value"]')?.textContent).toBe("custom/xyz");
    await act(async () => { await user.click($('[data-testid="model-clear"]')!); });
    expect(onValue).toHaveBeenLastCalledWith("");
    expect($('[data-testid="model-value"]')?.textContent).toBe("Not set");
  });
});

describe("effort levels per model", () => {
  it("reads a listed model's own levels and gives a typed selector the full list", () => {
    expect(effortLevelsFor(OPUS, OPTIONS)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortLevelsFor(OPUS_KAITECH, OPTIONS)).toEqual(["low", "medium", "high"]);
    expect(effortLevelsFor(GPT, OPTIONS)).toEqual([]);
    expect(effortLevelsFor("typed/selector", OPTIONS)).toEqual(OMP_EFFORT_LEVELS);
  });

  it("drops an effort the target model does not accept, but keeps one it does", () => {
    expect(keepsEffort("xhigh", OPUS, OPTIONS)).toBe(true);
    expect(keepsEffort("xhigh", OPUS_KAITECH, OPTIONS)).toBe(false);
    expect(keepsEffort("xhigh", GPT, OPTIONS)).toBe(false);
    expect(keepsEffort("xhigh", "typed/selector", OPTIONS)).toBe(true);
    expect(keepsEffort(null, GPT, OPTIONS)).toBe(true);
  });
});

describe("ModelListField", () => {
  it("appends the picked model at once, with no separate Add button", async () => {
    const user = userEvent.setup();
    await act(async () => root.render(<List primary={OPUS} />));
    const buttons = () => Array.from(document.body.querySelectorAll("button")).map((node) => node.textContent?.trim());
    expect(buttons()).not.toContain("Add");
    await act(async () => { await user.click($('[data-testid="list-add"]')!); });
    expect($('[data-testid="list-add-search"]')?.getAttribute("placeholder")).toBe("Search models or paste an ID");
    expect($(`[data-testid="list-add-option"][data-value="${OPUS}"]`)?.textContent).toContain("Main model");
    await act(async () => { await user.click($(`[data-testid="list-add-option"][data-value="${OPUS_KAITECH}"]`)!); });
    await settle();
    expect(listbox()).toBeNull();
    expect(items()).toEqual([`1Claude Opus 5.5sub2api-claude-kaitech`]);
    expect(buttons()).not.toContain("Add");
  });

  it("shows each entry's provider once", async () => {
    await act(async () => root.render(<List initial={[OPUS, GPT]} />));
    const first = items()[0]!;
    expect(first.split("sub2api").length - 1).toBe(1);
    expect(first).toContain("Claude Opus 5.5");
    expect(items()[1]).toBe("2GPT-6openrouter");
  });

  it("disables adding at the limit with a reason", async () => {
    await act(async () => root.render(<List initial={["a/1", "b/2", "c/3", "d/4", "e/5"]} />));
    const add = $<HTMLButtonElement>('[data-testid="list-add"]')!;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toContain("Limit of 5 reached");
  });

  it("reorders and removes entries", async () => {
    const user = userEvent.setup();
    await act(async () => root.render(<List initial={[OPUS, GPT, "custom/x"]} />));
    await act(async () => { await user.click($('button[aria-label="Move custom/x up"]')!); });
    expect(items().map((item) => item.slice(1, 6))).toEqual(["Claud", "custo", "GPT-6"]);
    await act(async () => { await user.click($(`button[aria-label="Remove ${OPUS}"]`)!); });
    expect(items()).toEqual(["1custom/x", "2GPT-6openrouter"]);
  });
});
