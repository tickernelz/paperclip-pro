import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import {
  isUpdateJobActive,
  isUpdateNoticeHidden,
  UPDATE_NOTICE_HIDE_DAYS,
  updateNoticeHiddenUntil,
} from "@tickernelz/wardmote-shared";
import { accessApi, type CurrentBoardAccess } from "@/api/access";
import { instanceUpdatesApi } from "@/api/instanceUpdates";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import { UpdateInstallDialog } from "./UpdateInstallDialog";

export const UPDATE_NOTICE_HIDDEN_UNTIL_KEY = "wardmote.updateNotice.hiddenUntil";
export const UPDATE_RESULT_SEEN_KEY = "wardmote.updateNotice.seenJob";
const STATUS_REFRESH_MS = 60 * 60 * 1000;
const JOB_POLL_MS = 2_000;
const RESULT_SHOWN_FOR_MS = 24 * 60 * 60 * 1000;

export function canSeeUpdateNotice(access: CurrentBoardAccess | undefined): boolean {
  return access?.source === "local_implicit" || (access?.source === "session" && access.isInstanceAdmin === true);
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function readHiddenUntil(): number | null {
  const value = Number(readStored(UPDATE_NOTICE_HIDDEN_UNTIL_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const stripClass = "flex min-w-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1.5 text-sm text-ink";

export function UpdateNotice({ now = Date.now }: { now?: () => number }) {
  const access = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 30_000,
  });
  const allowed = canSeeUpdateNotice(access.data);
  const status = useQuery({
    queryKey: queryKeys.instance.updates,
    queryFn: () => instanceUpdatesApi.getStatus(),
    enabled: allowed,
    retry: false,
    staleTime: STATUS_REFRESH_MS,
    refetchInterval: STATUS_REFRESH_MS,
  });
  const canInstall = status.data?.install.canInstall === true;
  const install = useQuery({
    queryKey: [...queryKeys.instance.updates, "install"],
    queryFn: () => instanceUpdatesApi.getInstall(),
    enabled: allowed && canInstall,
    retry: false,
    refetchInterval: (query) => (isUpdateJobActive(query.state.data?.job) || query.state.status === "error" ? JOB_POLL_MS : false),
  });
  const job = install.data?.job ?? null;
  const serverReachable = !install.isError;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hiddenUntil, setHiddenUntil] = useState<number | null>(readHiddenUntil);
  const [seenJob, setSeenJob] = useState<string | null>(() => readStored(UPDATE_RESULT_SEEN_KEY));
  const hidden = isUpdateNoticeHidden(hiddenUntil, now());

  useEffect(() => {
    if (!hidden || hiddenUntil === null) return;
    const timer = window.setTimeout(() => setHiddenUntil(readHiddenUntil()), Math.max(0, hiddenUntil - now()) + 1_000);
    return () => window.clearTimeout(timer);
  }, [hidden, hiddenUntil, now]);

  const jobFinished = job?.finishedAt ? now() - Date.parse(job.finishedAt) < RESULT_SHOWN_FOR_MS : false;
  const showJobStrip = job !== null && (isUpdateJobActive(job) || (jobFinished && seenJob !== job.id));
  const update = status.data;
  if (!allowed || !update) return null;

  const dialog = canInstall ? (
    <UpdateInstallDialog open={dialogOpen} onOpenChange={setDialogOpen} status={update} job={job} serverReachable={serverReachable} />
  ) : null;

  if (showJobStrip && job) {
    const label = job.phase === "waiting"
      ? `Update to ${job.toVersion} is waiting for ${job.liveRuns} run${job.liveRuns === 1 ? "" : "s"} to finish`
      : job.phase === "installing"
        ? serverReachable ? `Installing Wardmote ${job.toVersion}...` : "Wardmote is restarting..."
        : job.phase === "succeeded"
          ? `Wardmote ${job.installedVersion ?? job.toVersion} is installed`
          : job.phase === "cancelled"
            ? `Update to ${job.toVersion} was cancelled`
            : job.rolledBackTo
              ? `Update to ${job.toVersion} failed and was rolled back to ${job.rolledBackTo}`
              : `Update to ${job.toVersion} failed`;
    const dismiss = () => {
      writeStored(UPDATE_RESULT_SEEN_KEY, job.id);
      setSeenJob(job.id);
    };
    return (
      <section aria-label="Wardmote update" data-testid="update-notice" data-phase={job.phase} className={stripClass}>
        {isUpdateJobActive(job)
          ? <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
          : <ArrowUpCircle className={`size-4 shrink-0 ${job.phase === "failed" ? "text-bad" : "text-accent"}`} aria-hidden="true" />}
        <p className="min-w-0 flex-1 truncate font-semibold" role="status">{label}</p>
        <Button type="button" variant="ghost" size="xs" onClick={() => setDialogOpen(true)}>Details</Button>
        {isUpdateJobActive(job) ? null : (
          <Button type="button" variant="ghost" size="xs" onClick={dismiss}>Dismiss</Button>
        )}
        {dialog}
      </section>
    );
  }

  if (!update.updateAvailable || !update.latestVersion || hidden) return null;

  const hide = () => {
    const until = updateNoticeHiddenUntil(now());
    writeStored(UPDATE_NOTICE_HIDDEN_UNTIL_KEY, String(until));
    setHiddenUntil(until);
  };

  return (
    <section aria-label="Wardmote update available" data-testid="update-notice" className={stripClass}>
      <ArrowUpCircle className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate" title={`Installed ${update.currentVersion}. ${update.install.command}`}>
        <b className="font-semibold">Wardmote {update.latestVersion}<span className="hidden sm:inline"> is available</span></b>
        <span className="hidden sm:inline"> · installed {update.currentVersion}</span>
        {canInstall ? null : (
          <span className="hidden lg:inline">
            {" · "}
            <code className="rounded bg-bg px-1 py-0.5 text-xs">{update.install.command}</code>
          </span>
        )}
      </p>
      {update.releaseNotesUrl ? (
        <a
          href={update.releaseNotesUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          <span className="sm:hidden">Notes</span>
          <span className="hidden sm:inline">Release notes</span>
        </a>
      ) : null}
      {canInstall ? (
        <Button type="button" variant="primary" size="xs" onClick={() => setDialogOpen(true)}>Update now</Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={hide}
        title={`Hide for ${UPDATE_NOTICE_HIDE_DAYS} days`}
        aria-label={`Hide the update notice for ${UPDATE_NOTICE_HIDE_DAYS} days`}
      >
        Hide
      </Button>
      {dialog}
    </section>
  );
}
