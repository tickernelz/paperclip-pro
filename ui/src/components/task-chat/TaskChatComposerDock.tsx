import { forwardRef, type ReactNode } from "react";
import { composerDockClassName } from "@/components/task-chat/composer-dock";
import { cn } from "@/lib/utils";

interface TaskChatComposerDockProps {
  children: ReactNode;
  mobile: boolean;
  streamlined: boolean;
  reserve?: number;
  concealed?: boolean;
}

/** Pinned composer dock shared by the task thread and its mobile shell harness. */
export const TaskChatComposerDock = forwardRef<
  HTMLDivElement,
  TaskChatComposerDockProps
>(function TaskChatComposerDock(
  { children, mobile, streamlined, reserve, concealed = false },
  ref,
) {
  return (
    <div
      ref={ref}
      data-testid="task-chat-composer-dock"
      data-composer-reserve={reserve}
      inert={concealed}
      aria-hidden={concealed || undefined}
      className={cn(
        composerDockClassName({
          isMobile: mobile,
          streamlinedUiEnabled: streamlined,
        }),
        concealed && "invisible",
      )}
    >
      {children}
    </div>
  );
});
