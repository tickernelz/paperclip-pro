/** Normalizes a CSV string, repeated query values, or both into trimmed entries. */
export function parseStatusFilter(
  input: string | readonly string[] | undefined,
): string[] {
  if (input === undefined || input === null) return [];
  const entries = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : [];
  return entries
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((status) => status.trim())
    .filter(Boolean);
}
