import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isUpdateJobActive, type InstanceUpdateStatus, type UpdateInstallMode, type UpdateJob } from "@tickernelz/wardmote-shared";
import { instanceUpdatesApi } from "@/api/instanceUpdates";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

export function UpdateJobSummary({ job, serverReachable }: { job: UpdateJob; serverReachable: boolean }) {
  switch (job.phase) {
    case "waiting":
      return (
        <p>
          Waiting for {plural(job.liveRuns, "run")} to finish. New runs wait until the update is done.
          {job.waitDeadline ? ` Gives up at ${formatTime(job.waitDeadline)} without changing anything.` : ""}
        </p>
      );
    case "installing":
      return (
        <p>
          {serverReachable
            ? `Installing Wardmote ${job.toVersion}: database backup, install, then a restart. Database migrations can take a few minutes.`
            : "The server is restarting. This page reconnects by itself."}
        </p>
      );
    case "succeeded":
      return <p>Wardmote {job.installedVersion ?? job.toVersion} is installed and running.</p>;
    case "cancelled":
      return <p>{job.error ?? "The update was cancelled. Nothing was installed."}</p>;
    case "failed":
      return (
        <div className="flex flex-col gap-2">
          <p>
            {job.rolledBackTo
              ? `Updating to ${job.toVersion} failed and Wardmote was rolled back to ${job.rolledBackTo}.`
              : `Updating to ${job.toVersion} failed.`}
          </p>
          {job.error ? <p className="text-ink-3">{job.error}</p> : null}
          {job.logHint ? (
            <p className="text-ink-3">
              Log: <code className="rounded bg-bg-3 px-1 py-0.5 text-xs">{job.logHint}</code>
            </p>
          ) : null}
        </div>
      );
  }
}

export function UpdateInstallDialog({
  open,
  onOpenChange,
  status,
  job,
  serverReachable,
  showResult = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InstanceUpdateStatus;
  job: UpdateJob | null;
  serverReachable: boolean;
  showResult?: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [followedJobId, setFollowedJobId] = useState<string | null>(null);
  useEffect(() => {
    if (isUpdateJobActive(job)) setFollowedJobId(job!.id);
  }, [job]);
  const showJob = job !== null && (isUpdateJobActive(job) || showResult || job.id === followedJobId);
  const liveRuns = useQuery({
    queryKey: [...queryKeys.instance.updates, "live-runs"],
    queryFn: () => instanceUpdatesApi.liveRuns(),
    enabled: open && !showJob,
    staleTime: 0,
    refetchInterval: open && !showJob ? 3_000 : false,
  });
  const onJob = ({ job: next }: { job: UpdateJob }) => {
    setError(null);
    setFollowedJobId(next.id);
    queryClient.setQueryData([...queryKeys.instance.updates, "install"], { job: next });
  };
  const onError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const start = useMutation({ mutationFn: (mode: UpdateInstallMode) => instanceUpdatesApi.startInstall(status.latestVersion!, mode), onSuccess: onJob, onError });
  const force = useMutation({ mutationFn: () => instanceUpdatesApi.forceInstall(), onSuccess: onJob, onError });
  const cancel = useMutation({ mutationFn: () => instanceUpdatesApi.cancelInstall(), onSuccess: onJob, onError });
  const busy = start.isPending || force.isPending || cancel.isPending;
  const active = liveRuns.data ? liveRuns.data.count + liveRuns.data.pendingWakes : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="update-install-dialog">
        <DialogHeader>
          <DialogTitle>Update Wardmote to {job && showJob ? job.toVersion : status.latestVersion}</DialogTitle>
          <DialogDescription>
            Installed {status.currentVersion}. The update backs up the database, installs the new version and restarts the
            server. If the new version fails its health check, Wardmote rolls back automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-ink" aria-live="polite">
          {showJob && job ? (
            <UpdateJobSummary job={job} serverReachable={serverReachable} />
          ) : active === null ? (
            <p>{liveRuns.isError ? "Could not count the active runs." : "Counting active runs..."}</p>
          ) : active > 0 ? (
            <p>
              {active === 1
                ? "1 run is active now. Stopping it restarts it from its last checkpoint after the update; waiting lets it finish first."
                : `${active} runs are active now. Stopping them restarts each from its last checkpoint after the update; waiting lets them finish first.`}
            </p>
          ) : (
            <p>No runs are active. The server restarts briefly.</p>
          )}
          {error ? <p role="alert" className="mt-2 text-bad">{error}</p> : null}
        </div>
        <DialogFooter>
          {showJob && job ? (
            job.phase === "waiting" ? (
              <>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => cancel.mutate()}>Cancel update</Button>
                <Button type="button" variant="danger" disabled={busy} onClick={() => force.mutate()}>
                  Stop {plural(job.liveRuns, "run")} and update now
                </Button>
              </>
            ) : job.phase === "succeeded" ? (
              <Button type="button" onClick={() => window.location.reload()}>Reload</Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
            )
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              {active !== null && active > 0 ? (
                <>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => start.mutate("wait")}>
                    Wait for runs to finish
                  </Button>
                  <Button type="button" variant="primary" autoFocus disabled={busy} onClick={() => start.mutate("force")}>
                    Update and stop {plural(active, "run")}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="primary" autoFocus disabled={busy || active === null} onClick={() => start.mutate("wait")}>
                  Update now
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
