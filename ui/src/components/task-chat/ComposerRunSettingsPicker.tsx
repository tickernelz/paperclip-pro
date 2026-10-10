import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, Loader2, Plus, RotateCcw, Search } from "lucide-react";
import type {
  IssueRunModelOverrideField,
  IssueRunModelOverrideKey,
  IssueRunModelOverrideUpdate,
  IssueRunModelOverrideView,
} from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { getLastComposerEffort, rememberComposerEffort } from "@/lib/recent-composer-effort";
import { useMobileViewportInsets } from "@/hooks/useMobileViewportInsets";
import { useMobileSelectorModal } from "@/hooks/useMobileSelectorModal";
import { MobilePickerSheetHeader } from "@/components/ui/mobile-picker-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { InlineEntityOption } from "@/components/InlineEntitySelector";
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
import {
  AGENT_DEFAULT_LABEL,
  draftOverrideFields,
  RunSettingsSummary,
  triggerLabel,
  type TaskModelOverridePendingIssue,
} from "./TaskModelOverrideControl";

export type ComposerRunSettingsValues = Partial<
  Record<IssueRunModelOverrideKey, string | null>
>;

export interface ComposerRunSettingsStaging {
  values: ComposerRunSettingsValues;
  hasValues: boolean;
  set: (key: IssueRunModelOverrideKey, value: string | null) => void;
  clear: () => void;
}

/** Holds run settings chosen for a not-yet-sent reassignment; they ride the reassignment update. */
export function useComposerRunSettingsStaging(): ComposerRunSettingsStaging {
  const [values, setValues] = useState<ComposerRunSettingsValues>({});
  const set = useCallback((key: IssueRunModelOverrideKey, value: string | null) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);
  const clear = useCallback(() => setValues({}), []);
  return {
    values,
    hasValues: Object.keys(values).length > 0,
    set,
    clear,
  };
}

function agentIdOf(assigneeValue: string): string | null {
  return assigneeValue.startsWith("agent:")
    ? assigneeValue.slice("agent:".length)
    : null;
}

/** 0 means "agent default"; option N sits at N+1 so the track starts at the default. */
function committedOptionIndex(field: IssueRunModelOverrideField): number {
  if (!field.override) return 0;
  return field.options.findIndex((option) => option.value === field.override) + 1;
}

interface Props {
  issueId?: string | null;
  pendingIssue?: TaskModelOverridePendingIssue;
  assigneeValue: string;
  currentAssigneeValue: string;
  options: InlineEntityOption[];
  onAssigneeChange: (value: string | null) => void;
  staging: ComposerRunSettingsStaging;
  renderAssigneeIdentity?: (
    value: string,
    label: string,
    placement: "trigger" | "option",
  ) => ReactNode;
  subtaskRows?: boolean;
  draft?: boolean;
  companyId?: string | null;
  footerSlot?: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  mobile?: boolean;
}

