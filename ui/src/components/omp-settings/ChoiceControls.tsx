import type { ReactNode } from "react";
import { RotateCcw, X } from "lucide-react";
import {
  OMP_LIMIT_CHOICES,
  OMP_STYLE_PRESETS,
  OMP_THINKING_CHOICES,
  OMP_TOOLS_CHOICES,
  ompChoicePatch,
  readOmpChoices,
  type AgentSettingsPatch,
  type OmpChoiceModel,
  type OmpControlId,
} from "@tickernelz/paperclip-pro-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export function ChoiceRow({
  label,
  sub,
  changed,
  onReset,
  children,
}: {
  label: string;
  sub: ReactNode;
  changed?: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-changed={changed ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3 border-t border-line px-4 py-3 first:border-t-0 sm:px-5 lg:flex-row lg:items-start lg:justify-between lg:gap-6",
        changed && "bg-accent-soft",
      )}
    >
      <div className="min-w-0 space-y-1 lg:w-56 lg:shrink-0">
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-sm text-ink-3">{sub}</p>
        {changed ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary">Changed from default</Badge>
            {onReset ? (
              <Button type="button" variant="link" size="xs" onClick={onReset}>
                <RotateCcw aria-hidden="true" />
                Reset
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 lg:max-w-xl">{children}</div>
    </div>
  );
}

function groupByProvider(models: readonly OmpChoiceModel[]): Array<[string, OmpChoiceModel[]]> {
  const groups = new Map<string, OmpChoiceModel[]>();
  for (const model of models) {
    const provider = model.provider ?? model.id.split("/")[0] ?? "";
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function ModelSelect({
  value,
  models,
  onChange,
  label,
  placeholder = "OMP default",
  exclude = [],
}: {
  value: string;
  models: readonly OmpChoiceModel[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  exclude?: readonly string[];
}) {
  const known = models.some((model) => model.id === value);
  return (
    <NativeSelect aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-9">
      <option value="">{placeholder}</option>
      {value && !known ? <option value={value}>{value}</option> : null}
      {groupByProvider(models.filter((model) => !exclude.includes(model.id))).map(([provider, list]) => (
        <optgroup key={provider} label={provider}>
          {list.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label ?? model.id}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: ReadonlyArray<[T, string]>;
  value: string | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Segmented aria-label={label} className="flex-wrap">
      {options.map(([key, text]) => (
        <SegmentedItem key={key} selected={value === key} disabled={disabled} onClick={() => onChange(key)} className="min-h-7">
          {text}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}

export function ChoiceControl({
  control,
  config,
  models,
  onPatch,
  disabled,
}: {
  control: OmpControlId;
  config: Record<string, unknown>;
  models: readonly OmpChoiceModel[];
  onPatch: (patch: AgentSettingsPatch) => void;
  disabled?: boolean;
}) {
  const choices = readOmpChoices(config);
  const pick = (value: string, options?: { customBackups?: readonly string[] }) =>
    onPatch(ompChoicePatch(control, value, { config, models }, options));

  switch (control) {
    case "style":
      return (
        <div role="radiogroup" aria-label="Style" className="grid gap-2 sm:grid-cols-3">
          {(Object.entries(OMP_STYLE_PRESETS) as Array<[string, (typeof OMP_STYLE_PRESETS)[keyof typeof OMP_STYLE_PRESETS]]>).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={choices.style === key}
              disabled={disabled}
              onClick={() => pick(key)}
              className={cn(
                "flex min-h-11 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                choices.style === key ? "border-accent bg-bg-2 ring-1 ring-accent" : "border-line bg-bg-2 hover:bg-bg-3",
              )}
            >
              <span className="text-sm font-medium">{preset.label}</span>
              <span className="text-xs text-ink-3">{preset.description}</span>
            </button>
          ))}
        </div>
      );
    case "model":
      return (
        <ModelSelect
          label="Model"
          value={typeof config.model === "string" ? config.model : ""}
          models={models}
          onChange={(value) => {
            if (value) pick(value);
            else onPatch({ model: undefined, smolModel: undefined, slowModel: undefined, planModel: undefined });
          }}
        />
      );
    case "thinking":
      return (
        <Seg
          label="Thinking"
          disabled={disabled}
          value={choices.thinking}
          options={Object.entries(OMP_THINKING_CHOICES).map(([key, choice]) => [key, choice.label] as [string, string])}
          onChange={(value) => pick(value)}
        />
      );
    case "backup": {
      const list = Array.isArray(config.fallbackModels) ? (config.fallbackModels as string[]) : [];
      const primary = typeof config.model === "string" ? config.model : "";
      return (
        <div className="space-y-2">
          <Seg
            label="Backup models"
            disabled={disabled || !primary}
            value={choices.backup}
            options={[["automatic", "Automatic"], ["custom", "Custom list"]]}
            onChange={(value) => pick(value, { customBackups: list })}
          />
          {!primary ? <p className="text-xs text-ink-3">Pick a model first.</p> : null}
          {choices.backup === "automatic" ? (
            <p className="text-xs text-ink-3">
              {list.length > 0
                ? `Next model of the same tier from another provider: ${list.map((id) => models.find((model) => model.id === id)?.label ?? id).join(", then ")}.`
                : "No other provider OMP lists has a model of this tier."}
            </p>
          ) : null}
          {choices.backup === "custom" ? (
            <div className="space-y-2">
              {list.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {list.map((id) => (
                    <li key={id} className="inline-flex items-center gap-1 rounded-md border border-line bg-bg-2 py-0.5 pl-2 pr-0.5 text-xs">
                      {models.find((model) => model.id === id)?.label ?? id}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${id}`}
                        onClick={() => pick("custom", { customBackups: list.filter((entry) => entry !== id) })}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ModelSelect
                label="Add a backup model"
                placeholder="Add a backup model"
                value=""
                models={models}
                exclude={[primary, ...list]}
                onChange={(value) => value && pick("custom", { customBackups: [...list, value] })}
              />
            </div>
          ) : null}
        </div>
      );
    }
    case "tools":
      return (
        <div className="space-y-1">
          <Seg
            label="Tools"
            disabled={disabled}
            value={choices.tools}
            options={Object.entries(OMP_TOOLS_CHOICES).map(([key, choice]) => [key, choice.label] as [string, string])}
            onChange={(value) => pick(value)}
          />
          <p className="text-xs text-ink-3">
            {choices.tools ? OMP_TOOLS_CHOICES[choices.tools as keyof typeof OMP_TOOLS_CHOICES].description : "Set in All settings."}
          </p>
        </div>
      );
    case "limit":
      return (
        <NativeSelect
          aria-label="Stop a run after"
          disabled={disabled}
          value={choices.limit ?? ""}
          onChange={(event) => (event.target.value ? pick(event.target.value) : onPatch({ maxTime: undefined, timeoutSec: undefined }))}
          className="min-h-9"
        >
          <option value="">OMP default (12 hours)</option>
          {Object.entries(OMP_LIMIT_CHOICES).map(([key, choice]) => (
            <option key={key} value={key}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      );
  }
}

export function SaveBar({
  summary,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  summary: ReactNode;
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-lg border border-line-strong bg-bg-2 px-4 py-3 shadow-lg sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1 text-sm">
        {summary}
        {error ? <p className="pt-1 text-sm text-bad">{error}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={onSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
