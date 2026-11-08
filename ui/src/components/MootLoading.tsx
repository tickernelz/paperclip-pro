import { cn } from "../lib/utils";
import { MootMark } from "./MootMark";

export function MootLoading({ className }: { className?: string }) {
  return (
    <div role="status" className={cn("flex min-h-dvh w-full items-center justify-center", className)}>
      <MootMark animated className="h-24 w-24 text-ink-3" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
