import { TextAttachmentContext } from "@/context/TextAttachmentContext";
import { isTextAttachment } from "@/lib/issue-attachments";
import { useContext, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueAttachment } from "@tickernelz/wardmote-shared";
import { Download, ExternalLink, FileText, Maximize2, Trash2 } from "lucide-react";
import { AttachmentIcon } from "@/components/icons/attachment-icon";
import { Button } from "@/components/ui/button";
import { FoldCurtain } from "./FoldCurtain";
import { MarkdownBody } from "./MarkdownBody";
import { OutputFileTile } from "./issue-output/OutputFileTile";
import { OutputVideoPlayer } from "./issue-output/OutputVideoPlayer";
import { formatBytes } from "@/lib/issue-output";
import {
  attachmentDownloadPath,
  attachmentFilename,
  attachmentOpenPath,
  isImageAttachment,
  isMarkdownAttachment,
  isVideoAttachment,
} from "@/lib/issue-attachments";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PurgedFileNotice } from "./RetentionAwareContent";

interface IssueAttachmentsSectionProps {
  attachments: IssueAttachment[];
  uploadButton?: ReactNode;
  error?: string | null;
  dragActive?: boolean;
  deletePending?: boolean;
  onDelete?: (attachmentId: string) => void;
  onImageClick: (attachment: IssueAttachment) => void;
  onDragEnter?: (evt: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (evt: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (evt: DragEvent<HTMLDivElement>) => void;
  onDrop?: (evt: DragEvent<HTMLDivElement>) => void;
}

async function fetchAttachmentText(attachment: IssueAttachment) {
  const response = await fetch(attachment.contentPath, {
    headers: { Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
  });
  if (!response.ok) {
    throw new Error(`Unable to load attachment preview (${response.status})`);
  }
  return response.text();
}

function AttachmentActions({
  attachment,
  onDelete,
  deletePending,
  onPreview,
}: {
  attachment: IssueAttachment;
  onDelete?: (attachmentId: string) => void;
  deletePending?: boolean;
  onPreview?: (attachment: IssueAttachment) => void;
}) {
  const openText = useContext(TextAttachmentContext);
  const openInPanel = (event: React.MouseEvent) => {
    if (openText && isTextAttachment(attachment) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openText(attachment.id, attachmentFilename(attachment)); }
  };
  const filename = attachmentFilename(attachment);
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onPreview ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Browse gallery"
          aria-label={`Browse ${filename} in gallery`}
          onClick={() => onPreview(attachment)}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="icon-sm" title="Open in new tab">
        <a href={attachmentOpenPath(attachment)} onClick={openInPanel} target="_blank" rel="noreferrer" aria-label={`Open ${filename}`}>
          <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
      <Button asChild variant="ghost" size="icon-sm" title="Download">
        <a href={attachmentDownloadPath(attachment)} aria-label={`Download ${filename}`}>
          <Download className="h-4 w-4" />
        </a>
      </Button>
      {onDelete ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete attachment"
          onClick={() => onDelete(attachment.id)}
          disabled={deletePending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function AttachmentMeta({ attachment }: { attachment: IssueAttachment }) {
  return (
    <p className="mt-0.5 text-(length:--text-micro) text-ink-3">
      Attachment · {attachment.contentType} · {formatBytes(attachment.byteSize)}
    </p>
  );
}

function MarkdownAttachmentCard({
  attachment,
  onDelete,
  deletePending,
}: {
  attachment: IssueAttachment;
  onDelete?: (attachmentId: string) => void;
  deletePending?: boolean;
}) {
  const openText = useContext(TextAttachmentContext);
  const openInPanel = (event: React.MouseEvent) => {
    if (openText && isTextAttachment(attachment) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openText(attachment.id, attachmentFilename(attachment)); }
  };
  const filename = attachmentFilename(attachment);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.attachmentPreview(attachment.id),
    queryFn: () => fetchAttachmentText(attachment),
  });

  return (
    <div id={`attachment-${attachment.id}`} className="scroll-mt-20 rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-ink-3" />
            <a href={attachmentOpenPath(attachment)} onClick={openInPanel} className="truncate text-sm font-medium hover:underline" title={filename}>{filename}</a>
          </div>
          <AttachmentMeta attachment={attachment} />
        </div>
        <AttachmentActions attachment={attachment} onDelete={onDelete} deletePending={deletePending} />
      </div>
      <div className="mt-3 rounded-md hover:bg-bg-3/10">
        {isLoading ? (
          <p className="px-1 py-2 text-xs text-ink-3">Loading preview...</p>
        ) : error ? (
          <p className="px-1 py-2 text-xs text-bad">Could not load markdown preview.</p>
        ) : (
          <FoldCurtain>
            <MarkdownBody className="wardmote-edit-in-place-content min-h-(--sz-220px) text-sm leading-7" softBreaks={false}>
              {data ?? ""}
            </MarkdownBody>
          </FoldCurtain>
        )}
      </div>
    </div>
  );
}

function VideoAttachmentCard({
  attachment,
  onDelete,
  deletePending,
  onPreview,
}: {
  attachment: IssueAttachment;
  onDelete?: (attachmentId: string) => void;
  deletePending?: boolean;
  onPreview?: (attachment: IssueAttachment) => void;
}) {
  const filename = attachmentFilename(attachment);
  return (
    <Card id={`attachment-${attachment.id}`} className="block scroll-mt-20 overflow-hidden py-0">
      <OutputVideoPlayer src={attachment.contentPath} title={filename} />
      <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-ink">{filename}</p>
          <AttachmentMeta attachment={attachment} />
        </div>
        <AttachmentActions
          attachment={attachment}
          onDelete={onDelete}
          deletePending={deletePending}
          onPreview={onPreview}
        />
      </div>
    </Card>
  );
}

function GenericAttachmentRow({
  attachment,
  onDelete,
  deletePending,
}: {
  attachment: IssueAttachment;
  onDelete?: (attachmentId: string) => void;
  deletePending?: boolean;
}) {
  const openText = useContext(TextAttachmentContext);
  const openInPanel = (event: React.MouseEvent) => {
    if (openText && isTextAttachment(attachment) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openText(attachment.id, attachmentFilename(attachment)); }
  };
  const filename = attachmentFilename(attachment);
  return (
    <Card id={`attachment-${attachment.id}`} className="flex-row scroll-mt-20 items-center gap-2.5 p-2">
      <OutputFileTile contentType={attachment.contentType} />
      <div className="min-w-0 flex-1">
        <a
          href={attachmentOpenPath(attachment)} onClick={openInPanel}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium text-ink hover:underline"
          title={filename}
        >
          {filename}
        </a>
        <p className="truncate text-(length:--text-micro) text-ink-3">
          Attachment · {attachment.contentType} · {formatBytes(attachment.byteSize)}
        </p>
      </div>
      <AttachmentActions attachment={attachment} onDelete={onDelete} deletePending={deletePending} />
    </Card>
  );
}

function PurgedAttachmentRow({
  attachment,
  onDelete,
  deletePending,
}: {
  attachment: IssueAttachment;
  onDelete?: (attachmentId: string) => void;
  deletePending?: boolean;
}) {
  const filename = attachmentFilename(attachment);
  return (
    <Card id={`attachment-${attachment.id}`} data-purged-attachment="" className="flex-row scroll-mt-20 items-center gap-2.5 p-2">
      <OutputFileTile contentType={attachment.contentType} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-3" title={filename}>
          {filename}
        </p>
        <PurgedFileNotice purgedAt={attachment.purgedAt} className="mt-1" />
      </div>
      {onDelete ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete attachment"
          onClick={() => onDelete(attachment.id)}
          disabled={deletePending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </Card>
  );
}

export function IssueAttachmentsSection({
  attachments,
  uploadButton,
  error,
  dragActive = false,
  deletePending = false,
  onDelete,
  onImageClick,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: IssueAttachmentsSectionProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { imageAttachments, markdownAttachments, videoAttachments, genericAttachments, purgedAttachments } = useMemo(() => {
    const images: IssueAttachment[] = [];
    const markdown: IssueAttachment[] = [];
    const videos: IssueAttachment[] = [];
    const generic: IssueAttachment[] = [];
    const purged: IssueAttachment[] = [];

    for (const attachment of attachments) {
      if (attachment.purgedAt) purged.push(attachment);
      else if (isImageAttachment(attachment)) images.push(attachment);
      else if (isMarkdownAttachment(attachment)) markdown.push(attachment);
      else if (isVideoAttachment(attachment)) videos.push(attachment);
      else generic.push(attachment);
    }

    return {
      imageAttachments: images,
      markdownAttachments: markdown,
      videoAttachments: videos,
      genericAttachments: generic,
      purgedAttachments: purged,
    };
  }, [attachments]);

  const requestDelete = (attachmentId: string) => setConfirmDeleteId(attachmentId);
  const confirmDelete = (attachmentId: string) => {
    if (!onDelete) return;
    onDelete(attachmentId);
    setConfirmDeleteId(null);
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg transition-colors",
        dragActive && "bg-accent/5",
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AttachmentIcon className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
          <h3 className="text-sm font-medium text-ink-3">Attachments</h3>
          <span className="text-xs text-ink-3">{attachments.length}</span>
        </div>
        {uploadButton}
      </div>

      {error && (
        <p className="text-xs text-bad">{error}</p>
      )}

      {imageAttachments.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {imageAttachments.map((attachment) => (
            <div
              key={attachment.id}
              id={`attachment-${attachment.id}`}
              className="group relative aspect-square cursor-pointer scroll-mt-20 overflow-hidden rounded-lg border border-line bg-bg-3/10"
              onClick={() => onImageClick(attachment)}
            >
              <img
                src={attachment.contentPath}
                alt={attachment.originalFilename ?? "attachment"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
              {onDelete && confirmDeleteId === attachment.id ? (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60"
                  onClick={(event) => event.stopPropagation()}
                >
                  <p className="text-xs font-medium text-white">Delete?</p>
                  <div className="flex gap-1.5">
                    <Button variant="delete" size="xs"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        confirmDelete(attachment.id);
                      }}
                      disabled={deletePending}
                    >
                      Yes
                    </Button>
                    <button
                      type="button"
                      className="rounded bg-bg-3 px-2 py-0.5 text-xs hover:bg-bg-3/80"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                    >
                      No
                    </button>
                  </div>
                </div>
              ) : onDelete ? (
                <Button
                  type="button"
                  variant="delete"
                  size="icon-xs"
                  className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDelete(attachment.id);
                  }}
                  title="Delete attachment"
                  aria-label="Delete attachment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {markdownAttachments.length > 0 && (
        <div className="space-y-3">
          {markdownAttachments.map((attachment) => (
            <MarkdownAttachmentCard
              key={attachment.id}
              attachment={attachment}
              onDelete={onDelete ? requestDelete : undefined}
              deletePending={deletePending}
            />
          ))}
        </div>
      )}

      {videoAttachments.length > 0 && (
        <div className="space-y-3">
          {videoAttachments.map((attachment) => (
            <VideoAttachmentCard
              key={attachment.id}
              attachment={attachment}
              onDelete={onDelete ? requestDelete : undefined}
              deletePending={deletePending}
              onPreview={onImageClick}
            />
          ))}
        </div>
      )}

      {genericAttachments.length > 0 && (
        <div className="space-y-2">
          {genericAttachments.map((attachment) => (
            <GenericAttachmentRow
              key={attachment.id}
              attachment={attachment}
              onDelete={onDelete ? requestDelete : undefined}
              deletePending={deletePending}
            />
          ))}
        </div>
      )}

      {purgedAttachments.length > 0 && (
        <div className="space-y-2">
          {purgedAttachments.map((attachment) => (
            <PurgedAttachmentRow
              key={attachment.id}
              attachment={attachment}
              onDelete={onDelete ? requestDelete : undefined}
              deletePending={deletePending}
            />
          ))}
        </div>
      )}

      {onDelete && confirmDeleteId && !imageAttachments.some((attachment) => attachment.id === confirmDeleteId) ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-bad/20 bg-bad/5 px-4 py-3">
          <p className="text-sm font-medium text-bad">Delete this attachment? This cannot be undone.</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)} disabled={deletePending}>
              Cancel
            </Button>
            <Button variant="delete" size="sm" onClick={() => confirmDelete(confirmDeleteId)} disabled={deletePending}>
              {deletePending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
