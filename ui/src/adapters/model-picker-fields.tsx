import { useState, useEffect, useRef, useCallback } from "react";
import { validateAgentFallbackModels } from "@tickernelz/paperclip-pro-shared";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Button } from "../components/ui/button";
import { describeModelValue, ModelValueLabel } from "../components/task-chat/model-option-display";
import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";

/** Type-to-filter option picker that also accepts free text. */
export function ComboboxField({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: { label: string; value: string; group?: string }[];
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFilter("");
  }, [value]);

  const filtered = options.filter((opt) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      opt.value.toLowerCase().includes(q) ||
      opt.label.toLowerCase().includes(q) ||
      (opt.group && opt.group.toLowerCase().includes(q))
    );
  });

  const selectedOpt = options.find((o) => o.value === value);
  const displayValue = filter || selectedOpt?.value || value || "";

  const grouped = new Map<string, typeof filtered>();
  for (const opt of filtered) {
    const g = opt.group ?? "";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(opt);
  }

  const select = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setFilter("");
      inputRef.current?.blur();
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length === 1) {
        select(filtered[0].value);
      } else if (filter) {
        select(filter);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setFilter("");
    } else if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-0">
        <input
          ref={inputRef}
          type="text"
          className="flex-1 rounded-l-md border border-r-0 border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40 focus:z-10"
          value={displayValue}
          placeholder={placeholder ?? "Type or select..."}
          onChange={(e) => {
            setFilter(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (!open) setOpen(true);
          }}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
        />
        <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button className="rounded-r-md border border-border px-2 py-1.5 hover:bg-accent/50 transition-colors">
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="p-1 max-h-60 overflow-y-auto"
            style={{ minWidth: 280 }}
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {Array.from(grouped.entries()).map(([group, opts]) => (
              <div key={group || "_ungrouped"}>
                {group && (
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {group}
                  </div>
                )}
                {opts.map((opt) => (
                  <button
                    key={opt.value}
                    className={`flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50 ${
                      opt.value === value ? "bg-accent" : ""
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent input blur
                      select(opt.value);
                    }}
                  >
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {filter && filtered.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Use &quot;{filter}&quot; as custom value (press Enter)
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

type ModelListOption = { label: string; value: string; group?: string; name?: string };

/** Ordered model selector list with add, remove and reorder, validated before every change. */
export function ModelListField({
  value,
  options,
  maxItems,
  primary,
  onChange,
  testId,
  placeholder,
}: {
  value: readonly string[];
  options: ModelListOption[];
  maxItems: number;
  primary: string | null;
  onChange: (next: string[]) => void;
  testId: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = value.length >= maxItems;
  const current = validateAgentFallbackModels([...value], primary);
  const shownError = error ?? (current.ok ? null : current.message);

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

  const add = () => {
    const entry = draft.trim();
    if (!entry) return;
    if (full) {
      setError(`Pick at most ${maxItems} fallback models.`);
      return;
    }
    if (commit([...value, entry])) setDraft("");
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    commit(next);
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      {value.length > 0 ? (
        <ol className="space-y-1">
          {value.map((entry, index) => (
            <li
              key={entry}
              data-testid={`${testId}-item`}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
            >
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <ModelValueLabel display={describeModelValue(entry, options)} layout="inline" className="flex-1" />
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
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1" data-testid={`${testId}-picker`}>
          <ComboboxField
            value={draft}
            options={options}
            onChange={(next) => {
              setError(null);
              setDraft(next);
            }}
            placeholder={placeholder}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid={`${testId}-add`}
          disabled={full || !draft.trim()}
          onClick={add}
        >
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length} of {maxItems}
      </p>
      {shownError ? (
        <p role="alert" className="text-xs text-destructive" data-testid={`${testId}-error`}>
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
