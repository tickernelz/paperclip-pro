import { useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import type { MessageDeliveryMode } from "@/lib/message-delivery-command";

/**
 * The instance-wide default for a message sent without an explicit
 * `/steer` or `/queue`. The server resolves the stored value for every
 * successful read; only the loading and error paths deliver nothing, and both
 * fall back to steering.
 */
export function useDefaultMessageDelivery(): MessageDeliveryMode {
  const { data } = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  });
  const stored = (data as { defaultMessageDelivery?: unknown } | undefined)
    ?.defaultMessageDelivery;
  return stored === "queue" ? "queue" : "steer";
}
