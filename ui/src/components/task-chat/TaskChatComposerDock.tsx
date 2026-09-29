import { forwardRef, type ReactNode } from "react";
import { composerDockClassName } from "@/components/task-chat/composer-dock";

interface TaskChatComposerDockProps {
  children: ReactNode;
  mobile: boolean;
  streamlined: boolean;
  reserve?: number;
}

/** Pinned composer dock shared by the task thread and its mobile shell harness. */
export const TaskChatComposerDock = forwardRef<
  HTMLDivElement,
  TaskChatComposerDockProps
>(function TaskChatComposerDock(
  { children, mobile, streamlined, reserve },
  ref,
) {
  return (
    <div
      ref={ref}
      data-testid="task-chat-composer-dock"
      data-composer-reserve={reserve}
      className={composerDockClassName({
        isMobile: mobile,
        streamlinedUiEnabled: streamlined,
      })}
    >
      {children}
    </div>
  );
});
