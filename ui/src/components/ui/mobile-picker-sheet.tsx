import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bottom-sheet header for `[data-mobile-entity-picker]` popovers; hidden above the mobile breakpoint. */
export function MobilePickerSheetHeader({
  title,
  value,
  onClose,
  className,
}: {
  title: string;
  value?: string | null;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      data-mobile-sheet-header=""
      className={cn(
        "hidden shrink-0 flex-col gap-1 border-b border-border/60 bg-popover px-3 pb-2 pt-2 max-sm:flex",
        className,
      )}
    >
      <div
        aria-hidden
        className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border"
        data-mobile-sheet-handle=""
      />
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-medium">{title}</span>
        {value ? (
          <span
            className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
            data-mobile-sheet-value=""
          >
            {value}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title} picker`}
            data-mobile-sheet-close=""
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
