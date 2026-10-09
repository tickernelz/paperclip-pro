import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, MessageSquare, ScrollText, Square } from "lucide-react";
import type { Issue } from "@tickernelz/paperclip-pro-shared";
import { Link } from "@/lib/router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { heartbeatsApi, type LiveRunForIssue } from "../../api/heartbeats";
import { issuesApi } from "../../api/issues";
import {
  createIssueDetailPath,
  rememberIssueDetailLocationState,
  withIssueDetailHeaderSeed,
} from "../../lib/issueDetailBreadcrumb";
import { describeDeliveryDowngrade } from "../../lib/message-delivery-command";
import { queryKeys } from "../../lib/queryKeys";
import { cn, formatDurationMs } from "../../lib/utils";
import { AgentAvatar } from "../AgentAvatar";
import type { LiveNowAncestor, LiveNowEntry } from "../TasksLiveNowSection";
import {
  LIVE_NOW_HEALTH_POSE,
  classifyLiveNowHealth,
  describeLiveActivity,
  formatSilence,
  lastLiveActivityMs,
  mostSevereSignal,
} from "./live-now-health";

interface LiveNowCardProps {
  companyId: string;
  entry: LiveNowEntry;
  issue: Issue | null;
  loadFailed: boolean;
  ancestors: readonly LiveNowAncestor[];
  truncatedAncestors: boolean;
  issueLinkState?: unknown;
  now: number;
  hiddenOnWide?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** One live task: who is on it, what they are doing, how healthy the run is, and the actions to steer or stop it. */
export function LiveNowCard({
  companyId,
  entry,
  issue,
  loadFailed,
  ancestors,
  truncatedAncestors,
  issueLinkState,
  now,
  hiddenOnWide = false,
}: LiveNowCardProps) {
  const queryClient = useQueryClient();
  const composerId = useId();
  const [composing, setComposing] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const pathId = issue?.identifier ?? entry.issueId;
  const identifier = issue?.identifier ?? entry.issueId.slice(0, 8);
  const title = issue?.title ?? (loadFailed ? "Task unavailable" : "Loading task…");
  const detailState = issue ? withIssueDetailHeaderSeed(issueLinkState, issue) : undefined;
  const taskPath = createIssueDetailPath(pathId);

  const primary = entry.runs[0]!;
  const signals = entry.runs.map((run) => classifyLiveNowHealth(run, now));
  const signal = mostSevereSignal(signals);
  const primarySignal = signals[0]!;
  const activityRun = entry.runs.reduce<LiveRunForIssue>((latest, run) =>
    (lastLiveActivityMs(run) ?? 0) > (lastLiveActivityMs(latest) ?? 0) ? run : latest,
  primary);
  const activity = describeLiveActivity(activityRun) ?? entry.runs.map(describeLiveActivity).find(Boolean) ?? null;
  const lastActivityMs = lastLiveActivityMs(activityRun);
  const snippetRun = entry.runs.find((run) => run.lastAssistantSnippet?.trim());
  const snippet = snippetRun?.lastAssistantSnippet?.trim() ?? null;
  const nextAction = entry.runs.find((run) => run.nextAction?.trim())?.nextAction?.trim() ?? null;
  const otherAgents = [...new Map(entry.runs.slice(1).filter((run) => run.agentId !== primary.agentId).map((run) => [run.agentId, run])).values()];
  const elapsed = entry.earliestStartedAt
    ? formatDurationMs(Math.max(0, now - new Date(entry.earliestStartedAt).getTime()))
    : "Queued";
  const runPath = `/agents/${primary.agentId}/runs/${primary.id}`;
  const ActivityIcon = activity?.icon ?? null;

  const stop = useMutation({
    mutationFn: () => heartbeatsApi.cancel(primary.id),
    onSuccess: () => {
      setFeedback(`Stopping ${primary.agentName}'s run`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(entry.issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(entry.issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(entry.issueId) });
    },
  });

  const openComposer = () => {
    setFeedback(null);
    setComposing((open) => !open);
  };

  return (
    <li
      data-live-now-issue-id={entry.issueId}
      data-live-health={signal.health}
      className={cn(
        "live-now-card relative flex w-(--live-now-card-peek) shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground sm:w-auto",
        hiddenOnWide && "sm:hidden",
      )}
    >
      {signal.health === "active" || signal.health === "starting" ? <span aria-hidden="true" className="live-now-sweep" /> : null}
      <div className="flex items-start gap-3 px-3 pt-3">
        <span className="relative shrink-0">
          <AgentAvatar
            agent={{ id: primary.agentId, name: primary.agentName, appearance: primary.agentAppearance, avatarUrl: primary.avatarUrl }}
            size={40}
            pose={LIVE_NOW_HEALTH_POSE[primarySignal.health]}
          />
          <span
            aria-hidden="true"
            className={cn(
              "live-now-health-dot absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card",
              (signal.health === "active" || signal.health === "thinking") && "live-now-breathe",
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span title={primary.agentName} className="truncate text-sm font-semibold">
              {primary.agentName}
            </span>
            {otherAgents.length > 0 ? (
              <span className="flex shrink-0 items-center" data-slot="tasks-live-now-other-agents">
                {otherAgents.map((run) => (
                  <span key={run.agentId} title={run.agentName} className="-ml-1 rounded-full bg-card ring-2 ring-card first:ml-0">
                    <AgentAvatar agent={{ id: run.agentId, name: run.agentName, appearance: run.agentAppearance }} size={20} label={run.agentName} />
                  </span>
                ))}
              </span>
            ) : null}
            <time
              dateTime={entry.earliestStartedAt ?? entry.latestStartAt}
              title="Time since the run started"
              className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
            >
              {elapsed}
            </time>
          </div>
          <span
            data-slot="tasks-live-now-health"
            className="live-now-health-pill mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-foreground"
          >
            <span aria-hidden="true" className="live-now-health-dot size-1.5 shrink-0 rounded-full" />
            <span className="truncate">{signal.label}</span>
          </span>
        </div>
      </div>

      <div className="mt-3 px-3">
        {ancestors.length > 0 || truncatedAncestors ? (
          <nav
            aria-label="Parent tasks"
            data-slot="tasks-live-now-path"
            className="mb-0.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
          >
            {truncatedAncestors ? <span aria-hidden="true">… ›</span> : null}
            {ancestors.map((ancestor, index) => (
              <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                {index > 0 ? <span aria-hidden="true">›</span> : null}
                <Link
                  to={createIssueDetailPath(ancestor.identifier ?? ancestor.id)}
                  title={ancestor.title}
                  className="truncate font-mono text-muted-foreground no-underline hover:text-foreground hover:underline"
                >
                  {ancestor.identifier ?? ancestor.id.slice(0, 8)}
                </Link>
              </span>
            ))}
            <span aria-hidden="true">›</span>
          </nav>
        ) : null}
        <Link
          to={taskPath}
          state={detailState}
          issuePrefetch={issue}
          disableIssueQuicklook
          onClickCapture={detailState ? () => rememberIssueDetailLocationState(pathId, detailState) : undefined}
          className="line-clamp-2 rounded-sm text-sm leading-5 font-medium text-foreground no-underline outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">{identifier}</span>
          {title}
        </Link>
      </div>

      <blockquote
        data-slot="tasks-live-now-snippet"
        className="live-now-quote mx-3 mt-2.5 line-clamp-2 min-h-10 border-l-2 pl-2.5 text-sm leading-5 text-muted-foreground"
      >
        {snippet ?? (nextAction ? `Next: ${nextAction}` : signal.health === "starting" ? "Warming up…" : "No message yet")}
      </blockquote>

      <div data-slot="tasks-live-now-status" className="mx-3 mt-2 flex h-5 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {ActivityIcon ? <ActivityIcon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 truncate">{activity?.text ?? "Waiting for the first event"}</span>
        {lastActivityMs !== null ? (
          <span className="ml-auto shrink-0 tabular-nums">{formatSilence(Math.max(0, now - lastActivityMs))} ago</span>
        ) : null}
      </div>

      {composing ? (
        <LiveNowSteerForm
          id={composerId}
          issueId={entry.issueId}
          agentName={primary.agentName}
          identifier={identifier}
          onSent={(message) => {
            setComposing(false);
            setFeedback(message);
          }}
          onCancel={() => setComposing(false)}
        />
      ) : null}
      {feedback || stop.error ? (
        <p
          role={stop.error ? "alert" : "status"}
          className={cn("mx-3 mt-2 text-xs", stop.error ? "text-destructive" : "text-muted-foreground")}
        >
          {stop.error ? errorMessage(stop.error, "Couldn’t stop the run.") : feedback}
        </p>
      ) : null}

      <div className="mt-auto pt-2.5">
        <div className="flex items-center gap-0.5 border-t border-border px-1.5 py-1.5">
          <Link
            to={taskPath}
            state={detailState}
            disableIssueQuicklook
            aria-label={`Open ${identifier}`}
            className={buttonVariants({ variant: "ghost", size: "xs" })}
          >
            <ArrowUpRight aria-hidden="true" />
            Open
          </Link>
          <Link
            to={runPath}
            aria-label={`Run transcript for ${primary.agentName}`}
            className={buttonVariants({ variant: "ghost", size: "xs" })}
          >
            <ScrollText aria-hidden="true" />
            Run
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={composing}
            aria-controls={composing ? composerId : undefined}
            aria-label={`Steer ${primary.agentName} on ${identifier}`}
            onClick={openComposer}
          >
            <MessageSquare aria-hidden="true" />
            Steer
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
            disabled={stop.isPending}
            aria-label={`Stop ${primary.agentName}'s run on ${identifier}`}
            onClick={() => setConfirmingStop(true)}
          >
            <Square aria-hidden="true" className="fill-current" />
            {stop.isPending ? "Stopping…" : "Stop"}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmingStop} onOpenChange={setConfirmingStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {primary.agentName}&apos;s run?</AlertDialogTitle>
            <AlertDialogDescription>
              {identifier} keeps its status and comments. The agent stops mid-turn, so any unsaved work in this run is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                setFeedback(null);
                stop.mutate();
              }}
            >
              Stop run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function LiveNowSteerForm({
  id,
  issueId,
  agentName,
  identifier,
  onSent,
  onCancel,
}: {
  id: string;
  issueId: string;
  agentName: string;
  identifier: string;
  onSent: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const fieldId = `${id}-field`;
  const send = useMutation({
    mutationFn: (text: string) =>
      issuesApi.addComment(issueId, text, undefined, undefined, undefined, crypto.randomUUID(), "steer"),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      onSent(
        describeDeliveryDowngrade(result)
          ?? (result?.deliveredAs === "steered" ? `Steered into ${agentName}'s turn` : `Sent to ${agentName}`),
      );
    },
  });
  const text = body.trim();

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!text || send.isPending) return;
    send.mutate(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      submit(event);
    }
  };

  return (
    <form id={id} data-slot="tasks-live-now-steer" className="mx-3 mt-3 space-y-2" onSubmit={submit}>
      <label htmlFor={fieldId} className="sr-only">
        Steer {agentName} on {identifier}
      </label>
      <Textarea
        id={fieldId}
        rows={2}
        autoFocus
        value={body}
        placeholder={`Steer ${agentName}…`}
        className="min-h-14 resize-none text-sm"
        disabled={send.isPending}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {send.error ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(send.error, "Couldn’t send the message.")}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-xs text-muted-foreground">Enter to send · Esc to cancel</span>
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!text || send.isPending}>
          {send.isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
