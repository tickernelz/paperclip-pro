import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Link2, Share2 } from "lucide-react";
import type { IssueShareLink } from "@tickernelz/paperclip-pro-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToastActions } from "../context/ToastContext";
import { issueShareApi } from "../api/issue-share";
import { queryKeys } from "../lib/queryKeys";
import { useCopyAction } from "../lib/use-copy-action";

export function IssueShareControl({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const { copied, failed, copy } = useCopyAction(2000);
  const shareLinkKey = queryKeys.issues.shareLink(issueId);

  const linkQuery = useQuery({
    queryKey: shareLinkKey,
    queryFn: () => issueShareApi.getShareLink(issueId),
    enabled: open,
  });

  const createLink = useMutation({
    mutationFn: () => issueShareApi.createShareLink(issueId),
    onSuccess: (link) => {
      queryClient.setQueryData<IssueShareLink | null>(shareLinkKey, link);
    },
    onError: (error) => {
      pushToast({
        title: "Couldn't create public link",
        body: error instanceof Error ? error.message : "Try again in a moment.",
        tone: "error",
      });
    },
  });

  const revokeLink = useMutation({
    mutationFn: () => issueShareApi.revokeShareLink(issueId),
    onSuccess: () => {
      queryClient.setQueryData<IssueShareLink | null>(shareLinkKey, null);
      setConfirmRevoke(false);
      pushToast({
        title: "Public link revoked",
        body: "Anyone holding the old link can no longer open it.",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Couldn't revoke public link",
        body: error instanceof Error ? error.message : "Try again in a moment.",
        tone: "error",
      });
    },
  });

  const link = linkQuery.data ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmRevoke(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0"
          aria-label="Share task"
          title="Share task"
        >
          <Share2 className="size-4" />
          <span className="hidden md:inline">Share</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 p-3" align="end">
        <div className="space-y-1">
          <p className="text-sm font-medium">Public link</p>
          <p className="text-xs text-muted-foreground">
            Anyone with the link can view this task and its directly related tasks without signing in.
            Internal comments stay hidden.
          </p>
        </div>
        {linkQuery.isPending ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : linkQuery.isError ? (
          <p className="text-xs text-destructive">Couldn't load the share link.</p>
        ) : link ? (
          <div className="space-y-2">
            <Input
              readOnly
              value={link.url}
              aria-label="Public link"
              className="h-8 text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void copy(link.url)}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {failed ? "Copy failed" : copied ? "Copied" : "Copy link"}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </Button>
              {confirmRevoke ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirmRevoke(true)}
                >
                  Revoke
                </Button>
              )}
            </div>
            {confirmRevoke ? (
              <div className="space-y-2 rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">
                  Revoke this link? It stops working immediately and cannot be restored.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={revokeLink.isPending}
                    onClick={() => revokeLink.mutate()}
                  >
                    {revokeLink.isPending ? "Revoking…" : "Revoke link"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Button
            size="sm"
            className="w-full"
            disabled={createLink.isPending}
            onClick={() => createLink.mutate()}
          >
            <Link2 className="h-3.5 w-3.5" />
            {createLink.isPending ? "Creating…" : "Create public link"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
