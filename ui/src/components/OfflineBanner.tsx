import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useOffline } from "../lib/online-status";
import { offlineSnapshotTime } from "../lib/offline-data";

function formatTime(time: Date) {
  return time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function OfflineBanner() {
  const offline = useOffline();
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!offline) {
      setLoadedAt(null);
      return;
    }
    let cancelled = false;
    const wentOfflineAt = new Date();
    void offlineSnapshotTime().then((snapshot) => {
      if (!cancelled) setLoadedAt(snapshot && snapshot < wentOfflineAt ? snapshot : wentOfflineAt);
    });
    return () => {
      cancelled = true;
    };
  }, [offline]);

  if (!offline) return null;
  return (
    <div role="status" className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2 text-sm text-ink">
      <WifiOff className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
      <span>
        <b className="font-semibold">You are offline.</b>{" "}
        {loadedAt ? `Showing what was loaded at ${formatTime(loadedAt)}. ` : "Showing what was already loaded. "}
        Approvals and replies wait until you are back.
      </span>
    </div>
  );
}
