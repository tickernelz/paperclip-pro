import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MAX,
  ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MIN,
  ATTACHMENT_MAX_MEGABYTES_MAX,
  ATTACHMENT_MAX_MEGABYTES_MIN,
  ATTACHMENT_ORPHAN_AFTER_DAYS_MAX,
  ATTACHMENT_ORPHAN_AFTER_DAYS_MIN,
  DEFAULT_ATTACHMENT_MAX_MEGABYTES,
  type AttachmentLimitSource,
  type AttachmentRetentionReport,
  type AttachmentRetentionRule,
  type AttachmentRetentionSettings,
  type EffectiveAttachmentLimit,
} from "@tickernelz/paperclip-pro-shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
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
import { formatAttachmentSize } from "@/lib/attachment-limit";
import { queryKeys } from "@/lib/queryKeys";
import { formatDateTime } from "@/lib/utils";

const RULE_LABELS: Record<AttachmentRetentionRule, string> = {
  orphan_objects: "Orphaned files in storage",
  orphan_assets: "Unreferenced uploads",
  closed_tasks: "Attachments of closed tasks",
};

const LIMIT_SOURCE_LABELS: Record<AttachmentLimitSource, string> = {
  setting: "set here",
  env: "from PAPERCLIP_ATTACHMENT_MAX_BYTES",
  default: "built-in default",
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseWholeNumber(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** Instance-wide upload size limit and automatic attachment cleanup controls. */
export function FilesAndStorageSection({
  attachmentMaxMegabytes,
  attachmentRetention,
  effectiveLimit,
}: {
  attachmentMaxMegabytes: number | null;
  attachmentRetention: AttachmentRetentionSettings;
  effectiveLimit: EffectiveAttachmentLimit | undefined;
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold">Files and storage</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Control how large uploaded files may be and whether old attachments are cleaned up automatically.
        </p>
      </div>
      <UploadLimitForm
        key={String(attachmentMaxMegabytes)}
        value={attachmentMaxMegabytes}
        effectiveLimit={effectiveLimit}
      />
      <RetentionForm key={JSON.stringify(attachmentRetention)} value={attachmentRetention} />
    </section>
  );
}

function UploadLimitForm({
  value,
  effectiveLimit,
}: {
  value: number | null;
  effectiveLimit: EffectiveAttachmentLimit | undefined;
}) {
  const queryClient = useQueryClient();
  const initial = value === null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: number | null) => instanceSettingsApi.updateGeneral({ attachmentMaxMegabytes: next }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
      ]);
    },
  });

  const submit = () => {
    if (draft.trim() === "") {
      setValidationError(null);
      save.mutate(null);
      return;
    }
    const parsed = parseWholeNumber(draft, ATTACHMENT_MAX_MEGABYTES_MIN, ATTACHMENT_MAX_MEGABYTES_MAX);
    if (parsed === null) {
      setValidationError(
        `Enter a whole number from ${ATTACHMENT_MAX_MEGABYTES_MIN} to ${ATTACHMENT_MAX_MEGABYTES_MAX} MB, or leave it blank to use the default.`,
      );
      return;
    }
    setValidationError(null);
    save.mutate(parsed);
  };

  const dirty = draft.trim() !== initial;
  const shownError = validationError ?? (save.error ? errorText(save.error, "Failed to save the upload limit.") : null);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Upload size limit</h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Largest file anyone can attach, in MB ({ATTACHMENT_MAX_MEGABYTES_MIN}–{ATTACHMENT_MAX_MEGABYTES_MAX}). Leave blank to use the default: the PAPERCLIP_ATTACHMENT_MAX_BYTES environment variable when set, otherwise {DEFAULT_ATTACHMENT_MAX_MEGABYTES} MB.
        </p>
        {effectiveLimit ? (
          <p className="text-sm" data-testid="attachment-limit-effective">
            Current limit: <span className="font-medium tabular-nums">{formatAttachmentSize(effectiveLimit.maxBytes)}</span>{" "}
            <span className="text-muted-foreground">({LIMIT_SOURCE_LABELS[effectiveLimit.source]})</span>
          </p>
        ) : null}
      </div>
      <form
        noValidate
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="space-y-1.5 sm:w-48">
          <span className="text-xs font-medium text-muted-foreground">Limit (MB)</span>
          <Input
            type="number"
            inputMode="numeric"
            min={ATTACHMENT_MAX_MEGABYTES_MIN}
            max={ATTACHMENT_MAX_MEGABYTES_MAX}
            step={1}
            value={draft}
            placeholder={`Default (${DEFAULT_ATTACHMENT_MAX_MEGABYTES})`}
            aria-label="Upload size limit in MB"
            aria-invalid={validationError ? true : undefined}
            disabled={save.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setValidationError(null);
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving..." : "Save upload limit"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={save.isPending || !dirty}
            onClick={() => {
              setDraft(initial);
              setValidationError(null);
            }}
          >
            Reset
          </Button>
        </div>
      </form>
      {shownError ? (
        <p role="alert" className="text-sm text-destructive">{shownError}</p>
      ) : null}
    </div>
  );
}

