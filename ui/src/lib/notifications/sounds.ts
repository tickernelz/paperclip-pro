import type { NotificationKind } from "@tickernelz/paperclip-pro-shared";

export interface NotificationSound {
  id: string;
  label: string;
}

export const NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  { id: "confirmation", label: "Confirmation" },
  { id: "question", label: "Question" },
  { id: "glass", label: "Glass" },
  { id: "bong", label: "Bong" },
  { id: "maximize", label: "Rise" },
  { id: "pluck", label: "Pluck" },
  { id: "error", label: "Alert" },
  { id: "drop", label: "Drop" },
  { id: "select", label: "Select" },
  { id: "open", label: "Open" },
];

export const CUSTOM_SOUND_ID = "custom";
export const SILENT_SOUND_ID = "none";

export const DEFAULT_KIND_SOUNDS: Record<NotificationKind, string> = {
  approval: "confirmation",
  question: "question",
  comment: "pluck",
  assignment: "maximize",
  review: "glass",
  run_failed: "error",
  join_request: "bong",
};

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  approval: "Approvals",
  question: "Agent questions",
  comment: "Comments",
  assignment: "Assignments",
  review: "Ready for review",
  run_failed: "Failed runs",
  join_request: "Join requests",
};

const LIBRARY_IDS = new Set(NOTIFICATION_SOUNDS.map((sound) => sound.id));

export function isKnownSoundId(id: unknown): id is string {
  return typeof id === "string" && (LIBRARY_IDS.has(id) || id === CUSTOM_SOUND_ID || id === SILENT_SOUND_ID);
}

export function isLibrarySoundId(id: string): boolean {
  return LIBRARY_IDS.has(id);
}

export function librarySoundUrl(id: string, format: "ogg" | "mp3"): string {
  return `/sounds/${id}.${format}`;
}
