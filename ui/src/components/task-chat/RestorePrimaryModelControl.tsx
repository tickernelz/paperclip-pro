import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import type { RunModelFallbackState } from "@tickernelz/paperclip-pro-shared";
import { heartbeatsApi } from "../../api/heartbeats";
import { issuesApi } from "../../api/issues";
import { queryKeys } from "../../lib/queryKeys";
import { cn } from "../../lib/utils";
import { Button } from "@/components/ui/button";

export interface RestorePrimaryModelRun {
  id: string;
  modelFallback?: RunModelFallbackState | null;
}

export const RESTORE_PRIMARY_MODEL_COMMENT = "Kembali ke model utama.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function RestorePrimaryModelControl({
  issueId,
  run,
  companyId,
  taskLabel,
  className,
}: {
  issueId: string | null | undefined;
  run: RestorePrimaryModelRun | null | undefined;
  companyId?: string | null;
  taskLabel?: string | null;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const fallback = run?.modelFallback ?? null;
  const restore = useMutation({
    mutationFn: async () => {
      if (!issueId || !run) throw new Error("This task has no run on a fallback model.");
      await heartbeatsApi.cancel(run.id);
      return issuesApi.addComment(
        issueId,
        RESTORE_PRIMARY_MODEL_COMMENT,
        undefined,
        undefined,
        undefined,
        crypto.randomUUID(),
      );
    },
    onSuccess: () => {
      if (companyId) void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
      if (!issueId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
    },
  });

  if (!issueId || !run || !fallback) return null;

  const task = taskLabel ? ` on ${taskLabel}` : "";
  return (
    <span data-slot="restore-primary-model" className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={restore.isPending}
        aria-label={`Back to the primary model${task}`}
        title={`Back to the primary model — stops this fallback run and wakes the assignee on ${fallback.primaryModel}`}
        className="border-amber-500/25 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 hover:text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20 dark:hover:text-amber-100"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          restore.mutate();
        }}
      >
        <RotateCcw aria-hidden="true" />
        {restore.isPending ? "Restoring…" : "Primary model"}
      </Button>
      {restore.error ? (
        <span role="alert" className="text-xs text-destructive">
          {errorMessage(restore.error, "Couldn’t restore the primary model.")}
        </span>
      ) : null}
    </span>
  );
}