/** One composer chip carrying the assignee plus this task's model and thinking override. */
export function ComposerRunSettingsPicker({
  issueId,
  pendingIssue,
  assigneeValue,
  currentAssigneeValue,
  options,
  onAssigneeChange,
  staging,
  renderAssigneeIdentity,
  subtaskRows = false,
  draft = false,
  companyId = null,
  footerSlot,
  triggerRef,
  disabled = false,
  mobile = false,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"settings" | "agents" | "model">("settings");
  const [modelSearch, setModelSearch] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolvedIssueId, setResolvedIssueId] = useState<string | null>(null);
  const [pendingValues, setPendingValues] = useState<ComposerRunSettingsValues>({});
  const resolveInFlight = useRef<Promise<string> | null>(null);
  useMobileViewportInsets(open, { sheet: true });
  const mobileSelectorModal = useMobileSelectorModal();

  const activeIssueId = issueId || resolvedIssueId;
  const reassigning = Boolean(activeIssueId) && assigneeValue !== currentAssigneeValue;
  const pendingAgentId = agentIdOf(assigneeValue);
  const hasOverrideTarget = Boolean(activeIssueId || pendingIssue || draft);
  const previewAgentId = !hasOverrideTarget
    ? null
    : draft
      ? pendingAgentId
      : reassigning
      ? pendingAgentId
      : activeIssueId
        ? null
        : (pendingAgentId ?? pendingIssue?.agentId ?? null);
  const companyKey = pendingIssue?.companyId ?? "__composer__";

  const savedQuery = useQuery({
    queryKey: queryKeys.issues.modelOverride(activeIssueId ?? "__none__"),
    queryFn: () => issuesApi.getModelOverride(activeIssueId!),
    enabled: Boolean(activeIssueId),
    staleTime: 30_000,
  });
  const settledAssigneeRef = useRef(currentAssigneeValue);
  useEffect(() => {
    if (settledAssigneeRef.current === currentAssigneeValue) return;
    settledAssigneeRef.current = currentAssigneeValue;
    if (!activeIssueId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.issues.modelOverride(activeIssueId),
    });
  }, [activeIssueId, currentAssigneeValue, queryClient]);
  const previewQuery = useQuery({
    queryKey: queryKeys.agents.adapterConfigBatch(
      companyKey,
      previewAgentId ? [previewAgentId] : [],
    ),
    queryFn: () => agentsApi.batchAdapterConfigPreview([previewAgentId!]),
    enabled: Boolean(previewAgentId),
    staleTime: 60_000,
  });
  const agentOptionIds = useMemo(
    () => options.flatMap((option) => (agentIdOf(option.id) ? [agentIdOf(option.id)!] : [])),
    [options],
  );
  const rosterQuery = useQuery({
    queryKey: queryKeys.agents.adapterConfigBatch(`${companyKey}:roster`, agentOptionIds),
    queryFn: () => agentsApi.batchAdapterConfigPreview(agentOptionIds),
    enabled: open && agentOptionIds.length > 0,
    staleTime: 60_000,
  });
  const harnessById = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of rosterQuery.data?.agents ?? []) {
      map.set(target.agentId, target.adapterType);
    }
    return map;
  }, [rosterQuery.data]);

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
    onSuccess: ({ targetId, next }: { targetId: string; next: IssueRunModelOverrideView }) => {
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

  const view0 = savedQuery.data;
  const previewAdapterType = previewQuery.data?.agents[0]?.adapterType ?? null;
  const carriedOverride = useMemo<ComposerRunSettingsValues>(() => {
    if (!reassigning || !view0 || !previewAdapterType) return {};
    if (view0.adapterType !== previewAdapterType) return {};
    const carried: ComposerRunSettingsValues = {};
    for (const field of view0.fields) {
      if (field.override) carried[field.key] = field.override;
    }
    return carried;
  }, [reassigning, view0, previewAdapterType]);
  const overlay = draft
    ? staging.values
    : reassigning
      ? { ...carriedOverride, ...staging.values }
      : pendingValues;
  const usePreviewFields = Boolean(previewAgentId) && (reassigning || !activeIssueId);
  const fields = useMemo(
    () =>
      reassigning && !pendingAgentId
        ? []
        : usePreviewFields
          ? draftOverrideFields(previewQuery.data, overlay)
          : (view0?.fields ?? []),
    [reassigning, pendingAgentId, usePreviewFields, previewQuery.data, overlay, view0],
  );
  const [sliderDrafts, setSliderDrafts] = useState<
    Partial<Record<IssueRunModelOverrideKey, number>>
  >({});
  useEffect(() => {
    setSliderDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const field of fields) {
        if (next[field.key] === undefined) continue;
        if (next[field.key] !== committedOptionIndex(field)) continue;
        delete next[field.key];
        changed = true;
      }
      return changed ? next : current;
    });
  }, [fields]);
  const rememberCompanyId = draft ? companyId : null;
  const stagedThinking = staging.values.thinking;
  const setStaged = staging.set;
  const thinkingOptionsKey =
    fields.find((field) => field.key === "thinking")?.options.map((option) => option.value).join("\n") ?? "";
  useEffect(() => {
    if (!rememberCompanyId || stagedThinking !== undefined || !thinkingOptionsKey) return;
    const remembered = getLastComposerEffort(rememberCompanyId);
    if (remembered && thinkingOptionsKey.split("\n").includes(remembered)) {
      setStaged("thinking", remembered);
    }
  }, [rememberCompanyId, stagedThinking, thinkingOptionsKey, setStaged]);
  const modelField = fields.find((field) => field.key === "model");
  const choiceFields = fields.filter(
    (field) => field.key !== "model" && field.options.length > 0,
  );
  const pending = mutation.isPending;
  const hasOverride = fields.some((field) => field.override);
  const summary = fields.length ? triggerLabel(fields) : AGENT_DEFAULT_LABEL;

  const assigneeOptions = useMemo<InlineEntityOption[]>(
    () => [
      { id: "", label: "No assignee", searchText: "Unassigned" },
      ...options.filter((option) => option.id !== ""),
    ],
    [options],
  );
  const assigneeLabel =
    options.find((option) => option.id === assigneeValue)?.label ??
    (assigneeValue ? "Unassigned" : "No assignee");

  function applyValue(key: IssueRunModelOverrideKey, value: string | null) {
    if (rememberCompanyId && key === "thinking") rememberComposerEffort(rememberCompanyId, value);
    if (reassigning || draft) {
      staging.set(key, value);
      return;
    }
    if (!activeIssueId) {
      setPendingValues((current) => ({ ...current, [key]: value }));
    }
    mutation.mutate({ [key]: value });
  }

  function resetOverrides() {
    const update: IssueRunModelOverrideUpdate = {};
    for (const field of fields) {
      if (!field.override) continue;
      update[field.key] = null;
    }
    if (Object.keys(update).length === 0) return;
    if (rememberCompanyId) rememberComposerEffort(rememberCompanyId, null);
    if (reassigning || draft) {
      for (const key of Object.keys(update) as IssueRunModelOverrideKey[]) {
        staging.set(key, null);
      }
      return;
    }
    if (!activeIssueId) setPendingValues((current) => ({ ...current, ...update }));
    mutation.mutate(update);
  }

  function chooseAssignee(value: string) {
    if (value !== assigneeValue) {
      onAssigneeChange(value || null);
      staging.clear();
      setPendingValues({});
    }
    setView("settings");
    setAssigneeSearch("");
  }

  function chooseModel(value: string | null) {
    applyValue("model", value);
    setView("settings");
    setModelSearch("");
  }

  const assigneeQuery = assigneeSearch.trim().toLowerCase();
  const filteredAssignees = assigneeOptions.filter((option) => {
    if (!assigneeQuery) return true;
    const agentId = agentIdOf(option.id);
    const harness = agentId ? (harnessById.get(agentId) ?? "") : "";
    return `${option.label} ${option.searchText ?? ""} ${harness}`
      .toLowerCase()
      .includes(assigneeQuery);
  });

  const modelQuery = modelSearch.trim();
  const modelOptions = modelField?.options ?? [];
  const filteredModels = modelOptions.filter((option) => modelOptionMatches(option, modelQuery));
  const modelSections = groupModelOptions(filteredModels);
  const agentDefaultModel = modelField?.agentDefault
    ? describeModelValue(modelField.agentDefault, modelOptions)
    : null;
  const exactModelMatch = modelOptions.some((option) => option.value === modelQuery);
  const manualModelAvailable =
    Boolean(modelField?.freeText) && modelQuery.length > 0 && !exactModelMatch;

  const settingsBody = (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Choose assignee"
          onClick={() => setView("agents")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="composer-run-settings-assignee-row"
        >
          {renderAssigneeIdentity?.(assigneeValue, assigneeLabel, "option")}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{assigneeLabel}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {pendingAgentId ? (harnessById.get(pendingAgentId) ?? "Agent") : "Person"}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Reset to agent default"
          title="Reset to agent default"
          disabled={!hasOverride || pending}
          onClick={resetOverrides}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
          data-testid="composer-run-settings-reset"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
      </div>
      {modelField ? (
        <button
          type="button"
          aria-label="Choose exact model"
          onClick={() => setView("model")}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="composer-run-settings-model-row"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">{modelField.label}</span>
            {modelField.effective ? (
              <ModelValueLabel
                display={describeModelValue(modelField.effective, modelField.options)}
                layout="stacked"
                testId="composer-run-settings-model-value"
              />
            ) : (
              <span
                className="block truncate text-sm font-medium"
                data-testid="composer-run-settings-model-value"
              >
                {AGENT_DEFAULT_LABEL}
              </span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ) : null}
      {choiceFields.map((field) => {
        const index = sliderDrafts[field.key] ?? committedOptionIndex(field);
        const selected = index === 0 ? null : (field.options[index - 1] ?? null);
        const label = selected?.label ?? AGENT_DEFAULT_LABEL;
        const commit = () => {
          const draft = sliderDrafts[field.key];
          if (draft === undefined || draft === committedOptionIndex(field)) return;
          applyValue(
            field.key,
            draft === 0 ? null : (field.options[draft - 1]?.value ?? null),
          );
        };
        return (
          <div key={field.key} className="px-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span
                className="min-w-0 truncate text-sm font-medium"
                data-testid={`composer-run-settings-value-${field.key}`}
              >
                {label}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={field.options.length}
              step={1}
              value={index}
              aria-label={field.label}
              aria-valuetext={label}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSliderDrafts((current) => ({ ...current, [field.key]: next }));
              }}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
              className="mt-2 w-full accent-primary"
              data-testid={`composer-run-settings-range-${field.key}`}
            />
          </div>
        );
      })}
      {fields.length === 0 &&
      hasOverrideTarget &&
      !(draft && pendingAgentId && previewQuery.isFetched) ? (
        <p
          className="px-1 text-xs text-muted-foreground"
          data-testid="composer-run-settings-empty"
        >
          {draft && !pendingAgentId
            ? "Pick an agent assignee first"
            : (view0?.unsupportedReason ?? "Loading model options…")}
        </p>
      ) : null}
    </div>
  );

  const agentsBody = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2">
      <div className="flex items-center gap-2 px-1 py-1.5">
        <button
          type="button"
          aria-label="Back to run settings"
          onClick={() => setView("settings")}
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 text-xs font-semibold">Choose assignee</span>
      </div>
      <div className="relative mt-1 shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          aria-label="Search assignees"
          placeholder="Search assignees…"
          value={assigneeSearch}
          onChange={(event) => setAssigneeSearch(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="composer-run-settings-assignee-search"
        />
      </div>
      <div
        data-slot="entity-option-list"
        className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-60"
        role="listbox"
        aria-label="Assignees"
      >
        {filteredAssignees.map((option) => {
          const agentId = agentIdOf(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === assigneeValue}
              onClick={() => chooseAssignee(option.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
            >
              {renderAssigneeIdentity?.(option.id, option.label, "option")}
              <span className="min-w-0 flex-1 truncate text-sm">{option.label}</span>
              {agentId && harnessById.get(agentId) ? (
                <span className="shrink-0 truncate text-xs text-muted-foreground">
                  {harnessById.get(agentId)}
                </span>
              ) : null}
              {option.id === assigneeValue ? (
                <Check className="size-4 shrink-0" aria-hidden />
              ) : null}
            </button>
          );
        })}
        {filteredAssignees.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>
        ) : null}
      </div>
    </div>
  );

  const modelBody = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2">
      <div className="flex items-center gap-2 px-1 py-1.5">
        <button
          type="button"
          aria-label="Back to run settings"
          onClick={() => setView("settings")}
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 text-xs font-semibold">
          {modelField?.label ?? "Model"}
        </span>
      </div>
      <div className="relative mt-1 shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          aria-label="Search or paste a model ID"
          placeholder={
            modelField?.freeText ? "Search or paste a model ID" : "Search models…"
          }
          value={modelSearch}
          onChange={(event) => setModelSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !manualModelAvailable) return;
            event.preventDefault();
            chooseModel(modelQuery);
          }}
          className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="composer-run-settings-model-search"
        />
      </div>
      <div
        data-slot="entity-option-list"
        className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-60"
        role="listbox"
        aria-label="Models"
      >
        <button
          type="button"
          role="option"
          aria-selected={!modelField?.override}
          disabled={pending}
          onClick={() => chooseModel(null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
          data-testid="composer-run-settings-model-default"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{AGENT_DEFAULT_LABEL}</span>
            {agentDefaultModel ? (
              <span
                className="block truncate text-xs text-muted-foreground"
                title={agentDefaultModel.id}
                data-testid="composer-run-settings-model-default-value"
              >
                {modelValueText(agentDefaultModel)}
              </span>
            ) : null}
          </span>
          {!modelField?.override ? <Check className="size-4 shrink-0" aria-hidden /> : null}
        </button>
        {modelSections.map((section) => (
          <div key={section.provider ?? ""} role="group" aria-label={section.provider ?? undefined}>
            {section.provider ? (
              <ModelOptionGroupHeader
                provider={section.provider}
                testId={`composer-run-settings-model-group-${section.provider}`}
              />
            ) : null}
            {section.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={modelField?.override === option.value}
                disabled={pending}
                onClick={() => chooseModel(option.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                data-testid={`composer-run-settings-model-option-${option.value}`}
              >
                <ModelOptionText option={option} />
                {modelField?.override === option.value ? (
                  <Check className="size-4 shrink-0" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        ))}
        {filteredModels.length === 0 && !manualModelAvailable ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No catalog match.</p>
        ) : null}
      </div>
      {manualModelAvailable ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => chooseModel(modelQuery)}
          className="mt-2 flex shrink-0 items-center gap-2 rounded-md border-t border-border/60 px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
          data-testid="composer-run-settings-model-custom"
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Use exact ID <span className="font-medium">{modelQuery}</span>
          </span>
        </button>
      ) : null}
    </div>
  );

  return (
    <Popover
      modal={mobileSelectorModal}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        setView("settings");
        setModelSearch("");
        setAssigneeSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label="Select assignee, model and thinking"
          className="flex h-8 min-w-0 max-w-80 shrink items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          data-testid="task-chat-composer-assignee"
          data-slot="model-override-trigger"
          data-has-override={hasOverride ? "true" : "false"}
        >
          {renderAssigneeIdentity?.(assigneeValue, assigneeLabel, "trigger")}
          <span
            className={cn("truncate", mobile ? "max-w-20" : "max-w-32")}
            data-testid="task-chat-composer-assignee-label"
          >
            {assigneeLabel}
          </span>
          <span className="shrink-0 text-muted-foreground" aria-hidden>
            ·
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-muted-foreground",
              mobile && "sr-only",
            )}
            data-testid="task-chat-composer-run-summary"
          >
            {fields.length ? <RunSettingsSummary fields={fields} /> : AGENT_DEFAULT_LABEL}
          </span>
          {pending ? (
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-(--sz-300px) max-w-full p-0"
        data-mobile-entity-picker=""
        data-testid="composer-run-settings-panel"
      >
        <MobilePickerSheetHeader
          title="Run settings"
          value={`${assigneeLabel} · ${summary}`}
          onClose={() => setOpen(false)}
        />
        <div data-mobile-sheet-body="" className="flex min-w-0 flex-col">
          {view === "settings" ? settingsBody : view === "agents" ? agentsBody : modelBody}
        </div>
        {view === "settings" && !subtaskRows && footerSlot ? (
          <div
            data-mobile-sheet-controls=""
            data-testid="composer-run-settings-footer"
            className="shrink-0 border-t border-border/60"
          >
            {footerSlot}
          </div>
        ) : null}
        {view === "settings" && subtaskRows && view0?.inheritance ? (
          <div
            data-mobile-sheet-controls=""
            data-testid="composer-run-settings-footer"
            className="shrink-0 border-t border-border/60"
          >
            <ModelOverrideSubtaskRows
              inheritToSubtasks={view0.inheritance.inheritToSubtasks}
              subtaskScope={view0.inheritance.subtaskScope}
              disabled={disabled || pending}
              testIdPrefix="task-model-override"
              propagation={view0.propagation}
              onInheritChange={(inheritToSubtasks) =>
                mutation.mutate({
                  inheritToSubtasks,
                  subtaskScope: view0.inheritance.subtaskScope,
                })
              }
              onScopeChange={(subtaskScope) =>
                mutation.mutate({
                  inheritToSubtasks: view0.inheritance.inheritToSubtasks,
                  subtaskScope,
                })
              }
            />
          </div>
        ) : null}
        {error ? (
          <p
            className="shrink-0 px-3 py-2 text-xs text-destructive"
            data-testid="composer-run-settings-error"
          >
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