type RetentionDraft = {
  enabled: boolean;
  orphanAfterDays: string;
  closedTasksEnabled: boolean;
  closedTasksAfterDays: string;
};

function toDraft(value: AttachmentRetentionSettings): RetentionDraft {
  return {
    enabled: value.enabled,
    orphanAfterDays: String(value.orphanAfterDays),
    closedTasksEnabled: value.closedTasks.enabled,
    closedTasksAfterDays: String(value.closedTasks.afterDays),
  };
}

function parseDraft(draft: RetentionDraft): { settings: AttachmentRetentionSettings | null; errors: string[] } {
  const orphanAfterDays = parseWholeNumber(draft.orphanAfterDays, ATTACHMENT_ORPHAN_AFTER_DAYS_MIN, ATTACHMENT_ORPHAN_AFTER_DAYS_MAX);
  const afterDays = parseWholeNumber(
    draft.closedTasksAfterDays,
    ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MIN,
    ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MAX,
  );
  const errors: string[] = [];
  if (orphanAfterDays === null) {
    errors.push(`Unused files must be kept for ${ATTACHMENT_ORPHAN_AFTER_DAYS_MIN}–${ATTACHMENT_ORPHAN_AFTER_DAYS_MAX} whole days.`);
  }
  if (afterDays === null) {
    errors.push(
      `Closed task attachments must be kept for ${ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MIN}–${ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MAX} whole days.`,
    );
  }
  if (orphanAfterDays === null || afterDays === null) return { settings: null, errors };
  return {
    settings: {
      enabled: draft.enabled,
      orphanAfterDays,
      closedTasks: { enabled: draft.closedTasksEnabled, afterDays },
    },
    errors,
  };
}

