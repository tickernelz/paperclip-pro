import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  AGENT_FALLBACK_EFFORTS_KEY,
  AGENT_FALLBACK_MODELS_KEY,
  AGENT_FALLBACK_MODELS_MAX,
  fitAgentFallbackEfforts,
  type Agent,
} from "@tickernelz/paperclip-pro-shared";
import { Loader2, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  ComboboxField,
  EffortChips,
  effortLevelsFor,
  keepsEffort,
  MODEL_SEARCH_PLACEHOLDER,
  showsEffortControl,
  ModelListCount,
  ModelListField,
  OptionSearchList,
} from "@/adapters/model-picker-fields";
import { describeModelValue, ModelValueLabel, modelValueText } from "@/components/task-chat/model-option-display";
import { cn } from "@/lib/utils";
import {
  AGENT_EFFORT_KEY,
  type AgentModelSettings,
  type AgentModelSettingsController,
} from "./use-agent-model-settings";

const cellTriggerClass =
  "flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent aria-busy:cursor-progress";

/** Column widths shared by the agents table header and its rows. */
export const AGENT_MODEL_COLUMN_CLASSES = {
  model: "w-56 min-w-0",
  fallbacks: "w-48 min-w-0",
} as const;

function keepRowStill(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
  if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
}

function openOnEnter(open: (next: boolean) => void) {
  return (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    open(true);
  };
}

function RowIsolation({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className} onClick={keepRowStill}>
      {children}
    </div>
  );
}

function EmptyValue({ label }: { label: string }) {
  return (
    <span className="block px-1.5 py-1 text-xs text-muted-foreground" aria-label={`${label} not available`}>
      —
    </span>
  );
}

function CellAffordance({ pending }: { pending: boolean }) {
  return pending ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" /> : null;
}

function FallbackChip({ index, display }: { index: number; display: ReturnType<typeof describeModelValue> }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded border border-border px-1 text-(length:--text-micro) leading-4"
      title={display.id}
    >
      <span className="shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
      <span className="truncate">
        {display.name}
        {display.provider ? <span className="text-muted-foreground">{` · ${display.provider}`}</span> : null}
      </span>
    </span>
  );
}

function ModelCell({ agent, settings, controller }: CellProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pending = controller.isPending(agent.id, "model");
  const effortPending = controller.isPending(agent.id, AGENT_EFFORT_KEY);
  const display = settings.model ? describeModelValue(settings.model, settings.modelOptions) : null;
  if (!settings.modelField) {
    return display ? (
      <div className="px-1.5 py-1 text-xs" data-testid={`agent-model-${agent.id}`}>
        <ModelValueLabel display={display} layout="inline" />
      </div>
    ) : (
      <EmptyValue label="Model" />
    );
  }
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  return (
    <RowIsolation>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cellTriggerClass}
            aria-label={`Model for ${agent.name}`}
            aria-busy={pending || undefined}
            title={settings.model ?? undefined}
            onKeyDown={openOnEnter(changeOpen)}
            data-testid={`agent-model-${agent.id}`}
          >
            {display ? (
              <ModelValueLabel display={display} layout="inline" className="min-w-0 flex-1" />
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">Adapter default</span>
            )}
            {settings.effortField && showsEffortControl(settings.effort, settings.model, settings.modelOptions) ? (
              <span
                className={cn("shrink-0 text-xs", settings.effort ? "text-foreground" : "text-muted-foreground")}
                data-testid={`agent-effort-${agent.id}`}
              >
                {settings.effort ?? "default"}
              </span>
            ) : null}
            <CellAffordance pending={pending || effortPending} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--sz-22rem) max-w-(--radix-popover-content-available-width) p-0">
          {settings.effortField && showsEffortControl(settings.effort, settings.model, settings.modelOptions) ? (
            <div className="space-y-1.5 border-b border-border px-2.5 py-2">
              <span className="block text-xs font-medium text-muted-foreground">Thinking effort</span>
              <EffortChips
                levels={effortLevelsFor(settings.model, settings.modelOptions)}
                value={settings.effort}
                onChange={(next) => controller.save(agent, AGENT_EFFORT_KEY, next)}
                defaultLabel="Default"
                label={`Effort for ${agent.name}`}
                testId={`agent-effort-chips-${agent.id}`}
              />
            </div>
          ) : null}
          <OptionSearchList
            options={settings.modelOptions}
            selected={settings.model}
            query={query}
            onQueryChange={setQuery}
            onSelect={(next) => {
              changeOpen(false);
              const dropEffort = Boolean(settings.effortField) && !keepsEffort(settings.effort, next, settings.modelOptions);
              controller.saveMany(agent, "model", dropEffort ? { model: next, [AGENT_EFFORT_KEY]: null } : { model: next });
            }}
            searchPlaceholder={MODEL_SEARCH_PLACEHOLDER}
            label={`Model for ${agent.name}`}
            testId={`agent-model-picker-${agent.id}`}
          />
        </PopoverContent>
      </Popover>
    </RowIsolation>
  );
}

