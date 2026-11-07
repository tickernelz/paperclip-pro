import type { ToolProfileWithDetails } from "@tickernelz/paperclip-pro-shared";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { allowedToolsLabel, type GatewayAppRow, gatewayAppDisplayName } from "../gateway-helpers";

/**
 * Apps & tools tab — which apps this gateway exposes and how many tools each
 * contributes, derived from the bound access profile. Missing credentials
 * surface as "Needs attention", carried from the connection health status.
 */
export function AppsToolsPanel({
  apps,
  profile,
}: {
  apps: GatewayAppRow[];
  profile: ToolProfileWithDetails | undefined;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">
        These apps go through this gateway. The bound profile
        {profile ? ` (${profile.name})` : ""} decides which tools are allowed
        {profile ? ` — ${allowedToolsLabel(profile)}.` : "."} Change the profile under Advanced.
      </p>

      {apps.length === 0 ? (
        <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-3">
          No apps are assigned to this gateway’s profile yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-(--sz-32rem) text-sm">
            <thead>
              <tr className="border-b border-line bg-bg-3/40 text-left text-(length:--text-micro) font-semibold uppercase tracking-wide text-ink-3">
                <th className="px-4 py-2.5">App</th>
                <th className="px-4 py-2.5">Tools</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => {
                const href = app.connection
                  ? `/apps/${app.connection.id}/permissions`
                  : `/apps/app/${app.application.id}/permissions`;
                return (
                  <tr key={app.application.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link to={href} className="font-medium text-ink hover:underline">
                        {gatewayAppDisplayName(app)}
                      </Link>
                      {app.needsAttention && app.attentionReason ? (
                        <div className="text-xs text-ink-3">{app.attentionReason}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-3">
                      {app.toolCount} {app.toolCount === 1 ? "tool" : "tools"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                          app.needsAttention
                            ? "border-ink bg-ink text-bg"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {app.needsAttention ? "Needs attention" : "Healthy"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to={href} className="text-xs font-medium text-accent hover:underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
