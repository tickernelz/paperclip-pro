import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Pins task header actions to the top of the thread viewport while the header scrolls away. */
export function TaskChatStickyHeaderActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="task-chat-sticky-header-actions"
      className={cn(
        "sticky top-[calc(var(--mobile-topbar-h,0.5rem)+0.5rem)] z-10 h-0",
        className,
      )}
    >
      <div className="absolute right-0 top-0 rounded-md bg-bg/90 backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}
