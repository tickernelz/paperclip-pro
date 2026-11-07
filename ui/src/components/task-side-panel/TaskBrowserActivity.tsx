import type { TaskBrowser } from "@tickernelz/paperclip-pro-shared";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TaskBrowserActivity({
  browser,
  label = "Browser",
  onOpen,
}: {
  browser: TaskBrowser;
  label?: string;
  onOpen?: (id: string) => void;
}) {
  const closed = browser.status === "closed" || browser.status === "failed";
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-sm" aria-label={`${label} session`}>
      <Globe className="size-4 shrink-0 text-ink-3" aria-hidden />
      <span>{label}</span>
      <span className="text-ink-3">· {browser.status}</span>
      {onOpen && (
        <Button variant="ghost" size="sm" onClick={() => onOpen(browser.id)}>
          {closed ? "View session" : "Open browser"}
        </Button>
      )}
    </div>
  );
}
