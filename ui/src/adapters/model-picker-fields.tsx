import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { validateAgentFallbackModels, type IssueRunModelOverrideOption } from "@tickernelz/paperclip-pro-shared";
import { ArrowDown, ArrowUp, Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Button } from "../components/ui/button";
import { cn } from "@/lib/utils";
import type { AdapterModel } from "@/api/agents";
import { extractModelName, extractProviderId } from "@/lib/model-utils";
import {
  describeModelValue,
  groupModelOptions,
  ModelOptionGroupHeader,
  ModelOptionText,
  modelOptionMatches,
  ModelValueLabel,
} from "../components/task-chat/model-option-display";

type PickerOption = IssueRunModelOverrideOption;

/** Search box placeholder for model pickers. */
export const MODEL_SEARCH_PLACEHOLDER = "Search models or paste an ID";
const VALUE_SEARCH_PLACEHOLDER = "Search or type a value";

const triggerClass =
  "flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent";

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Maps an adapter catalog model onto a picker option, optionally grouping by the id's provider prefix and carrying its efforts. */
export function modelPickerOption(model: AdapterModel, groupByProvider: boolean): PickerOption {
  const provider = model.provider ?? (groupByProvider ? extractProviderId(model.id) : null);
  const name = model.label !== model.id ? model.label : groupByProvider ? extractModelName(model.id) : null;
  return {
    value: model.id,
    label: model.label,
    ...(provider ? { group: provider } : {}),
    ...(name ? { name } : {}),
    ...(model.thinking?.length ? { efforts: model.thinking } : {}),
  };
}

