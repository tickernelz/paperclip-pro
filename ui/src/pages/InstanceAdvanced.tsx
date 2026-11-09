import { useEffect } from "react";
import { AlertTriangle, Play, RotateCcw } from "lucide-react";
import {
  ADVANCED_GROUPS,
  INSTANCE_FEATURE_CATALOG,
  featureKeysWithDestination,
  featurePlacement,
  type AdvancedGroup,
  type InstanceExperimentalSettings,
  type InstanceFeatureKey,
  type PatchInstanceExperimentalSettings,
} from "@tickernelz/wardmote-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeatureSettingGroup, FeatureSettingRow } from "@/components/FeatureSettingRow";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useInstanceFeatureSettings } from "@/hooks/useInstanceFeatureSettings";
import { getWorktreeInstanceId, isWorktreeRuntime } from "@/lib/worktree-branding";

const GROUP_LABELS: Record<AdvancedGroup, string> = {
  developer: "Developer",
  runtime: "Runtime",
};

const ADVANCED_KEYS = featureKeysWithDestination("advanced");

type WorktreeRunExecutionDisplayState =
  | { kind: "off" }
  | { kind: "armed"; activatedAt: string }
  | { kind: "fail_closed"; reason: "missing_cutoff" | "missing_instance_id" | "instance_mismatch" };

function resolveWorktreeRunExecutionDisplayState(
  settings:
    | Pick<
        InstanceExperimentalSettings,
        "enableWorktreeRunExecution" | "worktreeRunExecutionActivatedAt" | "worktreeRunExecutionActivationInstanceId"
      >
    | undefined,
  currentInstanceId: string | null,
): WorktreeRunExecutionDisplayState {
  if (settings?.enableWorktreeRunExecution !== true) return { kind: "off" };
  if (!settings.worktreeRunExecutionActivatedAt) return { kind: "fail_closed", reason: "missing_cutoff" };
  if (!currentInstanceId) return { kind: "fail_closed", reason: "missing_instance_id" };
  if (settings.worktreeRunExecutionActivationInstanceId !== currentInstanceId) {
    return { kind: "fail_closed", reason: "instance_mismatch" };
  }
  return { kind: "armed", activatedAt: settings.worktreeRunExecutionActivatedAt };
}

function formatActivationTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function WorktreeRunExecutionState({ state }: { state: WorktreeRunExecutionDisplayState }) {
  if (state.kind === "armed") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
        <Play aria-hidden="true" className="size-4 shrink-0 text-(--status-task-done)" />
        <span>
          Running tasks created after <span className="font-medium">{formatActivationTimestamp(state.activatedAt)}</span>.
        </span>
      </div>
    );
  }
  if (state.kind === "fail_closed") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-sm">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <div className="space-y-0.5">
          <p className="font-medium">Execution is suppressed, so it is effectively off.</p>
          <p className="text-ink-3">
            {state.reason === "instance_mismatch"
              ? "This was turned on in a different instance and copied here, so no tasks run automatically."
              : "This is missing its activation cutoff, so no tasks run automatically."}{" "}
            Turn it off and on again to run tasks created here.
          </p>
        </div>
      </div>
    );
  }
  return null;
}

export function InstanceAdvanced() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const features = useInstanceFeatureSettings();

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings", href: "/company/settings" }, { label: "Advanced" }]);
  }, [setBreadcrumbs]);

  if (features.query.isLoading) {
    return <div className="text-sm text-ink-3">Loading advanced settings...</div>;
  }
  if (features.query.error) {
    return (
      <div className="text-sm text-bad">{features.query.error.message || "Failed to load advanced settings."}</div>
    );
  }

  const inWorktree = isWorktreeRuntime();
  const visibleKeys = ADVANCED_KEYS.filter(
    (key) => !features.isHidden(key) && (key !== "enableWorktreeRunExecution" || inWorktree),
  );
  const defaultOf = (key: InstanceFeatureKey) => INSTANCE_FEATURE_CATALOG[key].selfHostedDefault;
  const changed = (key: InstanceFeatureKey) => features.isOn(key) !== defaultOf(key);
  const resettable = visibleKeys.filter(changed);

  const reset = () => {
    features.save(
      Object.fromEntries(resettable.map((key) => [key, defaultOf(key)])) as PatchInstanceExperimentalSettings,
    );
  };

  const groups = ADVANCED_GROUPS.map((group) => ({
    group,
    keys: visibleKeys.filter((key) => featurePlacement(key, "advanced")?.group === group),
  })).filter(({ keys }) => keys.length > 0);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Advanced</h1>
          <p className="text-sm text-ink-3">Tools for people who run or develop this instance.</p>
        </div>
        <Button variant="secondary" disabled={features.pending || resettable.length === 0} onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Reset to defaults
        </Button>
      </div>

      <div role="note" className="flex items-start gap-3 rounded-lg border border-line bg-bg-2 px-4 py-3 text-sm">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <p>
          These change how runs are executed or show internal data. Leave them alone unless you know why you need one.
        </p>
      </div>

      {features.error ? (
        <div role="alert" className="rounded-md border border-bad/40 px-3 py-2 text-sm text-bad">
          {features.error}
        </div>
      ) : null}

      {groups.map(({ group, keys }) => (
        <FeatureSettingGroup key={group} id={`advanced-group-${group}`} title={GROUP_LABELS[group]}>
          {keys.map((key) => {
            const placement = featurePlacement(key, "advanced")!;
            return (
              <FeatureSettingRow
                key={key}
                name={placement.name}
                summary={placement.summary}
                checked={features.isOn(key)}
                disabled={features.pending}
                onCheckedChange={(next) => features.save({ [key]: next } as PatchInstanceExperimentalSettings)}
                badges={
                  <>
                    {changed(key) ? <Badge variant="outline">changed</Badge> : null}
                  </>
                }
              >
                {key === "enableWorktreeRunExecution" ? (
                  <WorktreeRunExecutionState
                    state={resolveWorktreeRunExecutionDisplayState(features.settings, getWorktreeInstanceId())}
                  />
                ) : null}
              </FeatureSettingRow>
            );
          })}
        </FeatureSettingGroup>
      ))}
    </div>
  );
}
