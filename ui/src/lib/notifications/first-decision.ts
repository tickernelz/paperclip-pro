import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { useToastActions } from "@/context/ToastContext";
import { onDecisionMade } from "@/lib/decision-events";
import { queryKeys } from "@/lib/queryKeys";
import { notificationPermission, notificationsSupported, requestNotificationPermission } from "./browser";
import { syncPushSubscription } from "./push";
import { setNotificationSettings } from "./settings";

const ASKED_KEY = "wardmote.notifications.asked-after-decision";

function alreadyAsked(): boolean {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

function markAsked() {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch {
    return;
  }
}

export async function enableNotificationsAfterDecision(userId: string | null) {
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return permission;
  const settings = setNotificationSettings((current) => ({ ...current, enabled: true, pushEnabled: true }));
  if (userId) await syncPushSubscription(settings, userId);
  return permission;
}

export function useFirstDecisionNotificationPrompt() {
  const { pushToast } = useToastActions();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const userId = session?.user?.id ?? session?.session?.userId ?? null;

  useEffect(
    () =>
      onDecisionMade(() => {
        if (alreadyAsked() || !notificationsSupported() || notificationPermission() !== "default") return;
        markAsked();
        pushToast({
          id: "wardmote-notify-after-decision",
          title: "Get notified when an agent needs a decision",
          body: "Turn on notifications for this device. You can change it later in Settings.",
          tone: "info",
          persistent: true,
          action: { label: "Turn on", onClick: () => void enableNotificationsAfterDecision(userId) },
        });
      }),
    [pushToast, userId],
  );
}