/** Searchable, provider-grouped option list shared by the model pickers. */
export function OptionSearchList({
  options,
  selected,
  query,
  onQueryChange,
  onSelect,
  searchPlaceholder,
  label,
  note,
  testId,
}: {
  options: readonly PickerOption[];
  selected: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (value: string) => void;
  searchPlaceholder: string;
  label: string;
  note?: (value: string) => string | null;
  testId: string;
}) {
  const listId = useId();
  const trimmed = query.trim();
  const sections = groupModelOptions(options.filter((option) => modelOptionMatches(option, trimmed)));
  const listed = sections.flatMap((section) => section.options.map((option) => option.value));
  const custom = trimmed && !options.some((option) => option.value === trimmed) ? trimmed : null;
  const choices = custom ? [...listed, custom] : listed;
  const [active, setActive] = useState(() => Math.max(0, selected ? choices.indexOf(selected) : 0));
  const activeIndex = choices.length === 0 ? -1 : Math.min(active, choices.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (choices.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + choices.length) % choices.length);
    } else if (event.key === "Home" || event.key === "End") {
      if (choices.length === 0) return;
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : choices.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = choices[activeIndex];
      if (choice !== undefined) onSelect(choice);
    }
  };

  const optionRow = (value: string, index: number, body: ReactNode) => (
    <div
      key={value}
      id={optionId(index)}
      role="option"
      aria-selected={value === selected}
      data-active={index === activeIndex ? "true" : undefined}
      data-testid={`${testId}-option`}
      data-value={value}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (index !== activeIndex) setActive(index);
      }}
      onClick={() => onSelect(value)}
      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[active=true]:bg-accent"
    >
      {body}
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={`Search ${label}`}
          autoComplete="off"
          spellCheck={false}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full bg-transparent pl-8 pr-2.5 text-sm outline-none placeholder:text-muted-foreground"
          data-testid={`${testId}-search`}
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        className="max-h-72 overflow-y-auto overscroll-contain p-1"
        data-testid={`${testId}-listbox`}
      >
        {sections.map((section) => (
          <div key={section.provider ?? ""} role="group" aria-label={section.provider ?? undefined}>
            {section.provider ? (
              <ModelOptionGroupHeader provider={section.provider} testId={`${testId}-group-${section.provider}`} />
            ) : null}
            {section.options.map((option) => {
              const index = choices.indexOf(option.value);
              const reason = note?.(option.value) ?? null;
              return optionRow(
                option.value,
                index,
                <>
                  <ModelOptionText option={option} />
                  {reason ? <span className="shrink-0 text-xs text-muted-foreground">{reason}</span> : null}
                  {option.value === selected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                </>,
              );
            })}
          </div>
        ))}
        {custom
          ? optionRow(
              custom,
              choices.length - 1,
              <>
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  Use <span className="font-mono text-xs">{custom}</span>
                </span>
                {note?.(custom) ? <span className="shrink-0 text-xs text-muted-foreground">{note(custom)}</span> : null}
              </>,
            )
          : null}
        {choices.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {options.length === 0 ? "No options yet. Type a value to use it." : "No match."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Select-style picker over provider-grouped options that also accepts a typed value. */
export function ComboboxField({
  value,
  options,
  onChange,
  label,
  emptyLabel = "Not set",
  searchPlaceholder = VALUE_SEARCH_PLACEHOLDER,
  clearable = true,
  disablePortal,
  testId = "combobox-field",
  effort,
}: {
  value: string;
  options: readonly PickerOption[];
  onChange: (value: string) => void;
  label: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  clearable?: boolean;
  disablePortal?: boolean;
  testId?: string;
  /** When set, the trigger shows "model · effort" and the popover leads with the model's effort chips. */
  effort?: { value: string | null; onChange: (effort: string | null) => void; defaultLabel?: string };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listed = options.some((option) => option.value === value);
  const display = value || listed ? describeModelValue(value, options) : null;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  return (
    <div className="relative min-w-0" data-testid={testId}>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            title={value || undefined}
            className={triggerClass}
            onKeyDown={(event) => {
              if (open) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                changeOpen(true);
              } else if (isPrintableKey(event)) {
                event.preventDefault();
                setQuery(event.key);
                setOpen(true);
              }
            }}
            data-testid={`${testId}-trigger`}
          >
            {display ? (
              <ModelValueLabel display={display} layout="inline" className="min-w-0 flex-1" testId={`${testId}-value`} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground" data-testid={`${testId}-value`}>
                {emptyLabel}
              </span>
            )}
            {effort && value && showsEffortControl(effort.value, value, options) ? (
              <span
                className={cn("shrink-0 text-xs", effort.value ? "text-foreground" : "text-muted-foreground")}
                data-testid={`${testId}-effort-value`}
              >
                · {effort.value ?? effort.defaultLabel ?? "Default effort"}
              </span>
            ) : null}
            {clearable && value ? <span className="w-5 shrink-0" aria-hidden="true" /> : null}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          disablePortal={disablePortal}
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        >
          {effort && value && showsEffortControl(effort.value, value, options) ? (
            <EffortHeader>
              <EffortChips
                levels={effortLevelsFor(value, options)}
                value={effort.value}
                onChange={effort.onChange}
                defaultLabel={effort.defaultLabel ?? "Default"}
                label={`Thinking effort for ${label}`}
                testId={`${testId}-effort`}
              />
            </EffortHeader>
          ) : null}
          <OptionSearchList
            options={options}
            selected={value || null}
            query={query}
            onQueryChange={setQuery}
            onSelect={(next) => {
              onChange(next);
              changeOpen(false);
            }}
            searchPlaceholder={searchPlaceholder}
            label={label}
            testId={testId}
          />
        </PopoverContent>
      </Popover>
      {clearable && value ? (
        <button
          type="button"
          aria-label={`Clear ${label}`}
          onClick={() => onChange("")}
          className="absolute right-8.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`${testId}-clear`}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** OMP thinking levels offered when the catalog lists none for a model. */
export const OMP_EFFORT_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The effort levels a model accepts: its catalog levels, none for a listed model without levels, the full OMP list for a typed selector. */
export function effortLevelsFor(selector: string | null | undefined, options: readonly PickerOption[]): readonly string[] {
  if (!selector) return [];
  const listed = options.find((option) => option.value === selector);
  if (!listed) return OMP_EFFORT_LEVELS;
  return listed.efforts ?? [];
}

/** Whether to show an effort control: the model accepts levels, or one is already set and must stay visible. */
export function showsEffortControl(
  value: string | null | undefined,
  selector: string | null | undefined,
  options: readonly PickerOption[],
): boolean {
  return effortLevelsFor(selector, options).length > 0 || Boolean(value);
}

/** Whether an effort survives a switch to `selector`. */
export function keepsEffort(effort: string | null | undefined, selector: string | null | undefined, options: readonly PickerOption[]): boolean {
  return !effort || effortLevelsFor(selector, options).includes(effort);
}

/** One row of effort chips; "Default" clears the level. */
export function EffortChips({
  levels,
  value,
  onChange,
  defaultLabel = "Default",
  label,
  testId,
}: {
  levels: readonly string[];
  value: string | null;
  onChange: (effort: string | null) => void;
  defaultLabel?: string;
  label: string;
  testId: string;
}) {
  const unsupported = value && !levels.includes(value) ? value : null;
  const chips: Array<{ value: string | null; text: string; muted?: boolean }> = [
    { value: null, text: defaultLabel },
    ...levels.map((level) => ({ value: level, text: level })),
    ...(unsupported ? [{ value: unsupported, text: unsupported, muted: true }] : []),
  ];
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1" data-testid={testId}>
      {chips.map((chip) => {
        const selected = (chip.value ?? null) === (value ?? null);
        return (
          <button
            key={chip.value ?? ""}
            type="button"
            role="radio"
            aria-checked={selected}
            title={chip.muted ? "Not listed for this model" : undefined}
            onClick={() => onChange(chip.value)}
            data-testid={`${testId}-${chip.value ?? "default"}`}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              chip.muted && !selected && "line-through",
            )}
          >
            {chip.text}
          </button>
        );
      })}
    </div>
  );
}

function EffortHeader({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-1.5 border-b border-border px-2.5 py-2">
      <span className="block text-xs font-medium text-muted-foreground">Thinking effort</span>
      {children}
    </div>
  );
}

/** Compact effort button for a model row; opens the same chip row. */
export function EffortButton({
  levels,
  value,
  onChange,
  label,
  testId,
  disablePortal,
}: {
  levels: readonly string[];
  value: string | null;
  onChange: (effort: string | null) => void;
  label: string;
  testId: string;
  disablePortal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-1.5 text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !value && "text-muted-foreground",
          )}
          data-testid={testId}
        >
          {value ?? "Default"}
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" disablePortal={disablePortal} className="w-auto max-w-72 p-0">
        <EffortHeader>
          <EffortChips
            levels={levels}
            value={value}
            onChange={(next) => {
              onChange(next);
              setOpen(false);
            }}
            label={label}
            testId={`${testId}-chips`}
          />
        </EffortHeader>
      </PopoverContent>
    </Popover>
  );
}

/** Label-row counter for a model list, such as "1/5". */
export function ModelListCount({ count, max }: { count: number; max: number }) {
  return (
    <span className="text-xs tabular-nums text-muted-foreground" data-testid="model-list-count">
      · {count}/{max}
    </span>
  );
}

/** Ordered model selector list with add, remove and reorder, validated before every change. */
export function ModelListField({
  value,
  options,
  maxItems,
  primary,
  onChange,
  label,
  disablePortal,
  testId,
  currentEfforts,
  onEffortChange,
}: {
  value: readonly string[];
  options: readonly PickerOption[];
  maxItems: number;
  primary: string | null;
  onChange: (next: string[]) => void;
  label: string;
  disablePortal?: boolean;
  testId: string;
  /** Saved effort per fallback selector; rows show an effort button when `onEffortChange` is set. */
  currentEfforts?: Readonly<Record<string, string>>;
  onEffortChange?: (selector: string, effort: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = value.length >= maxItems;
  const current = validateAgentFallbackModels([...value], primary);
  const shownError = error ?? (current.ok ? null : current.message);

  const changeOpen = (next: boolean) => {
    setOpen(next && !full);
    if (!next) setQuery("");
  };

  const commit = (next: string[]): boolean => {
    const result = validateAgentFallbackModels(next, primary);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    if (result.value.length > maxItems) {
      setError(`Pick at most ${maxItems} fallback models.`);
      return false;
    }
    setError(null);
    onChange(result.value);
    return true;
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    commit(next);
  };

  const note = (candidate: string) => {
    if (primary && candidate === primary) return "Main model";
    return value.includes(candidate) ? "Added" : null;
  };

  return (
    <div className="space-y-1.5" data-testid={testId}>
      {value.length > 0 ? (
        <ol className="divide-y divide-border overflow-hidden rounded-md border border-border" aria-label={label}>
          {value.map((entry, index) => (
            <li
              key={entry}
              data-testid={`${testId}-item`}
              className="flex min-w-0 items-center gap-2 py-1 pl-2.5 pr-1 text-sm"
            >
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
                {index + 1}
              </span>
              <ModelValueLabel display={describeModelValue(entry, options)} layout="inline" className="flex-1" />
              {onEffortChange && showsEffortControl(currentEfforts?.[entry], entry, options) ? (
                <EffortButton
                  levels={effortLevelsFor(entry, options)}
                  value={currentEfforts?.[entry] ?? null}
                  onChange={(effort) => onEffortChange(entry, effort)}
                  label={`Thinking effort for ${entry}`}
                  testId={`${testId}-effort`}
                  disablePortal={disablePortal}
                />
              ) : null}
              <div className="flex shrink-0 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${entry} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${entry} down`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${entry}`}
                  onClick={() => commit(value.filter((_, at) => at !== index))}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <div data-testid={`${testId}-picker`}>
        <Popover open={open} onOpenChange={changeOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              disabled={full}
              className={cn(triggerClass, "border-dashed text-muted-foreground hover:text-foreground")}
              onKeyDown={(event) => {
                if (open || !isPrintableKey(event)) return;
                event.preventDefault();
                setQuery(event.key);
                changeOpen(true);
              }}
              data-testid={`${testId}-add`}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {full ? `Limit of ${maxItems} reached. Remove one to add another.` : "Add fallback model"}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            disablePortal={disablePortal}
            className="w-(--radix-popover-trigger-width) min-w-72 p-0"
          >
            <OptionSearchList
              options={options}
              selected={null}
              query={query}
              onQueryChange={setQuery}
              onSelect={(entry) => {
                commit([...value, entry]);
                changeOpen(false);
              }}
              searchPlaceholder={MODEL_SEARCH_PLACEHOLDER}
              label={label}
              note={note}
              testId={`${testId}-add`}
            />
          </PopoverContent>
        </Popover>
      </div>
      {shownError ? (
        <p role="alert" className="text-xs text-destructive" data-testid={`${testId}-error`}>
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
