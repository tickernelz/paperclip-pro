import { AlertTriangle } from "lucide-react";
import type { DiskSpaceHealth, HealthWarning } from "../api/health";

const SHOWN_WARNING_CODES = new Set(["disk_space_low", "database_backup_skipped_low_disk"]);

export function DiskSpaceBanner({ diskSpace, warnings }: { diskSpace?: DiskSpaceHealth; warnings?: HealthWarning[] }) {
  const shown = (warnings ?? []).filter((warning) => SHOWN_WARNING_CODES.has(warning.code));
  if (shown.length === 0) return null;
  const critical = diskSpace?.level === "emergency";
  return (
    <section
      aria-label={critical ? "Disk space critical" : "Disk space low"}
      className={
        critical
          ? "border-b border-red-300/60 bg-red-50 text-red-950 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-100"
          : "border-b border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
      }
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-(--tracking-caps)">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{critical ? "Disk space critical" : "Disk space low"}</span>
        </div>
        <div aria-live={critical ? "assertive" : "polite"} aria-atomic="true">
          {shown.map((warning) => (
            <p key={warning.code} className="mt-1 text-sm">{warning.message}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
