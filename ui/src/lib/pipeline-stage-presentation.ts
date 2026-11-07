const defaultPipelineStageColumnTone = {
  outer: "border-line bg-bg",
  header: "border-line text-ink-3",
  meta: "border-line",
  body: "",
  bodyOver: "bg-bg-3/40",
};

export const pipelineStageColumnTones: Record<string, typeof defaultPipelineStageColumnTone> = {
  review: {
    outer: "border-violet-500/25 bg-violet-50/50 dark:bg-violet-950/15",
    header: "border-violet-500/15 text-violet-700 dark:text-violet-300",
    meta: "border-violet-500/15",
    body: "bg-violet-50/30 dark:bg-violet-950/10",
    bodyOver: "bg-violet-100/65 dark:bg-violet-950/30",
  },
  in_review: {
    outer: "border-violet-500/25 bg-violet-50/50 dark:bg-violet-950/15",
    header: "border-violet-500/15 text-violet-700 dark:text-violet-300",
    meta: "border-violet-500/15",
    body: "bg-violet-50/30 dark:bg-violet-950/10",
    bodyOver: "bg-violet-100/65 dark:bg-violet-950/30",
  },
  done: {
    outer: "border-green-500/25 bg-green-50/50 dark:bg-green-950/15",
    header: "border-green-500/15 text-green-700 dark:text-green-300",
    meta: "border-green-500/15",
    body: "bg-green-50/30 dark:bg-green-950/10",
    bodyOver: "bg-green-100/65 dark:bg-green-950/30",
  },
  cancelled: {
    outer: "border-neutral-300/70 bg-bg-3/25 opacity-85 dark:border-neutral-700/70 dark:bg-neutral-900/20",
    header: "border-line/70 text-ink-3/80",
    meta: "border-line/70",
    body: "bg-bg-3/20",
    bodyOver: "bg-bg-3/45",
  },
};

export function getPipelineStageColumnTone(kind: string | null | undefined) {
  return pipelineStageColumnTones[kind?.trim().toLowerCase() ?? ""] ?? defaultPipelineStageColumnTone;
}

export function pipelineStageAutomationSettingsHref(pipelineId: string, stageId: string) {
  return `/pipelines/${pipelineId}/settings?stage=${stageId}&section=instructions`;
}
