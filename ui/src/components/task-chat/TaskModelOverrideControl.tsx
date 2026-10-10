import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import type {
  AgentAdapterConfigBatchPreview,
  IssueRunModelOverrideField,
  IssueRunModelOverrideKey,
  IssueRunModelOverrideUpdate,
  IssueRunModelOverrideView,
} from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useMobileViewportInsets } from "@/hooks/useMobileViewportInsets";
import { useMobileSelectorModal } from "@/hooks/useMobileSelectorModal";
import { MobilePickerSheetHeader } from "@/components/ui/mobile-picker-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelOverrideSubtaskRows } from "./ModelOverrideSubtaskRows";
import {
  describeModelValue,
  groupModelOptions,
  ModelOptionGroupHeader,
  ModelOptionText,
  modelOptionMatches,
  ModelValueLabel,
  modelValueText,
} from "./model-option-display";

export const AGENT_DEFAULT_LABEL = "Agent default";

function summarizeFields(
  fields: IssueRunModelOverrideField[],
  format: (field: IssueRunModelOverrideField, value: string) => string,
): string {
  const overridden = fields.filter((field) => field.override);
  if (overridden.length > 0) {
    return overridden.map((field) => format(field, field.override as string)).join(" · ");
  }
  const model = fields.find((field) => field.key === "model");
  return model?.effective ? format(model, model.effective) : AGENT_DEFAULT_LABEL;
}

export function triggerLabel(fields: IssueRunModelOverrideField[]): string {
  return summarizeFields(fields, (field, value) =>
    field.key === "model" ? modelValueText(describeModelValue(value, field.options)) : value,
  );
}

