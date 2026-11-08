import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceFeatureKey,
  PatchInstanceExperimentalSettings,
} from "@tickernelz/wardmote-shared";
import { experimentalSettingKey } from "@tickernelz/wardmote-shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { queryKeys } from "@/lib/queryKeys";

export function useInstanceFeatureSettings() {
  const queryClient = useQueryClient();
  const { hidden } = useHiddenSettings();
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const mutation = useMutation<
    InstanceExperimentalSettingsWithManaged,
    Error,
    PatchInstanceExperimentalSettings,
    { previous?: InstanceExperimentalSettingsWithManaged }
  >({
    mutationFn: (patch) => instanceSettingsApi.updateExperimental(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.instance.experimentalSettings });
      const previous = queryClient.getQueryData<InstanceExperimentalSettingsWithManaged>(
        queryKeys.instance.experimentalSettings,
      );
      if (previous) {
        queryClient.setQueryData<InstanceExperimentalSettingsWithManaged>(
          queryKeys.instance.experimentalSettings,
          { ...previous, ...patch },
        );
      }
      return { previous };
    },
    onSuccess: async (updated) => {
      setError(null);
      queryClient.setQueryData(queryKeys.instance.experimentalSettings, updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adapters.all }),
        queryClient.invalidateQueries({ queryKey: ["built-in-agents"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
        queryClient.invalidateQueries({ queryKey: ["apps"] }),
      ]);
    },
    onError: (failure, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.instance.experimentalSettings, context.previous);
      }
      setError(failure.message || "Failed to save the change.");
    },
  });

  const settings = query.data;
  const managedKeys = settings?.managedKeys ?? {};
  const isManaged = (key: InstanceFeatureKey) => managedKeys[key]?.managed === true;
  const isHidden = (key: InstanceFeatureKey) => hidden.has(experimentalSettingKey(key));
  const isOn = (key: InstanceFeatureKey) => settings?.[key] === true;

  return {
    query,
    settings,
    error,
    isManaged,
    isHidden,
    isOn,
    isCloudManaged: settings?.managedKeys !== undefined,
    pending: mutation.isPending,
    save: (patch: PatchInstanceExperimentalSettings) => mutation.mutate(patch),
  };
}
