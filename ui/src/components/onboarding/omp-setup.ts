import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  AdapterEnvironmentTestResult,
  IssueRunModelOverrideOption,
} from "@tickernelz/paperclip-pro-shared";
import type { AdapterModel } from "@tickernelz/paperclip-pro-adapter-utils";

import { agentsApi } from "../../api/agents";
import { queryKeys } from "../../lib/queryKeys";

/** The adapter type onboarding steers new installs to. */
export const OMP_ADAPTER_TYPE = "omp_local";

/** Where the OMP connect panel stands, from first probe to a pickable model list. */
export type OmpSetupStatus =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "broken"; reason: string }
  | { kind: "no-models"; version: string | null }
  | { kind: "ready"; version: string | null };

type OmpDetection =
  | { kind: "missing" }
  | { kind: "broken"; reason: string }
  | { kind: "installed"; version: string | null };

const OMP_VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/;

/** Reads the omp_local environment probe as installed, missing, or not working. */
export function classifyOmpEnvironment(result: AdapterEnvironmentTestResult): OmpDetection {
  const check = (code: string) => result.checks.find((entry) => entry.code === code);
  if (check("omp_command_unresolvable")) return { kind: "missing" };
  const ready = check("omp_version_ok");
  if (ready) return { kind: "installed", version: ready.message.match(OMP_VERSION_PATTERN)?.[0] ?? null };
  const failure = result.checks.find((entry) => entry.level === "error");
  return { kind: "broken", reason: failure?.message ?? "OMP did not report a version." };
}

/** Picker options for OMP models, grouped by provider with the bare display name. */
export function ompModelOptions(models: readonly AdapterModel[]): IssueRunModelOverrideOption[] {
  return models.map((model) => {
    const named = model.label !== model.id;
    return {
      value: model.id,
      label: named ? `${model.label} (${model.id})` : model.id,
      ...(model.provider ? { group: model.provider } : {}),
      ...(named ? { name: model.label } : {}),
    };
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Detects OMP for the company's default environment and lists its models; never installs anything. */
export function useOmpSetup(companyId: string | null, enabled: boolean) {
  const [round, setRound] = useState(0);
  const active = enabled && Boolean(companyId);

  const detection = useQuery({
    queryKey: ["agents", companyId ?? "none", "omp-onboarding-detection", round],
    queryFn: () =>
      agentsApi.testEnvironment(companyId!, OMP_ADAPTER_TYPE, { adapterConfig: {}, environmentId: null }),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  const detected = detection.data && !detection.isPlaceholderData ? classifyOmpEnvironment(detection.data) : null;
  const shown = detection.data ? classifyOmpEnvironment(detection.data) : null;

  const models = useQuery({
    queryKey: [...queryKeys.agents.adapterModels(companyId ?? "none", OMP_ADAPTER_TYPE, null), round],
    queryFn: () =>
      agentsApi.adapterModels(companyId!, OMP_ADAPTER_TYPE, {
        environmentId: null,
        ...(round > 0 ? { refresh: true } : {}),
      }),
    enabled: active && detected?.kind === "installed",
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });

  let status: OmpSetupStatus;
  if (detection.error) {
    status = { kind: "error", message: errorMessage(detection.error, "The OMP check failed.") };
  } else if (!shown) {
    status = { kind: "checking" };
  } else if (shown.kind !== "installed") {
    status = shown;
  } else if (models.data) {
    status = models.data.length > 0
      ? { kind: "ready", version: shown.version }
      : { kind: "no-models", version: shown.version };
  } else if (models.error) {
    status = { kind: "error", message: errorMessage(models.error, "OMP could not list its models.") };
  } else {
    status = { kind: "checking" };
  }

  return {
    status,
    options: ompModelOptions(models.data ?? []),
    rechecking: round > 0 && (detection.isFetching || models.isFetching),
    recheck: () => setRound((value) => value + 1),
  };
}
