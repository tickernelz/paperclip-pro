import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RotateCcw } from "lucide-react";
import {
  OMP_CONTROL_IDS,
  OMP_CONTROL_PATHS,
  agentDiffersFromDefaults,
  agentSettingsKeepSession,
  applyAgentSettingsPatch,
  defaultsAsConfig,
  resetToDefaultsPatch,
  type Agent,
  type AgentSettingsPatch,
} from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { ChoiceControl, ChoiceRow, SaveBar } from "@/components/omp-settings/ChoiceControls";
import {
  CONTROL_LABELS,
  OMP_ADAPTER_TYPE,
  changedControls,
  changedPaths,
  describeChoice,
  omitUndefined,
  useAgentDefaults,
  useOmpModels,
} from "@/components/omp-settings/omp-settings-model";
import { OmpAllSettings } from "@/pages/OmpAllSettings";
import { useLocation, useNavigate } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function AgentSetupTab({ agent, companyId }: { agent: Agent; companyId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const showAll = new URLSearchParams(location.search).get("view") === "all";
  if (agent.adapterType !== OMP_ADAPTER_TYPE) {
    return <p className="text-sm text-ink-3">Setup covers OMP agents. This agent uses {agent.adapterType}.</p>;
  }
  if (showAll) {
    return (
      <OmpAllSettings
        scope={{ kind: "agent", agent, companyId }}
        onBack={() => navigate(location.pathname)}
      />
    );
  }
  return <AgentSetupChoices agent={agent} companyId={companyId} onShowAll={() => navigate(`${location.pathname}?view=all`)} />;
}

function AgentSetupChoices({ agent, companyId, onShowAll }: { agent: Agent; companyId: string; onShowAll: () => void }) {
  const queryClient = useQueryClient();
  const defaults = useAgentDefaults(companyId);
  const models = useOmpModels(companyId);
  const [draft, setDraft] = useState<AgentSettingsPatch>({});
  const [error, setError] = useState<string | null>(null);
  const values = defaults.data?.values ?? {};
  const defaultsConfig = useMemo(() => defaultsAsConfig(values), [values]);
  const base = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  const effective = useMemo(() => applyAgentSettingsPatch(base, draft), [base, draft]);
  const dirty = changedControls(base, effective);
  const allPaths = OMP_CONTROL_IDS.flatMap((control) => [...OMP_CONTROL_PATHS[control]]);
  const changedCount = OMP_CONTROL_IDS.filter((control) => agentDiffersFromDefaults(effective, values, OMP_CONTROL_PATHS[control])).length;

  const save = useMutation({
    mutationFn: () => agentsApi.update(agent.id, { adapterConfig: omitUndefined(effective), replaceAdapterConfig: true }, companyId),
    onSuccess: async () => {
      setDraft({});
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agents", "detail"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) }),
      ]);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Setup was not saved."),
  });

  if (defaults.isLoading) return <div className="text-sm text-ink-3">Loading setup...</div>;

  return (
    <div className="max-w-4xl space-y-5 pb-4">
      <p className="text-sm text-ink-3">
        {changedCount === 0 ? "Uses the company defaults." : `Uses the company defaults except ${plural(changedCount, "setting")}.`}
      </p>
      <section aria-label="Setup" className="overflow-hidden rounded-lg border border-line bg-bg-2">
        {OMP_CONTROL_IDS.map((control) => (
          <ChoiceRow
            key={control}
            label={CONTROL_LABELS[control].label}
            sub={`Default: ${describeChoice(control, defaultsConfig, models.data ?? [])}`}
            changed={agentDiffersFromDefaults(effective, values, OMP_CONTROL_PATHS[control])}
            onReset={() => setDraft((current) => ({ ...current, ...resetToDefaultsPatch(values, OMP_CONTROL_PATHS[control]) }))}
          >
            <ChoiceControl
              control={control}
              config={effective}
              models={models.data ?? []}
              disabled={save.isPending}
              onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
          </ChoiceRow>
        ))}
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={changedCount === 0 || save.isPending}
          onClick={() => setDraft((current) => ({ ...current, ...resetToDefaultsPatch(values, allPaths) }))}
        >
          <RotateCcw aria-hidden="true" />
          Reset all to defaults
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="link" size="sm" onClick={onShowAll}>
          All settings for {agent.name}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      {dirty.length > 0 ? (
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
              <b>{plural(dirty.length, "change")}</b>
              {" · "}{agentSettingsKeepSession(changedPaths(base, effective)) ? "keeps the current session" : "the next run starts a new session"}
            </span>
          }
        />
      ) : null}
    </div>
  );
}
