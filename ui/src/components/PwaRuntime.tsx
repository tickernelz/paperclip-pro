import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToastActions } from "../context/ToastContext";
import { useServiceWorkerUpdate } from "../lib/service-worker-updates";
import { useOffline } from "../lib/online-status";
import { useFirstDecisionNotificationPrompt } from "../lib/notifications/first-decision";

const UPDATE_TOAST_ID = "wardmote-update-ready";

export function PwaRuntime() {
  const { pushToast } = useToastActions();
  const applyUpdate = useServiceWorkerUpdate();
  const queryClient = useQueryClient();
  const offline = useOffline();
  const wasOffline = useRef(offline);

  useEffect(() => {
    if (!applyUpdate) return;
    pushToast({
      id: UPDATE_TOAST_ID,
      title: "A new version is ready.",
      tone: "info",
      persistent: true,
      action: { label: "Reload", onClick: applyUpdate },
    });
  }, [applyUpdate, pushToast]);

  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    void queryClient.invalidateQueries();
  }, [offline, queryClient]);

  useFirstDecisionNotificationPrompt();
  return null;
}
