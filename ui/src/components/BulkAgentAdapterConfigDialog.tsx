import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fitAgentFallbackModels,
  type AgentAdapterConfigBatchFailure,
  type AgentAdapterConfigBatchField,
  type AgentAdapterConfigBatchResult,
  type AgentAdapterConfigBatchTarget,
} from "@tickernelz/paperclip-pro-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineBanner } from "@/components/InlineBanner";
import { agentsApi } from "@/api/agents";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { ModelListField } from "@/adapters/model-picker-fields";
import { describeModelValue, modelValueText } from "@/components/task-chat/model-option-display";

const UNCHANGED = "__unchanged";
const AGENT_DEFAULT = "__agent_default";
const LIST_REPLACE = "__list_replace";
const LIST_CLEAR = "__list_clear";

type BatchValue = string | string[] | null;

function listPrimary(
  field: AgentAdapterConfigBatchField,
  values: Record<string, BatchValue>,
  target: AgentAdapterConfigBatchTarget,
): string | null {
  const key = field.list?.distinctFromKey;
  if (!key) return null;
  const value = key in values ? values[key] : target.current[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function BulkListPreview({
  field,
  mode,
  selected,
  values,
  agents,
}: {
  field: AgentAdapterConfigBatchField;
  mode: typeof LIST_REPLACE | typeof LIST_CLEAR;
  selected: string[];
  values: Record<string, BatchValue>;
  agents: AgentAdapterConfigBatchTarget[];
}) {
  const label = (value: string) => modelValueText(describeModelValue(value, field.options));
  const listText = (list: readonly string[]) => (list.length > 0 ? list.map(label).join(", ") : "none");
  const supported = agents.filter((agent) => !agent.unsupportedKeys?.includes(field.key));
  const skipped = agents.filter((agent) => agent.unsupportedKeys?.includes(field.key));
  return (
    <div className="space-y-1 text-xs" data-testid={`bulk-agent-config-list-preview-${field.key}`}>
      <ul className="space-y-1">
        {supported.map((agent) => {
          const fitted = mode === LIST_REPLACE
            ? fitAgentFallbackModels(selected, listPrimary(field, values, agent))
            : { list: [], dropped: [] };
          return (
            <li key={agent.agentId} data-testid={`bulk-agent-config-list-preview-${field.key}-${agent.agentId}`}>
              <span className="font-medium">{agent.name}</span>
              <span className="text-muted-foreground">
                : {listText(agent.currentLists?.[field.key] ?? [])} → {listText(fitted.list)}
              </span>
              {fitted.dropped.map((value) => (
                <span key={value} className="block text-muted-foreground">
                  {label(value)} dropped for {agent.name}: same as primary
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      {skipped.length > 0 && (
        <p className="text-muted-foreground" data-testid={`bulk-agent-config-list-skipped-${field.key}`}>
          Skipped (no {field.label.toLowerCase()} support): {skipped.map((agent) => agent.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function readFailures(error: unknown): AgentAdapterConfigBatchFailure[] {
  if (!(error instanceof ApiError)) return [];
  const body = error.body as { failures?: AgentAdapterConfigBatchFailure[] } | null;
  return Array.isArray(body?.failures) ? body.failures : [];
}

export function BulkAgentAdapterConfigDialog({
  companyId,
  agentIds,
  open,
  onOpenChange,
  onApplied,
}: {
  companyId: string;
  agentIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<AgentAdapterConfigBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<AgentAdapterConfigBatchFailure[]>([]);

  const preview = useQuery({
    queryKey: queryKeys.agents.adapterConfigBatch(companyId, agentIds),
    queryFn: () => agentsApi.batchAdapterConfigPreview(agentIds),
    enabled: open && agentIds.length > 0,
  });

  const eligible = useMemo(
    () => (preview.data?.agents ?? []).filter((agent) => agent.eligible),
    [preview.data],
  );
  const ineligible = useMemo(
    () => (preview.data?.agents ?? []).filter((agent) => !agent.eligible),
    [preview.data],
  );

  const listKeys = useMemo(
    () => new Set((preview.data?.fields ?? []).filter((field) => field.list).map((field) => field.key)),
    [preview.data],
  );

  const values = useMemo(() => {
    const next: Record<string, BatchValue> = {};
    for (const [key, selection] of Object.entries(selections)) {
      if (selection === UNCHANGED) continue;
      if (listKeys.has(key)) {
        next[key] = selection === LIST_CLEAR ? null : (lists[key] ?? []);
        continue;
      }
      if (selection === AGENT_DEFAULT) {
        next[key] = null;
        continue;
      }
      const text = freeText[key]?.trim();
      next[key] = selection === "__custom" ? (text ?? "") : selection;
    }
    return next;
  }, [selections, freeText, lists, listKeys]);

  const isIncomplete = (value: BatchValue) => value === "" || (Array.isArray(value) && value.length === 0);
  const pendingKeys = Object.keys(values).filter((key) => !isIncomplete(values[key] ?? null));
  const fieldLabel = (key: string) => preview.data?.fields.find((field) => field.key === key)?.label ?? key;
  const describeValue = (key: string, value: BatchValue) => {
    if (Array.isArray(value)) return value.join(", ");
    if (value !== null) return value;
    return listKeys.has(key) ? "cleared" : "adapter default";
  };

  const apply = useMutation({
    mutationFn: () =>
      agentsApi.batchAdapterConfig(
        eligible.map((agent) => agent.agentId),
        values,
      ),
    onSuccess: (next) => {
      setResult(next);
      setError(null);
      setFailures([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      onApplied?.();
    },
    onError: (err) => {
      setFailures(readFailures(err));
      setError(
        err instanceof ApiError ? err.message : "Failed to apply the batch. Nothing changed.",
      );
      setConfirming(false);
    },
  });

  const close = (next: boolean) => {
    if (apply.isPending) return;
    if (!next) {
      setSelections({});
      setFreeText({});
    setLists({});
      setConfirming(false);
      setResult(null);
      setError(null);
      setFailures([]);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-lg" data-testid="bulk-agent-config-dialog">
        <DialogHeader>
          <DialogTitle>Change model / thinking</DialogTitle>
          <DialogDescription data-testid="bulk-agent-config-count">
            {eligible.length} of {agentIds.length} selected agent
            {agentIds.length === 1 ? "" : "s"} can be changed together.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading && <p className="text-sm text-muted-foreground">Loading fields…</p>}

        {result ? (
          <div className="space-y-2" data-testid="bulk-agent-config-results">
            <InlineBanner tone="info" compact>
              {result.updated} updated, {result.unchanged} already had these values.
            </InlineBanner>
            <ul className="space-y-1 text-sm">
              {result.results.map((entry) => (
                <li
                  key={entry.agentId}
                  className="flex items-center justify-between gap-2"
                  data-testid={`bulk-agent-config-result-${entry.agentId}`}
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="text-right text-muted-foreground">
                    {entry.status === "updated" ? entry.changedKeys.join(", ") : "unchanged"}
                    {entry.skippedKeys?.length ? (
                      <span className="block text-xs">
                        skipped: {entry.skippedKeys.map(fieldLabel).join(", ")}
                      </span>
                    ) : null}
                    {Object.entries(entry.droppedValues ?? {}).map(([key, dropped]) =>
                      dropped.length > 0 ? (
                        <span key={key} className="block text-xs">
                          {fieldLabel(key)} dropped (same as primary): {dropped.join(", ")}
                        </span>
                      ) : null,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            {preview.data?.fields.length === 0 && !preview.isLoading && (
              <InlineBanner tone="warning" compact>
                The selected agents share no batch-editable model setting. Select agents that run
                the same harness.
              </InlineBanner>
            )}
            {(preview.data?.fields ?? []).map((field) => field.list ? (
              <div key={field.key} className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`bulk-field-${field.key}`}>
                  {field.label}
                </label>
                <select
                  id={`bulk-field-${field.key}`}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  data-testid={`bulk-agent-config-field-${field.key}`}
                  value={selections[field.key] ?? UNCHANGED}
                  onChange={(event) =>
                    setSelections((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                >
                  <option value={UNCHANGED}>Leave unchanged</option>
                  <option value={LIST_REPLACE}>Replace list</option>
                  <option value={LIST_CLEAR}>Clear list</option>
                </select>
                {selections[field.key] === LIST_REPLACE && (
                  <ModelListField
                    value={lists[field.key] ?? []}
                    options={field.options}
                    maxItems={field.list.maxItems}
                    primary={(() => {
                      const key = field.list.distinctFromKey;
                      const value = key ? values[key] : null;
                      return typeof value === "string" && value.trim() ? value.trim() : null;
                    })()}
                    onChange={(next) => setLists((current) => ({ ...current, [field.key]: next }))}
                    testId={`bulk-agent-config-list-${field.key}`}
                    placeholder={field.hint ?? "Exact selector"}
                  />
                )}
                {(selections[field.key] === LIST_REPLACE || selections[field.key] === LIST_CLEAR) && (
                  <BulkListPreview
                    field={field}
                    mode={selections[field.key] as typeof LIST_REPLACE | typeof LIST_CLEAR}
                    selected={lists[field.key] ?? []}
                    values={values}
                    agents={eligible}
                  />
                )}
              </div>
            ) : (
              <div key={field.key} className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`bulk-field-${field.key}`}>
                  {field.label}
                </label>
                <select
                  id={`bulk-field-${field.key}`}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  data-testid={`bulk-agent-config-field-${field.key}`}
                  value={selections[field.key] ?? UNCHANGED}
                  onChange={(event) =>
                    setSelections((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                >
                  <option value={UNCHANGED}>Leave unchanged</option>
                  <option value={AGENT_DEFAULT}>Clear (use adapter default)</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {field.freeText && <option value="__custom">Custom value…</option>}
                </select>
                {selections[field.key] === "__custom" && (
                  <Input
                    data-testid={`bulk-agent-config-custom-${field.key}`}
                    value={freeText[field.key] ?? ""}
                    placeholder={field.hint ?? "Exact selector"}
                    onChange={(event) =>
                      setFreeText((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}

            {ineligible.length > 0 && (
              <div className="space-y-1" data-testid="bulk-agent-config-skipped">
                <p className="text-xs font-medium text-muted-foreground">
                  Not included ({ineligible.length})
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {ineligible.map((agent) => (
                    <li key={agent.agentId}>
                      {agent.name}: {agent.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {confirming && (
              <InlineBanner tone="warning" compact>
                Apply {pendingKeys.map((key) => `${key} = ${describeValue(key, values[key] ?? null)}`).join(", ")} to{" "}
                {eligible.length} agent{eligible.length === 1 ? "" : "s"}?
              </InlineBanner>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="bulk-agent-config-error">
                {error}
              </p>
            )}
            {failures.length > 0 && (
              <ul className="space-y-0.5 text-xs text-destructive" data-testid="bulk-agent-config-failures">
                {failures.map((failure) => (
                  <li key={`${failure.agentId}-${failure.key ?? "agent"}`}>
                    {failure.name}: {failure.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={apply.isPending}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button
              data-testid="bulk-agent-config-submit"
              disabled={
                apply.isPending ||
                eligible.length === 0 ||
                pendingKeys.length === 0 ||
                Object.values(values).some(isIncomplete)
              }
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                setError(null);
                apply.mutate();
              }}
            >
              {apply.isPending
                ? "Applying…"
                : confirming
                  ? `Apply to ${eligible.length} agent${eligible.length === 1 ? "" : "s"}`
                  : "Review change"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
