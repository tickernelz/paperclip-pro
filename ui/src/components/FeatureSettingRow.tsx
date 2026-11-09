import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";

export function FeatureSettingRow({
  name,
  summary,
  badges,
  status,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  name: string;
  summary: string;
  badges?: ReactNode;
  status?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{name}</h3>
            {badges}
          </div>
          <p className="text-sm text-ink-3">{summary}</p>
          {status ? <p className="text-xs text-ink-3 sm:hidden">{status}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {status ? (
            <span className={cn("hidden max-w-64 text-right text-xs text-ink-3 sm:block")}>{status}</span>
          ) : null}
          <ToggleSwitch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
            aria-label={name}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

export function FeatureSettingGroup({
  id,
  title,
  meta,
  children,
}: {
  id: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-line bg-bg-2">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
        <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {title}
        </h2>
        {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}
