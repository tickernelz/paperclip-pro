import { cn } from "@/lib/utils";

/** Class list for the pinned composer dock, shared with the mobile shell harness. */
export function composerDockClassName({
  isMobile,
  streamlinedUiEnabled,
}: {
  isMobile: boolean;
  streamlinedUiEnabled: boolean;
}): string {
  return cn(
    "sticky",
    isMobile ? "bottom-(--tc-composer-dock-bottom) z-20" : "bottom-0 z-10",
    "mx-auto flex w-full max-w-(--tc-shell-max-w) flex-col gap-2 px-1 pb-1 md:px-4 md:pb-2",
    streamlinedUiEnabled && "md:px-0 md:pb-0",
    (!streamlinedUiEnabled || isMobile) &&
      "bg-background/80 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/60 dark:bg-transparent dark:backdrop-blur-none dark:supports-[backdrop-filter]:bg-transparent",
  );
}
