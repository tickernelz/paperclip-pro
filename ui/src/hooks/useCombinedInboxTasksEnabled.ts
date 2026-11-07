import { useContext } from "react";
import type { InstanceExperimentalSettings } from "@tickernelz/paperclip-pro-shared";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";

export function resolveCombinedInboxTasksEnabled(
  settings: Partial<Pick<InstanceExperimentalSettings, "enableCombinedInboxTasks">> | null | undefined,
): boolean {
  return settings?.enableCombinedInboxTasks === true;
}

let detachedClient: QueryClient | null = null;
function getDetachedClient(): QueryClient {
  detachedClient ??= new QueryClient();
  return detachedClient;
}

export function useCombinedInboxTasksEnabled(): { enabled: boolean; loaded: boolean } {
  const contextClient = useContext(QueryClientContext);
  const query = useQuery(
    {
      queryKey: queryKeys.instance.experimentalSettings,
      queryFn: () => instanceSettingsApi.getExperimental(),
      enabled: contextClient != null,
    },
    contextClient ?? getDetachedClient(),
  );

  if (!contextClient) return { enabled: false, loaded: true };

  return {
    enabled: resolveCombinedInboxTasksEnabled(query.data),
    loaded: query.isFetched,
  };
}
