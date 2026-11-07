import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";

export function ManagedByCloudBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Lock aria-hidden="true" />
      Managed by Paperclip Cloud
    </Badge>
  );
}

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
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{name}</h3>
            {badges}
          </div>
          <p className="text-sm text-muted-foreground">{summary}</p>
          {status ? <p className="text-xs text-muted-foreground sm:hidden">{status}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {status ? (
            <span className={cn("hidden max-w-64 text-right text-xs text-muted-foreground sm:block")}>{status}</span>
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
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}
