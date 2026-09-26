import { useMemo, useRef } from "react";
import type { ExecutionProjection } from "@tickernelz/paperclip-pro-shared";
import { useSecondTick } from "@/hooks/useSecondTick";
import { cn } from "@/lib/utils";
import type {
  TaskChatItem,
  TaskChatMessageItem,
  TaskChatRuntimeRequestDecision,
  TaskChatRuntimeRequestItem,
} from "./task-chat-model";
import { TaskChatAgentIdentity, TaskChatBubble } from "./TaskChatBubble";
import { TaskChatBubbleActions } from "./TaskChatBubbleActions";
import { formatTaskChatTimestamp } from "./task-chat-adapter";
import { TaskChatRunnerActivityGroup } from "./TaskChatRunnerActivityGroup";
import { TaskChatProtocolCard } from "./TaskChatProtocolCard";
import { TaskChatPlanPreviewCard } from "./TaskChatPlanPreviewCard";
import {
  buildTurnTimelineRows,
  isTerminalRunStatus,
  omitProgressRepeatedByResponse,
  paperclipRunnerFinalResponse,
  paperclipRunnerTimelineItems,
} from "./transcript-adapter";

function currentActivityStatusItems(
  items: readonly TaskChatItem[],
): readonly TaskChatItem[] {
  let boundaryIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.kind === "message" ||
      item.kind === "plan_document" ||
      (item.kind === "protocol" &&
        (item.surface === "runtime_request" ||
          item.surface === "run_result" ||
          item.surface === "run_terminal"))
    ) {
      boundaryIndex = index;
      break;
    }
  }
  return items.slice(boundaryIndex + 1);
}

function formatCompactDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function terminalStatusFailed(status: string): boolean {
  return (
    status === "failed" ||
    status === "cancelled" ||
    status === "timed_out" ||
    status === "interrupted"
  );
}

function RunnerTurnStatus({
  status,
  startedAtMs,
  finishedAtMs,
  continuedAfterSteering = false,
}: {
  status: string;
  startedAtMs: number | null;
  finishedAtMs?: number | null;
  continuedAfterSteering?: boolean;
}) {
  const terminal = isTerminalRunStatus(status);
  useSecondTick(!terminal && startedAtMs != null);
  const elapsedMs =
    startedAtMs == null
      ? null
      : Math.max(
          0,
          (terminal ? (finishedAtMs ?? Date.now()) : Date.now()) - startedAtMs,
        );
  const elapsed = formatCompactDuration(elapsedMs);

  const failed = terminalStatusFailed(status);
  const label = terminal ? (failed ? "Stopped" : "Worked") : "Working";
  const semanticLabel = terminal
    ? elapsed
      ? `${label} ${failed ? "after" : "for"} ${elapsed}`
      : label
    : `${label} for ${elapsed ?? "0s"}`;
  const visibleLabel = continuedAfterSteering
    ? `Continued after steering · ${semanticLabel}`
    : semanticLabel;
  // The elapsed readout advances once per second, so announcing the visible
  // string would flood a polite live region with a per-second ticker. The
  // visible text is hidden from assistive tech and the same sentence is
  // announced at minute granularity instead; the rendered text is unchanged.
  const announcedLabel =
    elapsedMs == null
      ? label
      : `${label} ${failed ? "after" : "for"} ${
          elapsedMs < 60_000
            ? "less than a minute"
            : `${Math.max(1, Math.round(elapsedMs / 60_000))} minutes`
        }`;

  return (
    <span
      className="min-w-0 truncate text-sm font-normal text-muted-foreground"
      data-testid="task-chat-turn-status-header"
      data-turn-position="identity"
      aria-live="polite"
      aria-atomic="true"
    >
      <span aria-hidden="true">{visibleLabel}</span>
      <span className="sr-only">
        {continuedAfterSteering ? `Continued after steering. ` : ""}
        {announcedLabel}
      </span>
    </span>
  );
}

function RunnerCurrentActivityTail({ status }: { status: string }) {
  if (isTerminalRunStatus(status)) return null;
  return <div className="mt-2 flex min-h-8 min-w-0 items-center gap-2 px-1 py-1 text-xs text-muted-foreground" data-testid="task-chat-current-activity" data-turn-position="tail">
    <span className="shimmer-text shimmer-text-muted" aria-live="polite" data-testid="task-chat-current-activity-label">Thinking</span>
  </div>;
}