function FallbacksCell({ agent, settings, controller }: CellProps) {
  const [open, setOpen] = useState(false);
  const pending = controller.isPending(agent.id, AGENT_FALLBACK_MODELS_KEY);
  if (!settings.fallbackField) return <EmptyValue label="Fallback models" />;
  const [first, ...rest] = settings.fallbacks;
  return (
    <RowIsolation>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cellTriggerClass}
            aria-label={`Fallback models for ${agent.name}`}
            aria-busy={pending || undefined}
            title={settings.fallbacks.join("\n") || undefined}
            onKeyDown={openOnEnter(setOpen)}
            data-testid={`agent-fallbacks-${agent.id}`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1">
              {first ? (
                <FallbackChip index={0} display={describeModelValue(first, settings.modelOptions)} />
              ) : (
                <span className="truncate text-muted-foreground">None</span>
              )}
              {rest.length > 0 ? (
                <span
                  className="shrink-0 rounded border border-border px-1 text-(length:--text-micro) leading-4 tabular-nums text-muted-foreground"
                  data-testid={`agent-fallbacks-${agent.id}-overflow`}
                >
                  +{rest.length}
                </span>
              ) : null}
            </span>
            <CellAffordance pending={pending} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--sz-24rem) max-w-(--radix-popover-content-available-width) space-y-2 p-3">
          <FallbackEditor agent={agent} settings={settings} controller={controller} pending={pending} />
        </PopoverContent>
      </Popover>
    </RowIsolation>
  );
}

function FallbackEditor({ agent, settings, controller, pending }: CellProps & { pending: boolean }) {
  const field = settings.fallbackField!;
  const maxItems = field.list?.maxItems ?? AGENT_FALLBACK_MODELS_MAX;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{field.label}</span>
        <ModelListCount count={settings.fallbacks.length} max={maxItems} />
      </div>
      <div className={cn(pending && "pointer-events-none opacity-60")} aria-busy={pending || undefined}>
        <ModelListField
          value={settings.fallbacks}
          options={settings.modelOptions}
          maxItems={maxItems}
          primary={settings.model}
          onChange={(next) => controller.saveMany(agent, AGENT_FALLBACK_MODELS_KEY, {
            [AGENT_FALLBACK_MODELS_KEY]: next,
            [AGENT_FALLBACK_EFFORTS_KEY]: fitAgentFallbackEfforts(settings.fallbackEfforts, next),
          })}
          label={field.label}
          testId={`agent-fallbacks-editor-${agent.id}`}
          currentEfforts={settings.fallbackEfforts}
          onEffortChange={(selector, effort) => {
            const next = { ...settings.fallbackEfforts };
            if (effort) next[selector] = effort;
            else delete next[selector];
            controller.save(agent, AGENT_FALLBACK_EFFORTS_KEY, next);
          }}
        />
      </div>
    </>
  );
}

interface CellProps {
  agent: Agent;
  settings: AgentModelSettings;
  controller: AgentModelSettingsController;
}

/** Model, fallback and effort cells for one agents-table row. */
export function AgentModelColumns({ agent, controller }: { agent: Agent; controller: AgentModelSettingsController }) {
  const settings = controller.settingsFor(agent);
  return (
    <>
      <div className={AGENT_MODEL_COLUMN_CLASSES.model}>
        <ModelCell agent={agent} settings={settings} controller={controller} />
      </div>
      <div className={AGENT_MODEL_COLUMN_CLASSES.fallbacks}>
        <FallbacksCell agent={agent} settings={settings} controller={controller} />
      </div>
    </>
  );
}

/** Narrow-width "Model · effort" line with an edit button that opens every model editor. */
export function AgentModelSummary({ agent, controller }: { agent: Agent; controller: AgentModelSettingsController }) {
  const settings = controller.settingsFor(agent);
  const editable = Boolean(settings.modelField || settings.fallbackField || settings.effortField);
  const modelText = settings.model ? modelValueText(describeModelValue(settings.model, settings.modelOptions)) : null;
  const parts = [modelText ?? (editable ? "Adapter default" : null), settings.effort].filter(Boolean);
  const fallbackCount = settings.fallbacks.length;
  if (parts.length === 0 && !editable) return null;
  const pending =
    controller.isPending(agent.id, "model") ||
    controller.isPending(agent.id, AGENT_FALLBACK_MODELS_KEY) ||
    controller.isPending(agent.id, AGENT_EFFORT_KEY);
  return (
    <RowIsolation className="flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground" >
      <span className="min-w-0 truncate" title={settings.model ?? undefined} data-testid={`agent-model-summary-${agent.id}`}>
        {parts.join(" · ")}
        {fallbackCount > 0 ? ` · +${fallbackCount} fallback${fallbackCount === 1 ? "" : "s"}` : ""}
      </span>
      {pending ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" /> : null}
      {editable ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label={`Edit models for ${agent.name}`}
              data-testid={`agent-model-summary-edit-${agent.id}`}
            >
              <Pencil aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={8}
            className="w-(--sz-20rem) max-w-(--radix-popover-content-available-width) space-y-3 p-3"
          >
            {settings.modelField ? (
              <div className="space-y-1">
                <span className="text-xs font-medium">Model</span>
                <ComboboxField
                  value={settings.model ?? ""}
                  options={settings.modelOptions}
                  onChange={(next) => controller.save(agent, "model", next || null)}
                  label={`Model for ${agent.name}`}
                  emptyLabel="Adapter default"
                  searchPlaceholder={MODEL_SEARCH_PLACEHOLDER}
                  clearable={false}
                  testId={`agent-model-summary-model-${agent.id}`}
                  effort={settings.effortField
                    ? { value: settings.effort, onChange: (next) => controller.save(agent, AGENT_EFFORT_KEY, next) }
                    : undefined}
                />
              </div>
            ) : null}
            {settings.fallbackField ? (
              <div className="space-y-1">
                <FallbackEditor
                  agent={agent}
                  settings={settings}
                  controller={controller}
                  pending={controller.isPending(agent.id, AGENT_FALLBACK_MODELS_KEY)}
                />
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}
    </RowIsolation>
  );
}
