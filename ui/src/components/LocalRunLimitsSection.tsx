import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INSTANCE_DEFAULT_LOCAL_START_WAIT_BYPASS_SEC,
  INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_RUNS,
  INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_STARTS,
  INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MAX,
  INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MIN,
  INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MAX,
  INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MIN,
  INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MAX,
  INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MIN,
  type LocalRunLimitKey,
  type LocalRunLimitSource,
  type LocalRunLimitsSettings,
} from "@tickernelz/paperclip-pro-shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";

const FIELDS: ReadonlyArray<{
  key: LocalRunLimitKey;
  label: string;
  min: number;
  max: number;
  fallback: number;
}> = [
  {
    key: "maxConcurrentRuns",
    label: "Max running local runs",
    min: INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MIN,
    max: INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MAX,
    fallback: INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_RUNS,
  },
  {
    key: "maxConcurrentStarts",
    label: "Max runs starting at once",
    min: INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MIN,
    max: INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MAX,
    fallback: INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_STARTS,
  },
  {
    key: "startWaitBypassSec",
    label: "Start wait bypass (seconds)",
    min: INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MIN,
    max: INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MAX,
    fallback: INSTANCE_DEFAULT_LOCAL_START_WAIT_BYPASS_SEC,
  },
];

const SOURCE_LABELS: Record<LocalRunLimitSource, string> = {
  env: "environment variable",
  setting: "set here",
  default: "built-in default",
};

type Draft = Record<LocalRunLimitKey, string>;

function toDraft(value: LocalRunLimitsSettings): Draft {
  return {
    maxConcurrentRuns: value.maxConcurrentRuns === null ? "" : String(value.maxConcurrentRuns),
    maxConcurrentStarts: value.maxConcurrentStarts === null ? "" : String(value.maxConcurrentStarts),
    startWaitBypassSec: value.startWaitBypassSec === null ? "" : String(value.startWaitBypassSec),
  };
}

function parseLimit(raw: string, min: number, max: number): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

/** Instance-wide caps on local CLI agent runs; changes apply to the next admission without a restart. */
export function LocalRunLimitsSection({
  value,
  disabled = false,
}: {
  value: LocalRunLimitsSettings;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const initial = toDraft(value);
  const [draft, setDraft] = useState<Draft>(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const effectiveQuery = useQuery({
    queryKey: queryKeys.instance.localRunLimits,
    queryFn: () => instanceSettingsApi.getLocalRunLimits(),
  });
  const effective = effectiveQuery.data;
  const save = useMutation({
    mutationFn: (next: LocalRunLimitsSettings) => instanceSettingsApi.updateGeneral({ localRuns: next }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.localRunLimits }),
      ]);
    },
  });

  const envLocked = (key: LocalRunLimitKey) => effective?.[key].source === "env";
  const dirty = FIELDS.some(({ key }) => draft[key].trim() !== initial[key]);
  const busy = disabled || save.isPending;

  const submit = () => {
    const next: LocalRunLimitsSettings = { ...value };
    for (const field of FIELDS) {
      if (envLocked(field.key)) continue;
      const parsed = parseLimit(draft[field.key], field.min, field.max);
      if (parsed === undefined) {
        setValidationError(
          `${field.label}: enter a whole number from ${field.min} to ${field.max}, or leave it blank to use the default.`,
        );
        return;
      }
      next[field.key] = parsed;
    }
    setValidationError(null);
    save.mutate(next);
  };

  const shownError = validationError
    ?? (save.error instanceof Error && save.error.message ? save.error.message : save.error ? "Failed to save local run limits." : null);

  return (
    <section>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold">Local run limits</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cap how many local CLI agent runs this instance runs at once and how many may be starting up together.
            Changes apply to the next run admission without a restart; lowering a limit never stops runs that are
            already running. Leave a field blank to use the built-in default. A server environment variable, when
            set, overrides the value saved here.
          </p>
        </div>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            {FIELDS.map((field) => {
              const current = effective?.[field.key];
              const locked = current?.source === "env";
              return (
                <label key={field.key} className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={locked ? String(current.value) : draft[field.key]}
                    placeholder={`Default (${field.fallback})`}
                    aria-label={field.label}
                    readOnly={locked}
                    disabled={busy || locked}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setDraft((prev) => ({ ...prev, [field.key]: nextValue }));
                      setValidationError(null);
                    }}
                  />
                  {locked ? (
                    <span className="block text-xs text-muted-foreground" data-testid={`local-run-limit-env-${field.key}`}>
                      Overridden by the {current.envVar} environment variable. Unset it to manage this here.
                    </span>
                  ) : current ? (
                    <span className="block text-xs text-muted-foreground" data-testid={`local-run-limit-effective-${field.key}`}>
                      In force: <span className="font-medium tabular-nums">{current.value}</span> ({SOURCE_LABELS[current.source]}).
                      Range {field.min}–{field.max}.
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !dirty}>
              {save.isPending ? "Saving..." : "Save local run limits"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(initial);
                setValidationError(null);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
        {shownError ? (
          <p role="alert" className="text-sm text-destructive">{shownError}</p>
        ) : null}
      </div>
    </section>
  );
}
