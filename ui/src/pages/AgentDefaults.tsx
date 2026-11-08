import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  OMP_CONTROL_IDS,
  OMP_ADAPTER_SETTINGS,
  OMP_CONTROL_PATHS,
  OMP_STYLE_PRESETS,
  agentDiffersFromDefaults,
  applyAgentSettingsPatch,
  defaultsAsConfig,
  planAgentDefaultsApply,
  type AgentSettingsPatch,
} from "@tickernelz/wardmote-shared";
import { agentDefaultsApi } from "@/api/agentDefaults";
import { agentsApi } from "@/api/agents";
import { ChoiceControl, ChoiceRow, SaveBar } from "@/components/omp-settings/ChoiceControls";
import {
  CONTROL_LABELS,
  OMP_ADAPTER_TYPE,
  changedControls,
  settingsValuesFromConfig,
  useAgentDefaults,
  useOmpModels,
  useOmpSettingsCatalog,
} from "@/components/omp-settings/omp-settings-model";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

function PresetUsageTable({ companyId }: { companyId: string }) {
  const usage = useQuery({
    queryKey: queryKeys.agentDefaults.presetUsage(companyId),
    queryFn: () => agentDefaultsApi.presetUsage(companyId),
  });
  const rows = usage.data?.rows ?? [];
  return (
    <section aria-labelledby="preset-usage-title" className="overflow-hidden rounded-lg border border-line bg-bg-2">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
        <h2 id="preset-usage-title" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Style presets, last 7 days
        </h2>
      </div>
      {usage.isLoading ? (
        <p className="px-4 py-3 text-sm text-ink-3 sm:px-5">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-3 sm:px-5">No runs with a Style preset yet. Numbers appear once agents run with one.</p>
      ) : (
        <div className="px-4 sm:px-5">
          <table aria-label="Style presets, last 7 days" className="stack-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-2 font-medium">Preset</th>
                <th className="py-2 font-medium">Runs</th>
                <th className="py-2 font-medium">Avg duration</th>
                <th className="py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.preset} className="border-t border-line">
                  <td data-cell="title">{OMP_STYLE_PRESETS[row.preset as keyof typeof OMP_STYLE_PRESETS]?.label ?? row.preset}</td>
                  <td data-cell="meta" data-label="Runs">{row.runs}</td>
                  <td data-cell="meta" data-label="Avg">{formatDuration(row.avgDurationSec)}</td>
                  <td data-cell="end" className="text-right tabular-nums">{formatCost(row.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AgentDefaults() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const defaults = useAgentDefaults(selectedCompanyId);
  const models = useOmpModels(selectedCompanyId);
  const catalog = useOmpSettingsCatalog(selectedCompanyId);
  const agents = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId ?? ""),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const [draft, setDraft] = useState<AgentSettingsPatch>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings", href: "/company/settings" }, { label: "Agent defaults" }]);
  }, [setBreadcrumbs]);

  const values = defaults.data?.values ?? {};
  const base = useMemo(() => defaultsAsConfig(values), [values]);
  const effective = useMemo(() => applyAgentSettingsPatch(base, draft), [base, draft]);
  const ompAgents = useMemo(
    () => (agents.data ?? [])
      .filter((agent) => agent.adapterType === OMP_ADAPTER_TYPE && agent.status !== "terminated")
      .map((agent) => ({ id: agent.id, name: agent.name, adapterConfig: (agent.adapterConfig ?? {}) as Record<string, unknown> })),
    [agents.data],
  );
  const nextValues = useMemo(() => settingsValuesFromConfig(effective), [effective]);
  const plan = useMemo(() => planAgentDefaultsApply(ompAgents, values, nextValues), [ompAgents, values, nextValues]);
  const dirtyControls = changedControls(base, effective);

  const save = useMutation({
    mutationFn: () => agentDefaultsApi.save(selectedCompanyId!, nextValues),
    onSuccess: async () => {
      setDraft({});
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agentDefaults.values(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: ["agents", "detail"] }),
      ]);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Defaults were not saved."),
  });

  if (!selectedCompanyId) return null;
  if (defaults.isLoading) return <div className="text-sm text-ink-3">Loading agent defaults...</div>;
  if (defaults.error) return <div className="text-sm text-bad">{defaults.error.message || "Failed to load agent defaults."}</div>;

  const ownCount = ompAgents.filter((agent) => agentDiffersFromDefaults(agent.adapterConfig, values, OMP_CONTROL_IDS.flatMap((control) => [...OMP_CONTROL_PATHS[control]]))).length;
  const settingCount = (catalog.data?.settings.length ?? 0) + OMP_ADAPTER_SETTINGS.length;

  return (
    <div className="max-w-4xl space-y-5 pb-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Agent defaults</h1>
        <p className="text-sm text-ink-3">
          Every OMP agent starts from these. {plural(ownCount, "agent")} {ownCount === 1 ? "has" : "have"} its own values for some of them.
        </p>
      </div>

      {models.error ? (
        <div role="alert" className="rounded-md border border-warn px-3 py-2 text-sm text-ink-2">
          OMP did not report its models: {models.error.message}. Model choices stay empty until it does.
        </div>
      ) : null}

      <section aria-label="Agent defaults" className="overflow-hidden rounded-lg border border-line bg-bg-2">
        {OMP_CONTROL_IDS.map((control) => {
          const following = ompAgents.filter((agent) => !agentDiffersFromDefaults(agent.adapterConfig, values, OMP_CONTROL_PATHS[control])).length;
          return (
            <ChoiceRow
              key={control}
              label={CONTROL_LABELS[control].label}
              sub={
                <>
                  {CONTROL_LABELS[control].help}
                  {ompAgents.length > 0 ? <span className="block text-xs">{plural(following, "agent")} follow this</span> : null}
                </>
              }
            >
              <ChoiceControl
                control={control}
                config={effective}
                models={models.data ?? []}
                disabled={save.isPending}
                onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              />
            </ChoiceRow>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link to="/company/settings/agent-defaults/all" className="inline-flex min-h-6 items-center gap-1 text-sm text-accent underline underline-offset-4">
          All settings{catalog.data ? ` (${settingCount})` : ""}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
        <span className="text-sm text-ink-3">For people who know OMP keys</span>
      </div>

      <PresetUsageTable companyId={selectedCompanyId} />

      {dirtyControls.length > 0 ? (
        <SaveBar
          saving={save.isPending}
          error={error}
          onDiscard={() => {
            setDraft({});
            setError(null);
          }}
          onSave={() => save.mutate()}
          summary={
            <span>
              <b>{plural(dirtyControls.length, "change")}</b>
              {" · applies to "}{plural(plan.following, "agent")}
              {plan.ownValues > 0 ? ` · ${plural(plan.ownValues, "agent")} ${plan.ownValues === 1 ? "keeps its" : "keep their"} own value` : ""}
              {" · "}{plan.following === 0 ? "no session changes" : plan.sessionKept ? "keeps their sessions" : "their next run starts a new session"}
            </span>
          }
        />
      ) : null}
    </div>
  );
}
