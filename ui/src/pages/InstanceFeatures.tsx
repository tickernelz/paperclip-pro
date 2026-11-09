import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  FEATURE_GROUPS,
  FEATURE_PRESET_IDS,
  activeFeaturePreset,
  featureDependents,
  featureKeysWithDestination,
  featurePlacement,
  featurePresetPatch,
  missingFeatureRequirements,
  type FeatureGroup,
  type FeaturePresetId,
  type InstanceFeatureKey,
  type PatchInstanceExperimentalSettings,
} from "@tickernelz/wardmote-shared";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FeatureSettingGroup, FeatureSettingRow } from "@/components/FeatureSettingRow";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useInstanceFeatureSettings } from "@/hooks/useInstanceFeatureSettings";
import { INSTANCE_SETTINGS_PATH_PREFIX } from "@/lib/instance-settings";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";

const GROUP_LABELS: Record<FeatureGroup, string> = {
  collaboration: "Working together",
  automation: "Automation",
  integrations: "Integrations",
  workspace: "Workspaces",
  display: "Display",
};

const PRESET_LABELS: Record<FeaturePresetId, string> = {
  minimal: "Minimal",
  standard: "Standard",
  everything: "Everything",
};

const FEATURE_KEYS = featureKeysWithDestination("features");

function featureName(key: InstanceFeatureKey): string {
  return featurePlacement(key, "features")?.name ?? key;
}

export function InstanceFeatures() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const features = useInstanceFeatureSettings();
  const [search, setSearch] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings", href: "/company/settings" }, { label: "Features" }]);
  }, [setBreadcrumbs]);

  const visibleKeys = FEATURE_KEYS.filter((key) => !features.isHidden(key));

  const term = search.trim().toLowerCase();
  const matches = (key: InstanceFeatureKey) => {
    if (!term) return true;
    const placement = featurePlacement(key, "features");
    return [placement?.name, placement?.summary, placement?.whenOn, key]
      .some((text) => text?.toLowerCase().includes(term));
  };

  if (features.query.isLoading) {
    return <div className="text-sm text-ink-3">Loading features...</div>;
  }
  if (features.query.error) {
    return <div className="text-sm text-bad">{features.query.error.message || "Failed to load features."}</div>;
  }

  const settings = features.settings ?? {};
  const onCount = visibleKeys.filter(features.isOn).length;
  const activePreset = activeFeaturePreset(settings);

  const applyPreset = (preset: FeaturePresetId) => {
    const patch = Object.fromEntries(
      Object.entries(featurePresetPatch(preset)).filter(
        ([key]) => !features.isHidden(key as InstanceFeatureKey),
      ),
    ) as PatchInstanceExperimentalSettings;
    features.save(patch);
  };

  const toggle = (key: InstanceFeatureKey, next: boolean) => {
    const patch: Record<string, boolean> = { [key]: next };
    if (next) {
      for (const required of missingFeatureRequirements(key, settings)) patch[required] = true;
    } else {
      const disable = (from: InstanceFeatureKey) => {
        for (const dependent of featureDependents(from)) {
          if (patch[dependent] === false) continue;
          patch[dependent] = false;
          disable(dependent);
        }
      };
      disable(key);
    }
    features.save(patch as PatchInstanceExperimentalSettings);
  };

  const groups = FEATURE_GROUPS.map((group) => ({
    group,
    keys: visibleKeys.filter((key) => featurePlacement(key, "features")?.group === group),
  })).filter(({ keys }) => keys.length > 0);
  const matchedGroups = groups
    .map(({ group, keys }) => ({ group, keys, shown: keys.filter(matches) }))
    .filter(({ shown }) => shown.length > 0);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Features</h1>
        <p className="text-sm text-ink-3">
          {onCount} of {visibleKeys.length} on. Turning one off hides it; nothing is deleted.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="group" aria-label="Preset" className="inline-flex shrink-0 rounded-md border border-line p-0.5">
          {FEATURE_PRESET_IDS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={activePreset === preset}
              disabled={features.pending}
              onClick={() => applyPreset(preset)}
              className={cn(
                "rounded-(--rad-4) px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed",
                activePreset === preset
                  ? "bg-bg-3 font-medium text-ink"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <label className="relative flex-1">
          <span className="sr-only">Search features</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search features"
            className="pl-8"
          />
        </label>
      </div>

      {features.error ? (
        <div role="alert" className="rounded-md border border-bad/40 px-3 py-2 text-sm text-bad">
          {features.error}
        </div>
      ) : null}

      {matchedGroups.length === 0 ? (
        <p className="text-sm text-ink-3">No feature matches "{search.trim()}".</p>
      ) : (
        matchedGroups.map(({ group, keys, shown }) => (
          <FeatureSettingGroup
            key={group}
            id={`feature-group-${group}`}
            title={GROUP_LABELS[group]}
            meta={`${keys.filter(features.isOn).length} of ${keys.length} on`}
          >
            {shown.map((key) => {
              const placement = featurePlacement(key, "features")!;
              const on = features.isOn(key);
              const missing = missingFeatureRequirements(key, settings);
              const lockedUnfinished = !placement.finished && !on;
              return (
                <FeatureSettingRow
                  key={key}
                  name={placement.name}
                  summary={placement.summary}
                  checked={on}
                  disabled={features.pending || lockedUnfinished}
                  onCheckedChange={(next) => toggle(key, next)}
                  status={on ? placement.whenOn : placement.whenOff}
                  badges={
                    <>
                      {placement.finished ? null : <Badge variant="secondary">Not finished yet</Badge>}
                    </>
                  }
                >
                  {placement.requires.length > 0 ? (
                    <p className="text-xs text-ink-3">
                      Needs {placement.requires.map(featureName).join(" and ")}
                      {missing.length > 0 ? "; turning this on turns it on too." : "."}
                    </p>
                  ) : null}
                  {key === "enableIsolatedWorkspaces" && on ? (
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={features.isOn("enableIsolatedWorkspacesByDefault")}
                        disabled={features.pending}
                        onCheckedChange={(checked) =>
                          features.save({ enableIsolatedWorkspacesByDefault: checked === true })
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">Use for new projects</span>
                        <span className="block text-ink-3">
                          Projects without their own workspace policy get isolated workspaces.
                        </span>
                      </span>
                    </label>
                  ) : null}
                </FeatureSettingRow>
              );
            })}
          </FeatureSettingGroup>
        ))
      )}

      <p className="text-sm text-ink-3">
        Runtime and developer switches are in{" "}
        <Link to={`${INSTANCE_SETTINGS_PATH_PREFIX}/advanced`} className="underline underline-offset-4">
          Advanced
        </Link>
        .
      </p>
    </div>
  );
}