function RetentionForm({ value }: { value: AttachmentRetentionSettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RetentionDraft>(() => toDraft(value));
  const [showErrors, setShowErrors] = useState(false);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const { settings: parsed, errors } = parseDraft(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(value));

  const status = useQuery({
    queryKey: queryKeys.instance.attachmentRetention,
    queryFn: () => instanceSettingsApi.getAttachmentRetention(),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (next: AttachmentRetentionSettings) => instanceSettingsApi.updateGeneral({ attachmentRetention: next }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.attachmentRetention }),
      ]);
    },
  });
  const preview = useMutation({
    mutationFn: (next: AttachmentRetentionSettings) => instanceSettingsApi.previewAttachmentRetention(next),
  });
  const run = useMutation({
    mutationFn: () => instanceSettingsApi.runAttachmentRetention(),
    onSuccess: async () => {
      preview.reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.attachmentRetention });
    },
  });

  const update = (patch: Partial<RetentionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    preview.reset();
  };
  const busy = save.isPending || run.isPending;
  const visibleErrors = showErrors ? errors : [];
  const actionError = save.error
    ? errorText(save.error, "Failed to save cleanup settings.")
    : preview.error
      ? errorText(preview.error, "Failed to preview cleanup.")
      : run.error
        ? errorText(run.error, "Cleanup did not run.")
        : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium">Automatic attachment cleanup</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Off by default. When on, Paperclip periodically deletes stored files nothing refers to any more and, if you choose, attachments of tasks closed long ago. Each removed attachment leaves a tombstone, so tasks show &ldquo;File removed by retention&rdquo; with the date instead of a broken file.
          </p>
        </div>
        <ToggleSwitch
          checked={draft.enabled}
          onCheckedChange={() => update({ enabled: !draft.enabled })}
          disabled={busy}
          aria-label="Toggle automatic attachment cleanup"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Remove unused files after (days, {ATTACHMENT_ORPHAN_AFTER_DAYS_MIN}–{ATTACHMENT_ORPHAN_AFTER_DAYS_MAX})
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={ATTACHMENT_ORPHAN_AFTER_DAYS_MIN}
            max={ATTACHMENT_ORPHAN_AFTER_DAYS_MAX}
            step={1}
            value={draft.orphanAfterDays}
            aria-label="Remove unused files after days"
            disabled={busy}
            onChange={(event) => update({ orphanAfterDays: event.target.value })}
          />
        </label>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-xs font-medium text-muted-foreground">
              Remove attachments of closed tasks after (days, {ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MIN}–{ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MAX})
            </span>
            <ToggleSwitch
              checked={draft.closedTasksEnabled}
              onCheckedChange={() => update({ closedTasksEnabled: !draft.closedTasksEnabled })}
              disabled={busy}
              aria-label="Toggle closed task attachment cleanup"
            />
          </div>
          <Input
            type="number"
            inputMode="numeric"
            min={ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MIN}
            max={ATTACHMENT_CLOSED_TASK_AFTER_DAYS_MAX}
            step={1}
            value={draft.closedTasksAfterDays}
            aria-label="Remove attachments of closed tasks after days"
            disabled={busy || !draft.closedTasksEnabled}
            onChange={(event) => update({ closedTasksAfterDays: event.target.value })}
          />
        </div>
      </div>

      {visibleErrors.length > 0 ? (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          {visibleErrors.map((message) => <p key={message}>{message}</p>)}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !dirty}
          onClick={() => {
            setShowErrors(true);
            if (parsed) save.mutate(parsed);
          }}
        >
          {save.isPending ? "Saving..." : "Save cleanup settings"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || preview.isPending}
          onClick={() => {
            setShowErrors(true);
            if (parsed) preview.mutate(parsed);
          }}
        >
          {preview.isPending ? "Previewing..." : "Preview"}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmRunOpen(true)}>
          {run.isPending ? "Running..." : "Run now"}
        </Button>
      </div>

      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      {preview.data ? (
        <RetentionReportSummary title="Preview — nothing deleted yet" report={preview.data} />
      ) : null}

      <div className="space-y-1.5" data-testid="attachment-retention-last-run">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last run</h4>
        {status.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading cleanup history...</p>
        ) : status.error ? (
          <p className="text-sm text-muted-foreground">{errorText(status.error, "Cleanup history is unavailable.")}</p>
        ) : status.data?.lastRun ? (
          <LastRunSummary report={status.data.lastRun} />
        ) : (
          <p className="text-sm text-muted-foreground">Cleanup has not run yet.</p>
        )}
      </div>

      <AlertDialog open={confirmRunOpen} onOpenChange={setConfirmRunOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run attachment cleanup now?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the files matched by the saved cleanup settings, even while automatic cleanup is off. Removed attachments leave a tombstone in their tasks.{dirty ? " Unsaved changes on this page are not used." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run.mutate()}>Delete files now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LastRunSummary({ report }: { report: AttachmentRetentionReport }) {
  return (
    <div className="space-y-0.5 text-sm">
      <p>
        <span className="tabular-nums">{formatDateTime(report.finishedAt)}</span>
        <span className="text-muted-foreground"> · {report.trigger === "manual" ? "Manual" : "Scheduled"}</span>
      </p>
      <p className="text-muted-foreground">
        <span className="tabular-nums">{report.totalCount}</span> {report.totalCount === 1 ? "file" : "files"} removed ·{" "}
        <span className="tabular-nums">{formatAttachmentSize(report.totalBytes)}</span> freed
        {report.failedCount > 0 ? (
          <span className="text-destructive"> · <span className="tabular-nums">{report.failedCount}</span> failed</span>
        ) : null}
      </p>
    </div>
  );
}

function RetentionReportSummary({ title, report }: { title: string; report: AttachmentRetentionReport }) {
  return (
    <div className="space-y-2" data-testid="attachment-retention-preview">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-1.5">
        {report.rules.map((rule) => (
          <li key={rule.rule} data-rule={rule.rule} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">{RULE_LABELS[rule.rule]}</span>
            <span className="shrink-0 text-right tabular-nums text-muted-foreground">
              {rule.count} {rule.count === 1 ? "file" : "files"} · {formatAttachmentSize(rule.bytes)}
            </span>
          </li>
        ))}
        <li className="flex items-start justify-between gap-3 text-sm font-medium">
          <span className="min-w-0">Total</span>
          <span className="shrink-0 text-right tabular-nums">
            {report.totalCount} {report.totalCount === 1 ? "file" : "files"} · {formatAttachmentSize(report.totalBytes)}
          </span>
        </li>
      </ul>
    </div>
  );
}
