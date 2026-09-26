import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import type {
  IssueRunModelOverrideField,
  IssueRunModelOverrideKey,
  IssueRunModelOverrideView,
} from "@tickernelz/paperclip-pro-shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useMobilePickerViewport } from "@/hooks/useMobilePickerViewport";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const AGENT_DEFAULT_LABEL = "Agent default";

function shortModelLabel(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function triggerLabel(fields: IssueRunModelOverrideField[]): string {
  const parts = fields
    .filter((field) => field.override)
    .map((field) =>
      field.key === "model"
        ? shortModelLabel(field.override as string)
        : (field.override as string),
    );
  if (parts.length > 0) return parts.join(" · ");
  const effective = fields.find((field) => field.key === "model")?.effective;
  return effective ? shortModelLabel(effective) : AGENT_DEFAULT_LABEL;
}

function FieldSection({
  field,
  pending,
  onSelect,
}: {
  field: IssueRunModelOverrideField;
  pending: boolean;
  onSelect: (key: IssueRunModelOverrideKey, value: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim();
  const options = useMemo(() => {
    const lowered = query.toLowerCase();
    return lowered
      ? field.options.filter(
          (option) =>
            option.value.toLowerCase().includes(lowered) ||
            option.label.toLowerCase().includes(lowered),
        )
      : field.options;
  }, [field.options, query]);
  const customValueAvailable =
    field.freeText &&
    query.length > 0 &&
    !field.options.some((option) => option.value === query);

  return (
    <div
      className="flex min-w-0 flex-col gap-1 border-b border-border/60 p-2 last:border-b-0"
      data-testid={`task-model-override-section-${field.key}`}
    >
      <div className="flex items-baseline justify-between gap-2 px-1">
        <span className="text-xs font-medium">{field.label}</span>
        <span
          className="max-w-32 truncate text-xs text-muted-foreground"
          data-testid={`task-model-override-effective-${field.key}`}
        >
          {field.effective ?? AGENT_DEFAULT_LABEL}
        </span>
      </div>
      {field.options.length > 6 || field.freeText ? (
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !customValueAvailable) return;
            event.preventDefault();
            onSelect(field.key, query);
          }}
          placeholder={field.freeText ? "Search or type a value…" : "Search…"}
          disabled={pending}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`task-model-override-search-${field.key}`}
        />
      ) : null}
      <div
        data-slot="entity-option-list"
        className="max-h-48 overflow-y-auto overscroll-contain"
      >
        <button
          type="button"
          disabled={pending}
          onClick={() => onSelect(field.key, null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
          data-testid={`task-model-override-default-${field.key}`}
        >
          <span className="min-w-0 flex-1 truncate">
            {AGENT_DEFAULT_LABEL}
            {field.agentDefault ? ` (${shortModelLabel(field.agentDefault)})` : ""}
          </span>
          {field.override === null ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : null}
        </button>
        {customValueAvailable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect(field.key, query)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
            data-testid={`task-model-override-custom-${field.key}`}
          >
            <span className="min-w-0 flex-1 truncate">Use “{query}”</span>
          </button>
        ) : null}
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={pending}
            onClick={() => onSelect(field.key, option.value)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
            data-testid={`task-model-override-option-${field.key}-${option.value}`}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {field.override === option.value ? (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Per-task model and thinking picker; writes to the issue, not the agent config. */
export function TaskModelOverrideControl({
  issueId,
  disabled = false,
  mobile = false,
}: {
  issueId: string | null | undefined;
  disabled?: boolean;
  mobile?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useMobilePickerViewport(open);
  const key = queryKeys.issues.modelOverride(issueId ?? "__none__");
  const query = useQuery({
    queryKey: key,
    queryFn: () => issuesApi.getModelOverride(issueId!),
    enabled: Boolean(issueId),
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (values: { model?: string | null; thinking?: string | null }) =>
      issuesApi.setModelOverride(issueId!, values),
    onSuccess: (next: IssueRunModelOverrideView) => {
      queryClient.setQueryData(key, next);
      setError(null);
    },
    onError: (mutationError: unknown) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "The override could not be saved.",
      );
    },
  });

  const view = query.data;
  if (!issueId || !view?.supported || view.fields.length === 0) return null;

  const hasOverride = view.fields.some((field) => field.override);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Model and thinking effort for this task"
          className={cn(
            "flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50",
            hasOverride ? "text-foreground" : "text-muted-foreground",
          )}
          data-testid="task-chat-composer-model-override"
          data-has-override={hasOverride ? "true" : "false"}
        >
          <span className={cn("truncate", mobile ? "max-w-20" : "max-w-40")}>
            {triggerLabel(view.fields)}
          </span>
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-(--sz-280px) max-w-(--sz-turn-status-popover) p-0"
        data-mobile-entity-picker=""
        data-testid="task-model-override-panel"
      >
        {view.fields.map((field) => (
          <FieldSection
            key={field.key}
            field={field}
            pending={mutation.isPending}
            onSelect={(fieldKey, value) =>
              mutation.mutate({ [fieldKey]: value })
            }
          />
        ))}
        {error ? (
          <p
            className="px-3 py-2 text-xs text-destructive"
            data-testid="task-model-override-error"
          >
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
