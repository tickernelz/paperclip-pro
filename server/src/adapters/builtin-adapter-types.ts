import { RETIRED_ADAPTER_TYPES } from "@tickernelz/wardmote-shared";

/**
 * Adapter types shipped with Paperclip. External plugins must not replace these.
 */
export const BUILTIN_ADAPTER_TYPES = new Set<string>([
  ...RETIRED_ADAPTER_TYPES,
  "wardmote_runner",
  "omp_local",
  "process",
  "http",
]);
