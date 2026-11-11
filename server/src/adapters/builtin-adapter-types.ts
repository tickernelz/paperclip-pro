import { RETIRED_ADAPTER_TYPES } from "@tickernelz/wardmote-shared";

export const BUILTIN_ADAPTER_TYPES = new Set<string>([
  ...RETIRED_ADAPTER_TYPES,
  "wardmote_runner",
  "omp_local",
  "process",
  "http",
]);