export function TaskChatRunnerTurn({
  runId,
  turnId = runId ?? "turn",
  agentName,
  agentIcon,
  agent,
  items,
  status,
  startedAtMs,
  finishedAtMs,
  activityUnavailable = false,
  suppressFinal = false,
  continuedAfterSteering = false,
  onRuntimeRequestDecision,
}: {
  /** Stable identity used to clear replay-latched final text for the next turn. */
  runId?: string | null;
  turnId?: string | null;
  agentName?: string | null;
  agentIcon?: string | null;
  agent?: import("../AgentAvatar").AvatarAgent;
  items: readonly TaskChatItem[];
  status: string;
  execution?: ExecutionProjection | null;
  startedAtMs: number | null;
  finishedAtMs?: number | null;
  activityUnavailable?: boolean;
  /** Accepted wait/interaction authority overrides an early provider final. */
  suppressFinal?: boolean;
  /** The visible tail resumes the same native run after an accepted steer. */
  continuedAfterSteering?: boolean;
  onRuntimeRequestDecision?: (
    item: TaskChatRuntimeRequestItem,
    decision: TaskChatRuntimeRequestDecision,
  ) => void | Promise<void>;
}) {
  const terminal = isTerminalRunStatus(status);
  // Every parent render (each poll, each composer keystroke) otherwise re-walks
  // the whole transcript: timeline filter, final-response resolution and the
  // progress dedupe are all O(items). Keyed on the items array identity the host
  // already memoizes, so an unchanged transcript costs nothing.
  const projection = useMemo(() => {
    const observedFinal = suppressFinal
      ? undefined
      : paperclipRunnerFinalResponse(items, {
          allowFallback: terminal,
        });
    return {
      timelineItems: paperclipRunnerTimelineItems(items),
      yielded: items.some(
        (item) =>
          item.kind === "protocol" &&
          item.surface === "run_result" &&
          item.disposition === "yielded",
      ),
      observedFinal,
      observedProviderText: Boolean(
        observedFinal &&
        items.some(
          (item) =>
            item.kind === "message" &&
            item.id === observedFinal.id &&
            item.channel !== "progress",
        ),
      ),
    };
  }, [items, suppressFinal, terminal]);
  const { observedFinal, observedProviderText } = projection;
  // A reconnect/replay can briefly rebuild the transcript without the final
  // item (or with an earlier, shorter prefix). Provider-authored final text
  // always replaces a structured summary fallback, even when it is shorter;
  // within either class, displayed answer text remains monotonic.
  const finalRef = useRef<{
    runId?: string | null;
    item?: TaskChatMessageItem;
    providerText?: boolean;
  }>({ runId });
  if (finalRef.current.runId !== runId) finalRef.current = { runId };
  // A provider final can arrive before the accepted yielded result. Clear any
  // replay latch once the control plane establishes that this turn is waiting
  // for continuation rather than presenting a durable assistant reply.
  if (projection.yielded || suppressFinal) finalRef.current = { runId };
  if (
    observedFinal &&
    (!finalRef.current.item ||
      (observedProviderText && !finalRef.current.providerText) ||
      (observedProviderText === Boolean(finalRef.current.providerText) &&
        observedFinal.text.length >= finalRef.current.item.text.length))
  ) {
    finalRef.current.item = observedFinal;
    finalRef.current.providerText = observedProviderText;
  }
  const final = finalRef.current.item;
  const finalText = final?.text;
  const phaseScope = useMemo(() => turnId ?? runId ?? 'turn', [turnId, runId]);
  const currentActivityItems = useMemo(
    () => currentActivityStatusItems(projection.timelineItems),
    [projection],
  );
  const timelineRows = useMemo(
    () =>
      buildTurnTimelineRows(
        omitProgressRepeatedByResponse(projection.timelineItems, finalText),
        !terminal,
        phaseScope,
      ),
    [projection, finalText, terminal, phaseScope],
  );
  // Identical elements let React skip the timeline subtree entirely on the many
  // renders that leave the rows alone; the scroll anchor and the expansion
  // memory both stay bound to the same row ids across those renders.
  const timeline = useMemo(
    () =>
      timelineRows.length === 0 ? null : (
        <div
          className="flex min-w-0 flex-col gap-2 py-1"
          data-testid="task-chat-turn-timeline"
        >
          {timelineRows.map((row) => (
            <div
              className="min-w-0"
              key={`${runId ?? "run"}:${row.id}`}
              data-testid="task-chat-turn-timeline-row"
              data-timeline-row-id={row.id}
              data-thread-anchor={row.id}
            >
              {row.kind === "activity_phase" ? (
                <TaskChatRunnerActivityGroup item={row} />
              ) : row.kind === "plan_document" ? (
                <TaskChatPlanPreviewCard
                  source={{ kind: "saved", document: row.document }}
                  testId={
                    row.placement === "fallback"
                      ? "task-chat-plan-preview-fallback"
                      : "task-chat-plan-preview"
                  }
                />
              ) : row.kind === "protocol" ? (
                <TaskChatProtocolCard
                  item={row}
                  onRuntimeRequestDecision={onRuntimeRequestDecision}
                />
              ) : null}
            </div>
          ))}
        </div>
      ),
    [timelineRows, runId, onRuntimeRequestDecision],

  );

  return (
    <div
      className="flex min-w-0 flex-col"
      data-testid="task-chat-runner-turn"
      data-phase={status === "queued" ? "startup" : undefined}
    >
      <div
        className={cn(
          "flex min-h-8 min-w-0 items-center gap-2",
          status === "queued" ? "pb-1" : "pb-1 pt-2",
        )}
        data-testid="task-chat-runner-identity-row"
      >
        {agentName ? (
          <TaskChatAgentIdentity agentName={agentName} agentIcon={agentIcon} agent={agent} />
        ) : null}
        <RunnerTurnStatus
          status={status}
          startedAtMs={startedAtMs}
          finishedAtMs={finishedAtMs}
          continuedAfterSteering={continuedAfterSteering}
        />
      </div>
      {activityUnavailable ? (
        <div
          className="px-1 py-1 text-xs text-muted-foreground"
          role="status"
          data-testid="task-chat-activity-unavailable"
        >
          Live runner activity is temporarily unavailable. Retrying…
        </div>
      ) : null}
      {timeline}
      {final ? (
        <div
          className="w-full"
          data-testid="task-chat-final-response"
        >
          <TaskChatBubble
            item={{ ...final, authorName: agentName ?? undefined, agentIcon, agent, timestamp: final.timestamp ?? formatTaskChatTimestamp(final.atMs) }}
            animateEntry={false}
            hideAgentIdentity={!continuedAfterSteering}
            actions={<TaskChatBubbleActions copyText={final.text} />}
          />
        </div>
      ) : null}
      {!final && currentActivityItems.length === 0 ? <RunnerCurrentActivityTail status={status} /> : null}
    </div>
  );
}
