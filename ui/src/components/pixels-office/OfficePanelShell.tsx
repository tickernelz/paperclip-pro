import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OfficePanelShellProps {
  title: string;
  subtitle?: string | null;
  headerExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function OfficePanelShell({
  title,
  subtitle,
  headerExtra,
  onClose,
  children,
}: OfficePanelShellProps) {
  return (
    <aside
      aria-label={title}
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {headerExtra}
        <Button variant="ghost" size="icon" aria-label="Close panel" onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  );
}