/** The trigger summary: the model's name with a provider badge, then the other overridden values. */
export function RunSettingsSummary({
  fields,
  className,
}: {
  fields: IssueRunModelOverrideField[];
  className?: string;
}) {
  const overridden = fields.filter((field) => field.override);
  const model = fields.find((field) => field.key === "model");
  const shown = overridden.length > 0
    ? overridden.map((field) => ({ field, value: field.override as string }))
    : model?.effective
      ? [{ field: model, value: model.effective }]
      : [];
  if (shown.length === 0) {
    return <span className={cn("truncate", className)}>{AGENT_DEFAULT_LABEL}</span>;
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)} title={triggerTitle(fields)}>
      {shown.map(({ field, value }, index) => (
        <Fragment key={field.key}>
          {index > 0 ? <span className="shrink-0" aria-hidden>·</span> : null}
          {field.key === "model" ? (
            <ModelValueLabel display={describeModelValue(value, field.options)} layout="inline" />
          ) : (
            <span className="shrink-0">{value}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** The trigger summary with full model ids, for tooltips. */
export function triggerTitle(fields: IssueRunModelOverrideField[]): string {
  return summarizeFields(fields, (_field, value) => value);
}

function FieldSection({
  field,
  pending,
  onSelect,
  collapsible,
  expanded,
  onToggle,
}: {
  field: IssueRunModelOverrideField;
  pending: boolean;
  onSelect: (key: IssueRunModelOverrideKey, value: string | null) => void;
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim();
  const sections = useMemo(
    () => groupModelOptions(field.options.filter((option) => modelOptionMatches(option, query))),
    [field.options, query],
  );
  const effective = field.effective ? describeModelValue(field.effective, field.options) : null;
  const agentDefault = field.agentDefault
    ? describeModelValue(field.agentDefault, field.options)
    : null;
  const customValueAvailable =
    field.freeText &&
    query.length > 0 &&
    !field.options.some((option) => option.value === query);
  const open = !collapsible || expanded;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 border-b border-border/60 p-2 last:border-b-0",
        open ? "min-h-0 flex-1" : "shrink-0",
      )}
      data-testid={`task-model-override-section-${field.key}`}
      data-expanded={open ? "true" : "false"}
    >
      <div className="flex items-baseline justify-between gap-2 px-1">
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-left"
            data-testid={`task-model-override-toggle-${field.key}`}
            aria-expanded={open}
          >
            <span className="shrink-0 text-xs font-medium">{field.label}</span>
            {effective ? (
              <ModelValueLabel
                display={effective}
                layout="inline"
                className="justify-end text-xs text-muted-foreground"
                testId={`task-model-override-effective-${field.key}`}
              />
            ) : (
              <span
                className="min-w-0 truncate text-xs text-muted-foreground"
                data-testid={`task-model-override-effective-${field.key}`}
              >
                {AGENT_DEFAULT_LABEL}
              </span>
            )}
          </button>
        ) : (
          <>
            <span className="shrink-0 text-xs font-medium">{field.label}</span>
            {effective ? (
              <ModelValueLabel
                display={effective}
                layout="inline"
                className="max-w-48 justify-end text-xs text-muted-foreground"
                testId={`task-model-override-effective-${field.key}`}
              />
            ) : (
              <span
                className="max-w-32 truncate text-xs text-muted-foreground"
                data-testid={`task-model-override-effective-${field.key}`}
              >
                {AGENT_DEFAULT_LABEL}
              </span>
            )}
          </>
        )}
      </div>
      {open && (field.options.length > 6 || field.freeText) ? (
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
          className="h-8 w-full shrink-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`task-model-override-search-${field.key}`}
        />
      ) : null}
      {open ? (
      <div
        data-slot="entity-option-list"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-sm:max-h-none sm:max-h-48"
      >
        <button
          type="button"
          disabled={pending}
          onClick={() => onSelect(field.key, null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
          data-testid={`task-model-override-default-${field.key}`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{AGENT_DEFAULT_LABEL}</span>
            {agentDefault ? (
              <span
                className="block truncate text-muted-foreground"
                title={agentDefault.id}
                data-testid={`task-model-override-default-value-${field.key}`}
              >
                {modelValueText(agentDefault)}
              </span>
            ) : null}
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
        {sections.map((section) => (
          <div key={section.provider ?? ""} role="group" aria-label={section.provider ?? undefined}>
            {section.provider ? (
              <ModelOptionGroupHeader
                provider={section.provider}
                testId={`task-model-override-group-${field.key}-${section.provider}`}
              />
            ) : null}
            {section.options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={pending}
                onClick={() => onSelect(field.key, option.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                data-testid={`task-model-override-option-${field.key}-${option.value}`}
              >
                <ModelOptionText option={option} />
                {field.override === option.value ? (
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </div>
      ) : null}
    </div>
  );
}

export interface TaskModelOverrideDraft {
  companyId: string;
  agentId: string | null;
  values: Partial<Record<IssueRunModelOverrideKey, string | null>>;
  onChange: (key: IssueRunModelOverrideKey, value: string | null) => void;
  noAgentHint: string;
}

const DRAFT_FIELD_KEYS: readonly IssueRunModelOverrideKey[] = ["model", "thinking"];

export function draftOverrideFields(
  preview: AgentAdapterConfigBatchPreview | undefined,
  values: Partial<Record<IssueRunModelOverrideKey, string | null>>,
): IssueRunModelOverrideField[] {
  if (!preview) return [];
  const current = preview.agents[0]?.current ?? {};
  const fields: IssueRunModelOverrideField[] = [];
  for (const key of DRAFT_FIELD_KEYS) {
    const field = preview.fields.find((entry) => entry.key === key);
    if (!field) continue;
    const agentDefault = current[key] ?? null;
    const override = values[key] ?? null;
    fields.push({
      key,
      label: field.label,
      hint: field.hint,
      freeText: field.freeText,
      options: field.options,
      agentDefault,
      override,
      effective: override ?? agentDefault,
    });
  }
  return fields;
}

export interface TaskModelOverridePendingIssue {
  companyId: string;
  agentId: string | null;
  resolve: () => Promise<string>;
}

/** Per-task model and thinking picker; writes to the issue, or to a draft before one exists. */
export function TaskModelOverrideControl({
  issueId,
  draft,
  pendingIssue,
  footerSlot,
  subtaskRows = false,
  disabled = false,
  mobile = false,
}: {
  issueId?: string | null;
  draft?: TaskModelOverrideDraft;
  pendingIssue?: TaskModelOverridePendingIssue;
  footerSlot?: ReactNode;
  subtaskRows?: boolean;
  disabled?: boolean;
  mobile?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<
    IssueRunModelOverrideKey | null | undefined
  >(undefined);
  const [resolvedIssueId, setResolvedIssueId] = useState<string | null>(null);
  const [pendingValues, setPendingValues] = useState<
    Partial<Record<IssueRunModelOverrideKey, string | null>>
  >({});
  const resolveInFlight = useRef<Promise<string> | null>(null);
  useMobileViewportInsets(open, { sheet: true });
  const mobileSelectorModal = useMobileSelectorModal();
  const activeIssueId = draft ? null : issueId || resolvedIssueId;
  const previewAgent = draft ?? pendingIssue;
  const key = queryKeys.issues.modelOverride(activeIssueId ?? "__none__");
  const query = useQuery({
    queryKey: key,
    queryFn: () => issuesApi.getModelOverride(activeIssueId!),
    enabled: Boolean(activeIssueId),
    staleTime: 30_000,
  });
  const preview = useQuery({
    queryKey: queryKeys.agents.adapterConfigBatch(
      previewAgent?.companyId ?? "__none__",
      previewAgent?.agentId ? [previewAgent.agentId] : [],
    ),
    queryFn: () => agentsApi.batchAdapterConfigPreview([previewAgent!.agentId!]),
    enabled: Boolean(previewAgent?.agentId) && !activeIssueId,
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: async (values: IssueRunModelOverrideUpdate) => {
      let targetId = activeIssueId;
      if (!targetId) {
        if (!pendingIssue) throw new Error("This conversation could not be opened.");
        if (!resolveInFlight.current) {
          resolveInFlight.current = pendingIssue.resolve().then(
            (resolved) => {
              setResolvedIssueId(resolved);
              return resolved;
            },
            (resolveError: unknown) => {
              resolveInFlight.current = null;
              throw resolveError instanceof Error
                ? resolveError
                : new Error("This conversation could not be opened.");
            },
          );
        }
        targetId = await resolveInFlight.current;
      }
      return { targetId, next: await issuesApi.setModelOverride(targetId, values) };
    },
    onSuccess: ({
      targetId,
      next,
    }: {
      targetId: string;
      next: IssueRunModelOverrideView;
    }) => {
      queryClient.setQueryData(queryKeys.issues.modelOverride(targetId), next);
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
  const draftValues = draft?.values;
  const previewData = preview.data;
  const usePreviewFields = Boolean(previewAgent) && !view?.fields.length;
  const fields = useMemo(
    () =>
      usePreviewFields
        ? draftOverrideFields(previewData, draftValues ?? pendingValues)
        : (view?.fields ?? []),
    [usePreviewFields, previewData, draftValues, pendingValues, view],
  );
  const noAgent = Boolean(draft) && !draft?.agentId;
  if (draft) {
    if (draft.agentId && preview.isFetched && fields.length === 0) return null;
  } else if (activeIssueId) {
    if (!open && (!view?.supported || view.fields.length === 0)) return null;
  } else if (!pendingIssue) {
    return null;
  }

  const pending = mutation.isPending;
  const hasOverride = fields.some((field) => field.override);
  const expandedKey =
    expandedOverride === undefined
      ? (fields[0]?.key ?? null)
      : expandedOverride;
  return (
    <Popover
      modal={mobileSelectorModal}
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || noAgent}
          title={
            noAgent ? draft!.noAgentHint : "Model and thinking effort for this task"
          }
          className={cn(
            "flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50",
            hasOverride ? "text-foreground" : "text-muted-foreground",
          )}
          data-testid="task-chat-composer-model-override"
          data-slot="model-override-trigger"
          data-has-override={hasOverride ? "true" : "false"}
        >
          {noAgent ? (
            <span className={cn("truncate", mobile ? "max-w-20" : "max-w-40")}>
              {AGENT_DEFAULT_LABEL}
            </span>
          ) : (
            <RunSettingsSummary fields={fields} className={mobile ? "max-w-28" : "max-w-56"} />
          )}
          {pending ? (
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
        <MobilePickerSheetHeader
          title="Task model"
          value={triggerLabel(fields)}
          onClose={() => setOpen(false)}
        />
        <div data-mobile-sheet-body="" className="flex min-w-0 flex-col">
          {fields.map((field) => (
            <FieldSection
              key={field.key}
              field={field}
              pending={pending}
              collapsible={mobile}
              expanded={expandedKey === field.key}
              onToggle={() =>
                setExpandedOverride(expandedKey === field.key ? null : field.key)
              }
              onSelect={(fieldKey, value) => {
                if (draft) {
                  draft.onChange(fieldKey, value);
                  return;
                }
                if (!activeIssueId) {
                  if (value === null && !field.override) return;
                  setPendingValues((current) => ({ ...current, [fieldKey]: value }));
                }
                mutation.mutate({ [fieldKey]: value });
              }}
            />
          ))}
          {fields.length === 0 ? (
            <p
              className="px-3 py-2 text-xs text-muted-foreground"
              data-testid="task-model-override-empty"
            >
              {view?.unsupportedReason ?? "Loading model options…"}
            </p>
          ) : null}
        </div>
        {footerSlot ? (
          <div
            data-mobile-sheet-controls=""
            data-testid="task-model-override-footer"
            className="shrink-0 border-t border-border/60"
          >
            {footerSlot}
          </div>
        ) : subtaskRows && view?.inheritance ? (
          <div
            data-mobile-sheet-controls=""
            data-testid="task-model-override-footer"
            className="shrink-0 border-t border-border/60"
          >
            <ModelOverrideSubtaskRows
              inheritToSubtasks={view.inheritance.inheritToSubtasks}
              subtaskScope={view.inheritance.subtaskScope}
              disabled={disabled || pending}
              testIdPrefix="task-model-override"
              propagation={view.propagation}
              onInheritChange={(inheritToSubtasks) =>
                mutation.mutate({
                  inheritToSubtasks,
                  subtaskScope: view.inheritance.subtaskScope,
                })
              }
              onScopeChange={(subtaskScope) =>
                mutation.mutate({
                  inheritToSubtasks: view.inheritance.inheritToSubtasks,
                  subtaskScope,
                })
              }
            />
          </div>
        ) : null}
        {error ? (
          <p
            className="shrink-0 px-3 py-2 text-xs text-destructive"
            data-testid="task-model-override-error"
          >
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
