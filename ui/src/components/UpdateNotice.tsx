import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import {
  isUpdateNoticeHidden,
  UPDATE_NOTICE_HIDE_DAYS,
  updateNoticeHiddenUntil,
} from "@tickernelz/wardmote-shared";
import { accessApi, type CurrentBoardAccess } from "@/api/access";
import { instanceUpdatesApi } from "@/api/instanceUpdates";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";

export const UPDATE_NOTICE_HIDDEN_UNTIL_KEY = "wardmote.updateNotice.hiddenUntil";
const STATUS_REFRESH_MS = 60 * 60 * 1000;

export function canSeeUpdateNotice(access: CurrentBoardAccess | undefined): boolean {
  return access?.source === "local_implicit" || (access?.source === "session" && access.isInstanceAdmin === true);
}

function readHiddenUntil(): number | null {
  try {
    const value = Number(window.localStorage.getItem(UPDATE_NOTICE_HIDDEN_UNTIL_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

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
  const [hiddenUntil, setHiddenUntil] = useState<number | null>(readHiddenUntil);
  const hidden = isUpdateNoticeHidden(hiddenUntil, now());

  useEffect(() => {
    if (!hidden || hiddenUntil === null) return;
    const timer = window.setTimeout(() => setHiddenUntil(readHiddenUntil()), Math.max(0, hiddenUntil - now()) + 1_000);
    return () => window.clearTimeout(timer);
  }, [hidden, hiddenUntil, now]);

  const update = status.data;
  if (!allowed || !update?.updateAvailable || !update.latestVersion || hidden) return null;

  const hide = () => {
    const until = updateNoticeHiddenUntil(now());
    try {
      window.localStorage.setItem(UPDATE_NOTICE_HIDDEN_UNTIL_KEY, String(until));
    } catch {}
    setHiddenUntil(until);
  };

  return (
    <section
      aria-label="Wardmote update available"
      data-testid="update-notice"
      className="flex min-w-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1.5 text-sm text-ink"
    >
      <ArrowUpCircle className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate" title={`Installed ${update.currentVersion}. ${update.install.command}`}>
        <b className="font-semibold">Wardmote {update.latestVersion}<span className="hidden sm:inline"> is available</span></b>
        <span className="hidden sm:inline"> · installed {update.currentVersion}</span>
        <span className="hidden lg:inline">
          {" · "}
          <code className="rounded bg-bg px-1 py-0.5 text-xs">{update.install.command}</code>
        </span>
      </p>
      {update.releaseNotesUrl ? (
        <a
          href={update.releaseNotesUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          Release notes
        </a>
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
    </section>
  );
}
