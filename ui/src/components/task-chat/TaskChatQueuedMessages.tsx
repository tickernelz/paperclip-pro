import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Ungroup,
} from "lucide-react";
import type {
  IssueQueuedCommentEntry,
  IssueQueuedCommentQueue,
} from "@tickernelz/paperclip-pro-shared";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Button } from "@/components/ui/button";

type QueueAction = "steer" | "interrupt" | "discard" | null;

export function reorderQueuedMessageEntries(
  entries: IssueQueuedCommentEntry[],
  activeId: string,
  overId: string,
) {
  if (entries.some((entry) => entry.source?.kind === "interaction")) return null;
  const from = entries.findIndex((entry) => entry.comment.id === activeId);
  const to = entries.findIndex((entry) => entry.comment.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  return arrayMove(entries, from, to).map((entry, position) => ({
    ...entry,
    position,
  }));
}

function queueActionErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const body = (error as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) return null;
  const directCode = (body as { code?: unknown }).code;
  if (typeof directCode === "string") return directCode;
  const details = (body as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return null;
  const detailCode = (details as { code?: unknown }).code;
  return typeof detailCode === "string" ? detailCode : null;
}

export interface TaskChatQueuedMessagesProps {
  queue: IssueQueuedCommentQueue;
  onEdit: (commentId: string) => void;
  onReorder: (orderedCommentIds: string[], revision: string) => Promise<void>;
  onSteer: (commentId: string, revision: string) => Promise<void>;
  onInterrupt?: () => Promise<void>;
  onDiscard: (commentId: string, revision: string) => Promise<void>;
}

function SortableQueuedMessage({
  entry,
  count,
  queue,
  busy,
  queueMutationDisabled,
  action,
  onEdit,
  onSteer,
  onInterrupt,
  onDiscard,
  onShowIndividually,
}: {
  entry: IssueQueuedCommentEntry;
  count: number;
  queue: IssueQueuedCommentQueue;
  busy: boolean;
  queueMutationDisabled: boolean;
  action: QueueAction;
  onEdit: () => void;
  onSteer: () => void;
  onInterrupt?: () => void;
  onDiscard: () => void;
  onShowIndividually?: () => void;
}) {
  const immutableResponse = entry.source?.kind === "interaction";
  const label = immutableResponse ? entry.comment.body.split("\n")[0] : entry.comment.body;
  const sortable = useSortable({
    id: entry.comment.id,
    disabled: queueMutationDisabled || immutableResponse,
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const steerDisabled =
    queueMutationDisabled || queue.steeringDisposition !== "available";
  const steerTitle =
    queue.steeringDisposition === "unsupported"
      ? "This runner does not support steering"
      : queue.steeringDisposition === "temporarily_unavailable"
        ? "Steering is temporarily unavailable"
        : "Steer this message into the active turn";

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "group flex h-11 min-w-0 items-center gap-1 border-b border-border/55 bg-card/95 px-2.5 text-sm last:border-b-0",
        sortable.isDragging &&
          "relative z-20 rounded-lg border border-border shadow-lg",
      )}
      data-testid={`task-chat-queued-message-${entry.comment.id}`}
    >
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        disabled={queueMutationDisabled || immutableResponse}
        aria-label={`Reorder queued message: ${entry.comment.body}`}
        className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden />
      </button>

      <CornerDownRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate px-1" title={entry.comment.body}>
        {label}
      </span>
      {count > 1 ? (
        <span
          className="shrink-0 rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground"
          title={`${count} identical queued messages`}
          data-testid={`task-chat-queued-count-${entry.comment.id}`}
        >
          ×{count}
        </span>
      ) : null}

      {queue.protocol === "legacy" || entry.source?.requiresFreshSession ? (
        <button
          type="button"
          onClick={onInterrupt}
          disabled={busy || !queue.queueId || !onInterrupt}
          title={queue.targetRunId ? "Interrupt the active turn and send queued messages" : "Send queued messages now"}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          data-testid={`task-chat-queued-interrupt-${entry.comment.id}`}
        >
          {action === "interrupt" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CornerDownRight className="h-3.5 w-3.5" aria-hidden />
          )}
          Interrupt
        </button>
      ) : (
        <button
          type="button"
          onClick={onSteer}
          disabled={steerDisabled}
          title={steerTitle}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          data-testid={`task-chat-queued-steer-${entry.comment.id}`}
        >
          {action === "steer" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CornerDownRight className="h-3.5 w-3.5" aria-hidden />
          )}
          Steer
        </button>
      )}

      <button
        type="button"
        onClick={onDiscard}
        disabled={
          busy ||
          (!queue.queueId && !entry.comment.id.startsWith("optimistic-")) ||
          !entry.canDiscard
        }
        title="Discard queued message"
        aria-label={`Discard queued message: ${entry.comment.body}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
        data-testid={`task-chat-queued-discard-${entry.comment.id}`}
      >
        {action === "discard" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={queueMutationDisabled || immutableResponse}
            title="Queued message actions"
            aria-label={`Queued message actions: ${entry.comment.body}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem disabled={!entry.canEdit} onSelect={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit message
          </DropdownMenuItem>
          {onShowIndividually ? (
            <DropdownMenuItem onSelect={onShowIndividually}>
              <Ungroup className="h-4 w-4" aria-hidden />
              Show individually
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const COLLAPSED_QUEUE_THRESHOLD = 3;

interface QueuedMessageRow {
  entry: IssueQueuedCommentEntry;
  commentIds: string[];
}

function groupableEntry(entry: IssueQueuedCommentEntry) {
  return entry.source?.kind !== "interaction";
}

function groupQueuedMessageRows(
  entries: IssueQueuedCommentEntry[],
  individualIds: ReadonlySet<string>,
  grouping: boolean,
): QueuedMessageRow[] {
  const rows: QueuedMessageRow[] = [];
  for (const entry of entries) {
    const previous = rows.at(-1);
    if (
      grouping &&
      previous &&
      previous.entry.comment.body === entry.comment.body &&
      groupableEntry(previous.entry) &&
      groupableEntry(entry) &&
      !individualIds.has(previous.entry.comment.id) &&
      !individualIds.has(entry.comment.id)
    ) {
      previous.commentIds.push(entry.comment.id);
    } else {
      rows.push({ entry, commentIds: [entry.comment.id] });
    }
  }
  return rows;
}

/** Compact production queue shown immediately above the default task composer. */
export function TaskChatQueuedMessages({
  queue,
  onEdit,
  onReorder,
  onSteer,
  onInterrupt,
  onDiscard,
}: TaskChatQueuedMessagesProps) {
  const [entries, setEntries] = useState(queue.entries);
  const [pending, setPending] = useState<{
    commentIds: readonly string[];
    action: Exclude<QueueAction, null>;
    scope: "row" | "all";
  } | null>(null);
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [individualIds, setIndividualIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [visibleError, setVisibleError] = useState<string | null>(null);
  const latest = useRef({ revision: queue.revision, onDiscard });
  const listId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    latest.current = { revision: queue.revision, onDiscard };
  }, [queue.revision, onDiscard]);

  useEffect(() => {
    setEntries(queue.entries);
  }, [queue.entries, queue.revision]);

  const rows = useMemo(
    () => groupQueuedMessageRows(entries, individualIds, !dragging),
    [entries, individualIds, dragging],
  );
  const collapsible = entries.length > COLLAPSED_QUEUE_THRESHOLD;
  const visibleRows = collapsible && !expanded ? rows.slice(0, 1) : rows;
  const ids = useMemo(
    () => visibleRows.map((row) => row.entry.comment.id),
    [visibleRows],
  );
  const discardAllIds = entries
    .filter(
      (entry) => entry.canDiscard && !entry.comment.id.startsWith("optimistic-"),
    )
    .map((entry) => entry.comment.id);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (
      !queue.queueId ||
      !over ||
      active.id === over.id ||
      reordering ||
      pending
    )
      return;
    const previous = entries;
    const next = reorderQueuedMessageEntries(
      entries,
      String(active.id),
      String(over.id),
    );
    if (!next) return;
    const orderedIds = next.map((entry) => entry.comment.id);
    const activeCommentId = String(active.id);
    const to = next.findIndex((entry) => entry.comment.id === activeCommentId);
    setEntries(next);
    setReordering(true);
    setVisibleError(null);
    setAnnouncement(
      `Moved queued message to position ${to + 1} of ${next.length}.`,
    );
    try {
      await onReorder(orderedIds, queue.revision);
    } catch (error) {
      setEntries(previous);
      setAnnouncement("");
      setVisibleError(
        queueActionErrorCode(error) === "queued_comment_revision_conflict"
          ? "The queue changed in another session. Its latest order has been restored."
          : "Couldn’t reorder. Previous order restored.",
      );
    } finally {
      setReordering(false);
    }
  }

  async function runRowAction(
    commentIds: readonly string[],
    action: Exclude<QueueAction, null>,
    scope: "row" | "all" = "row",
  ) {
    const [commentId] = commentIds;
    if (!commentId) return;
    const locallyDiscardable =
      action === "discard" &&
      commentIds.every((id) => id.startsWith("optimistic-"));
    if (
      pending ||
      reordering ||
      (!queue.queueId && action !== "interrupt" && !locallyDiscardable)
    ) {
      return;
    }
    const previous = entries;
    const discardsMany = action === "discard" && commentIds.length > 1;
    setPending({ commentIds, action, scope });
    setVisibleError(null);
    setAnnouncement(
      action === "steer"
        ? "Steering queued message."
        : action === "interrupt"
          ? "Sending queued messages."
          : discardsMany
            ? "Discarding queued messages."
            : "Discarding queued message.",
    );
    if (action === "steer") {
      setEntries((current) =>
        current.filter((entry) => entry.comment.id !== commentId),
      );
    }
    try {
      if (action === "steer") await onSteer(commentId, latest.current.revision);
      else if (action === "interrupt") await onInterrupt?.();
      else {
        for (const id of commentIds) {
          await latest.current.onDiscard(id, latest.current.revision);
          setEntries((current) =>
            current.filter((entry) => entry.comment.id !== id),
          );
        }
      }
      setAnnouncement(
        action === "steer"
          ? "Message steered into the active turn."
          : action === "interrupt"
            ? "Queued messages will be sent when the previous run has stopped."
            : discardsMany
              ? `${commentIds.length} queued messages discarded.`
              : "Queued message discarded.",
      );
    } catch (error) {
      if (action === "steer") setEntries(previous);
      setAnnouncement("");
      const code = queueActionErrorCode(error);
      setVisibleError(
        code === "queued_comment_already_dispatching"
          ? "Too late to discard: this message is already being sent."
          : code === "steering_identity_mismatch"
            ? "This message answers to a different user than the running turn. It stays queued for the next turn."
            : action === "steer"
              ? "Couldn’t steer. Message is still queued."
              : action === "interrupt"
                ? "Couldn’t interrupt. Message is still queued."
                : code === "queued_comment_revision_conflict"
                  ? "The queue changed in another session. Review it and try again."
                  : "Couldn’t discard. Message is still queued.",
      );
    } finally {
      setPending(null);
    }
  }

  if (entries.length === 0) return null;

  const busy = Boolean(pending || reordering);
  const queueMutationDisabled = Boolean(
    !queue.queueId || pending || reordering,
  );

  return (
    <div
      className="relative z-0 mx-3 -mb-px overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-border/75 bg-card shadow-sm"
      data-testid="task-chat-queued-messages"
      aria-label="Queued messages"
    >
      <div
        className="flex h-8 min-w-0 items-center gap-1 border-b border-border/55 pl-3 pr-1.5 text-xs text-muted-foreground"
        data-testid="task-chat-queued-header"
      >
        <span className="min-w-0 flex-1 truncate font-medium">
          {entries.length} queued
        </span>
        {collapsible ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((current) => !current)}
            className="text-muted-foreground"
            data-testid="task-chat-queued-toggle"
          >
            {expanded ? (
              <ChevronUp aria-hidden />
            ) : (
              <ChevronDown aria-hidden />
            )}
            {expanded ? "Show less" : `Show all ${entries.length}`}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setConfirmDiscardAll(true)}
          disabled={busy || !queue.queueId || discardAllIds.length === 0}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          data-testid="task-chat-queued-discard-all"
        >
          {pending?.scope === "all" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Trash2 aria-hidden />
          )}
          Discard all
        </Button>
      </div>
      {queue.executionWait && (
        <div role="status" aria-live="polite" className="px-3 py-1.5 text-xs text-muted-foreground">
          {queue.executionWait.message}
        </div>
      )}
      <div
        id={listId}
        className="max-h-44 overflow-y-auto overscroll-contain"
        data-testid="task-chat-queued-list"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setDragging(true)}
          onDragCancel={() => setDragging(false)}
          onDragEnd={(event) => {
            setDragging(false);
            void handleDragEnd(event);
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {visibleRows.map((row) => {
              const { entry, commentIds } = row;
              const action =
                pending?.scope === "row" &&
                pending.commentIds.includes(entry.comment.id)
                  ? pending.action
                  : null;
              return (
                <SortableQueuedMessage
                  key={entry.comment.id}
                  entry={entry}
                  count={commentIds.length}
                  queue={queue}
                  busy={busy}
                  queueMutationDisabled={queueMutationDisabled}
                  action={action}
                  onEdit={() => onEdit(entry.comment.id)}
                  onSteer={() => void runRowAction([entry.comment.id], "steer")}
                  onInterrupt={
                    onInterrupt
                      ? () => void runRowAction([entry.comment.id], "interrupt")
                      : undefined
                  }
                  onDiscard={() => void runRowAction(commentIds, "discard")}
                  onShowIndividually={
                    commentIds.length > 1
                      ? () =>
                          setIndividualIds(
                            (current) => new Set([...current, ...commentIds]),
                          )
                      : undefined
                  }
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      {visibleError ? (
        <div
          role="status"
          aria-live="polite"
          className="border-t border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
        >
          {visibleError}
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <AlertDialog open={confirmDiscardAll} onOpenChange={setConfirmDiscardAll}>
        <AlertDialogContent data-testid="task-chat-queued-discard-all-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard all queued messages?</AlertDialogTitle>
            <AlertDialogDescription>
              {discardAllIds.length === 1
                ? "1 queued message will be removed and never sent."
                : `${discardAllIds.length} queued messages will be removed and never sent.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void runRowAction(discardAllIds, "discard", "all")}
              data-testid="task-chat-queued-discard-all-confirm"
            >
              Discard all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
