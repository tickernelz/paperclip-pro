import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, X } from "lucide-react";
import type { IssueAutonomyWindow } from "@tickernelz/paperclip-pro-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToastActions } from "../context/ToastContext";
import { autonomyWindowsApi } from "../api/autonomyWindows";
import { queryKeys } from "../lib/queryKeys";
import { formatClockTime, formatDateTime } from "../lib/utils";

export function coveringAutonomyWindow(
  windows: readonly IssueAutonomyWindow[],
  issueId: string,
  ancestorIds: readonly string[],
  now = Date.now(),
): IssueAutonomyWindow | null {
  const tree = new Set([issueId, ...ancestorIds]);
  return (
    windows
      .filter(
        (window) =>
          window.status === "live" &&
          tree.has(window.rootIssueId) &&
          new Date(window.expiresAt).getTime() > now &&
          (window.maxAccepts === null || window.acceptCount < window.maxAccepts),
      )
      .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0] ?? null
  );
}

export function IssueAutonomyWindowBadge({
  companyId,
  issueId,
  ancestors,
}: {
  companyId: string;
  issueId: string;
  ancestors: readonly { id: string }[] | undefined;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const windowsKey = queryKeys.autonomyWindows(companyId);
  const { data } = useQuery({
    queryKey: windowsKey,
    queryFn: () => autonomyWindowsApi.listLive(companyId),
    staleTime: 60_000,
  });
  const window = useMemo(
    () => coveringAutonomyWindow(data?.windows ?? [], issueId, (ancestors ?? []).map((ancestor) => ancestor.id)),
    [data, issueId, ancestors],
  );
  const close = useMutation({
    mutationFn: (windowId: string) => autonomyWindowsApi.close(windowId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: windowsKey }),
    onError: (error) => {
      pushToast({
        title: "Couldn't close the autonomy window",
        body: error instanceof Error ? error.message : "Try again in a moment.",
        tone: "error",
      });
    },
  });
  if (!window) return null;
  const root = window.rootIssueIdentifier ?? window.rootIssueId.slice(0, 8);
  return (
    <span className="inline-flex shrink-0 items-center gap-1" data-testid="issue-autonomy-window">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-(length:--text-nano) text-primary">
            <ShieldCheck className="h-3 w-3" />
            Autonomy until {formatClockTime(window.expiresAt)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          Plain confirmations in {root} and its sub-issues are accepted automatically until {formatDateTime(window.expiresAt)}
          {window.maxAccepts === null ? "" : ` (${window.acceptCount} of ${window.maxAccepts} used)`}. Questions, reviews, governed approvals and destructive steps still wait for a person.
        </TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close autonomy window"
        disabled={close.isPending}
        onClick={() => close.mutate(window.id)}
      >
        <X />
      </Button>
    </span>
  );
}
