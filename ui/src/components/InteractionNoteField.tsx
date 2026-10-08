import { useId, useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { INTERACTION_NOTE_MAX_LENGTH } from "@tickernelz/paperclip-pro-shared";
import {
  MarkdownBody,
  type MarkdownExternalReferenceMap,
} from "@/components/MarkdownBody";
import type { MentionOption } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import type { IssueThreadInteraction } from "@/lib/issue-thread-interactions";
import { cn } from "@/lib/utils";
import { TaskChatRichInput } from "./task-chat/TaskChatRichInput";

/** Agent-authored interaction copy rendered as Markdown in the surrounding text style. */
export function InteractionInlineMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <MarkdownBody
      className={cn("paperclip-markdown-inherit", className)}
      mediaMode="reference"
      linkIssueReferences={false}
    >
      {children}
    </MarkdownBody>
  );
}

/** Read-only view of a submitted resolver note. */
export function InteractionNoteReceipt({
  note,
  externalReferences,
  className,
}: {
  note: string | null | undefined;
  externalReferences?: MarkdownExternalReferenceMap;
  className?: string;
}) {
  const value = interactionNoteValue(note);
  if (!value) return null;
  return (
    <div className={cn("text-sm", className)} data-testid="interaction-note-receipt">
      <div className="text-xs font-medium text-muted-foreground">Note</div>
      <MarkdownBody className="paperclip-markdown-inherit" externalReferences={externalReferences}>
        {value}
      </MarkdownBody>
    </div>
  );
}

/** Whether the server accepts a resolver note on this interaction. */
export function interactionAcceptsNote(interaction: IssueThreadInteraction): boolean {
  if (interaction.kind === "suggest_tasks") return false;
  if (interaction.kind !== "request_confirmation") return true;
  return !interaction.payload.toolAction && !interaction.payload.openwaApprovalRequestId;
}

/** Trimmed note Markdown, or undefined when the note is empty. */
export function interactionNoteValue(note: string | null | undefined): string | undefined {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
}

/** Whether a note exceeds the server's note length limit. */
export function interactionNoteTooLong(note: string | null | undefined): boolean {
  return (note?.trim().length ?? 0) > INTERACTION_NOTE_MAX_LENGTH;
}

/** Collapsed "Add note" affordance that opens a Markdown note editor with file attachments. */
export function InteractionNoteField({
  value,
  onChange,
  imageUploadHandler,
  mentions,
  disabled = false,
  onUploadingChange,
}: {
  value: string;
  onChange: (value: string) => void;
  imageUploadHandler?: (file: File) => Promise<string>;
  mentions?: MentionOption[];
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [open, setOpen] = useState(() => value.trim().length > 0);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const labelId = useId();

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="-ml-2 h-7 px-2 text-muted-foreground"
        aria-expanded={false}
        disabled={disabled}
        data-testid="interaction-note-toggle"
        onClick={() => {
          setFocusOnOpen(true);
          setOpen(true);
        }}
      >
        <MessageSquarePlus aria-hidden className="h-3.5 w-3.5" />
        Add note
      </Button>
    );
  }

  return (
    <div className="space-y-1" data-testid="interaction-note">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-xs font-medium text-muted-foreground">
          Note
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Remove note"
          disabled={disabled}
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
        >
          <X aria-hidden />
        </Button>
      </div>
      <TaskChatRichInput
        value={value}
        onChange={onChange}
        placeholder="Add context, links, or files for the agent"
        imageUploadHandler={imageUploadHandler}
        mentions={mentions}
        disabled={disabled}
        autoFocus={focusOnOpen}
        onUploadingChange={onUploadingChange}
        ariaLabelledBy={labelId}
        testId="interaction-note-editor"
        attachAriaLabel="Attach file to note"
        attachAnyFile
      />
      {interactionNoteTooLong(value) ? (
        <p className="text-xs text-destructive" role="alert">
          Notes can be at most {INTERACTION_NOTE_MAX_LENGTH.toLocaleString()} characters.
        </p>
      ) : null}
    </div>
  );
}
