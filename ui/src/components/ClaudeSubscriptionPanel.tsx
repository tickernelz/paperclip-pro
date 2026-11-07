import { quotaUnavailableMessage } from "@/lib/quota-refresh";
import type { QuotaWindow } from "@tickernelz/paperclip-pro-shared";
import { cn, quotaSourceDisplayName } from "@/lib/utils";

interface ClaudeSubscriptionPanelProps {
  windows: QuotaWindow[];
  source?: string | null;
  error?: string | null;
}

const WINDOW_ORDER = [
  "currentsession",
  "currentweekallmodels",
  "currentweeksonnetonly",
  "currentweeksonnet",
  "currentweekopusonly",
  "currentweekopus",
  "extrausage",
] as const;

function normalizeLabel(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function detailText(window: QuotaWindow): string | null {
  if (typeof window.detail === "string" && window.detail.trim().length > 0) return window.detail.trim();
  if (window.resetsAt) {
    const formatted = new Date(window.resetsAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return `Resets ${formatted}`;
  }
  return null;
}

function orderedWindows(windows: QuotaWindow[]): QuotaWindow[] {
  return [...windows].sort((a, b) => {
    const aIndex = WINDOW_ORDER.indexOf(normalizeLabel(a.label) as (typeof WINDOW_ORDER)[number]);
    const bIndex = WINDOW_ORDER.indexOf(normalizeLabel(b.label) as (typeof WINDOW_ORDER)[number]);
    return (aIndex === -1 ? WINDOW_ORDER.length : aIndex) - (bIndex === -1 ? WINDOW_ORDER.length : bIndex);
  });
}

function fillClass(usedPercent: number | null): string {
  if (usedPercent == null) return "bg-zinc-700";
  if (usedPercent >= 90) return "bg-(--status-task-blocked)";
  if (usedPercent >= 70) return "bg-(--status-task-todo)";
  return "bg-accent/70";
}

export function ClaudeSubscriptionPanel({
  windows,
  source = null,
  error = null,
}: ClaudeSubscriptionPanelProps) {
  const ordered = orderedWindows(windows);

  return (
    <div className="border border-line px-4 py-4">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <div className="text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-caps) text-ink-3">
            Anthropic subscription
          </div>
          <div className="mt-1 text-sm text-ink-3">
            Quota from the Claude subscription connected to this server.
          </div>
        </div>
        {source ? (
          <span className="shrink-0 border border-line px-2.5 py-1 text-(length:--text-nano) font-semibold uppercase tracking-(--tracking-eyebrow) text-ink-3">
            {quotaSourceDisplayName(source)}
          </span>
        ) : null}
      </div>

      {error ? (
        <div role="status" className="mt-4 text-sm text-ink-3">
          {quotaUnavailableMessage(windows.length > 0)}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {ordered.map((window) => {
          const normalized = normalizeLabel(window.label);
          const detail = detailText(window);
          if (normalized === "extrausage") {
            return (
              <div
                key={window.label}
                className="border border-line px-3.5 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-ink">{window.label}</div>
                  {window.valueLabel ? (
                    <div className="text-sm font-medium text-ink">{window.valueLabel}</div>
                  ) : null}
                </div>
                {detail ? (
                  <div className="mt-2 text-sm text-ink-3">{detail}</div>
                ) : null}
              </div>
            );
          }

          const width = Math.min(100, Math.max(0, window.usedPercent ?? 0));
          return (
            <div
              key={window.label}
              className="border border-line px-3.5 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{window.label}</div>
                  {detail ? (
                    <div className="mt-1 text-xs text-ink-3">{detail}</div>
                  ) : null}
                </div>
                {window.usedPercent != null ? (
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    {window.usedPercent}% used
                  </div>
                ) : null}
              </div>

              <div className="mt-3 h-2 overflow-hidden bg-bg-3">
                <div
                  className={cn("h-full transition-(--tp-width) duration-200", fillClass(window.usedPercent))}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
