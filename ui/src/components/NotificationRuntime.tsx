import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate } from "@/lib/router";
import { startNotificationRuntime } from "@/lib/notifications/runtime";

export function NotificationRuntime() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const userId = session?.user?.id ?? session?.session?.userId ?? null;

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (!userId) return;
    return startNotificationRuntime({ userId, navigate: (url) => navigateRef.current(url) });
  }, [userId]);

  return null;
}
