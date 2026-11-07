import { quotaUnavailableMessage } from "@/lib/quota-refresh";
import type { QuotaWindow } from "@tickernelz/paperclip-pro-shared";
import { cn, quotaSourceDisplayName } from "@/lib/utils";

interface CodexSubscriptionPanelProps {
  windows: QuotaWindow[];
  source?: string | null;
  error?: string | null;
}

const WINDOW_PRIORITY = [
  "5hlimit",
  "weeklylimit",
  "credits",
] as const;

function normalizeLabel(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function orderedWindows(windows: QuotaWindow[]): QuotaWindow[] {
  return [...windows].sort((a, b) => {
    const aBase = normalizeLabel(a.label).replace(/^gpt53codexspark/, "");
    const bBase = normalizeLabel(b.label).replace(/^gpt53codexspark/, "");
    const aIndex = WINDOW_PRIORITY.indexOf(aBase as (typeof WINDOW_PRIORITY)[number]);
    const bIndex = WINDOW_PRIORITY.indexOf(bBase as (typeof WINDOW_PRIORITY)[number]);
    return (aIndex === -1 ? WINDOW_PRIORITY.length : aIndex) - (bIndex === -1 ? WINDOW_PRIORITY.length : bIndex);
  });
}

function detailText(window: QuotaWindow): string | null {
  if (typeof window.detail === "string" && window.detail.trim().length > 0) return window.detail.trim();
  if (!window.resetsAt) return null;
  const formatted = new Date(window.resetsAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `Resets ${formatted}`;
}

function fillClass(usedPercent: number | null): string {
  if (usedPercent == null) return "bg-zinc-700";
  if (usedPercent >= 90) return "bg-(--status-task-blocked)";
  if (usedPercent >= 70) return "bg-(--status-task-todo)";
  return "bg-accent/70";
}

function isModelSpecific(label: string): boolean {
  const normalized = normalizeLabel(label);
  return normalized.includes("gpt53codexspark") || normalized.includes("gpt5");
}

export function CodexSubscriptionPanel({
  windows,
  source = null,
  error = null,
}: CodexSubscriptionPanelProps) {
  const ordered = orderedWindows(windows);
  const accountWindows = ordered.filter((window) => !isModelSpecific(window.label));
  const modelWindows = ordered.filter((window) => isModelSpecific(window.label));

  return (
    <div className="border border-line px-4 py-4">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <div className="text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-caps) text-ink-3">
            Codex subscription
          </div>
          <div className="mt-1 text-sm text-ink-3">
            Quota from the Codex subscription connected to this server.
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

      <div className="mt-4 space-y-5">
        <div className="space-y-3">
          <div className="text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-caps) text-ink-3">
            Account windows
          </div>
          <div className="space-y-3">
            {accountWindows.map((window) => (
              <QuotaWindowRow key={window.label} window={window} />
            ))}
          </div>
        </div>

        {modelWindows.length > 0 ? (
          <div className="space-y-3">
            <div className="text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-caps) text-ink-3">
              Model windows
            </div>
            <div className="space-y-3">
              {modelWindows.map((window) => (
                <QuotaWindowRow key={window.label} window={window} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuotaWindowRow({ window }: { window: QuotaWindow }) {
  const detail = detailText(window);
  if (window.usedPercent == null) {
    return (
      <div className="border border-line px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-ink">{window.label}</div>
          {window.valueLabel ? (
            <div className="text-sm font-semibold tabular-nums text-ink">{window.valueLabel}</div>
          ) : null}
        </div>
        {detail ? (
          <div className="mt-2 text-xs text-ink-3">{detail}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border border-line px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{window.label}</div>
          {detail ? (
            <div className="mt-1 text-xs text-ink-3">{detail}</div>
          ) : null}
        </div>
        <div className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          {window.usedPercent}% used
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden bg-bg-3">
        <div
          className={cn("h-full transition-(--tp-width) duration-200", fillClass(window.usedPercent))}
          style={{ width: `${Math.max(0, Math.min(100, window.usedPercent))}%` }}
        />
      </div>
    </div>
  );
}
