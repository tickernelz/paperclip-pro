import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileDown } from "lucide-react";
import { documentExportExtension, documentExportFileName } from "@tickernelz/paperclip-pro-shared";
import { issuesApi } from "@/api/issues";
import { copyTextToClipboard } from "@/lib/clipboard";
import { downloadBlob, downloadTextFile } from "@/lib/document-export";
import { cn } from "@/lib/utils";

type ExportAction = "copy" | "download" | "pdf";

interface DocumentExportActionsProps {
  issueId: string;
  documentKey: string;
  title: string;
  format?: string | null;
  /** Full body when the caller already has it; otherwise it is fetched on demand. */
  body?: string;
  className?: string;
}

const ACTION_BUTTON_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50";

/** Copy / download / export-to-PDF for one issue document artifact. */
export function DocumentExportActions({
  issueId,
  documentKey,
  title,
  format,
  body,
  className,
}: DocumentExportActionsProps) {
  const [pending, setPending] = useState<ExportAction | null>(null);
  const [done, setDone] = useState<ExportAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const run = useCallback(
    async (action: ExportAction, task: () => Promise<void>) => {
      setPending(action);
      setError(null);
      try {
        await task();
        setDone(action);
      } catch (cause) {
        setDone(null);
        setError(cause instanceof Error ? cause.message : "Export failed");
      } finally {
        setPending(null);
      }
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setDone(null);
        setError(null);
      }, 2000);
    },
    [],
  );

  const resolveBody = useCallback(
    async () => body ?? (await issuesApi.getDocument(issueId, documentKey)).body,
    [body, documentKey, issueId],
  );

  const copyLabel = error && done === null ? "Copy failed" : done === "copy" ? "Copied!" : "Copy full content";
  const downloadLabel = done === "download" ? "Downloaded!" : "Download source";
  const pdfLabel = done === "pdf" ? "Downloaded!" : "Export to PDF";

  return (
    <div className={cn("flex items-center gap-0.5", className)} data-testid="document-export-actions">
      <button
        type="button"
        className={ACTION_BUTTON_CLASS}
        disabled={pending !== null}
        aria-label="Copy full content"
        title={copyLabel}
        data-testid="document-export-copy"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void run("copy", async () => {
            await copyTextToClipboard(await resolveBody());
          });
        }}
      >
        {done === "copy" ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        className={ACTION_BUTTON_CLASS}
        disabled={pending !== null}
        aria-label="Download source"
        title={downloadLabel}
        data-testid="document-export-download"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void run("download", async () => {
            const extension = documentExportExtension(format);
            downloadTextFile(
              documentExportFileName(title, extension),
              await resolveBody(),
              extension === "md" ? "text/markdown" : "text/plain",
            );
          });
        }}
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={ACTION_BUTTON_CLASS}
        disabled={pending !== null}
        aria-label="Export to PDF"
        title={pdfLabel}
        data-testid="document-export-pdf"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void run("pdf", async () => {
            downloadBlob(
              documentExportFileName(title, "pdf"),
              await issuesApi.getDocumentPdf(issueId, documentKey),
            );
          });
        }}
      >
        <FileDown aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {error ?? (done === "copy" ? "Copied!" : done ? "Downloaded!" : "")}
      </span>
    </div>
  );
}
