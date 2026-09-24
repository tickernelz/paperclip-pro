export const REDACTED_LOG_MARKER = "***REDACTED***";

const REPAIR_MAX_STEPS = 16;

function jsonErrorPosition(line: string): number {
  try {
    JSON.parse(line);
    return -1;
  } catch (error) {
    const match = /position (\d+)/.exec(error instanceof Error ? error.message : String(error));
    return match ? Number(match[1]) : line.length;
  }
}

function markerPositions(line: string): number[] {
  const positions: number[] = [];
  let index = line.indexOf(REDACTED_LOG_MARKER);
  while (index >= 0) {
    positions.push(index);
    index = line.indexOf(REDACTED_LOG_MARKER, index + REDACTED_LOG_MARKER.length);
  }
  return positions;
}

function repairCandidates(line: string, at: number): string[] {
  const end = at + REDACTED_LOG_MARKER.length;
  const head = line.slice(0, end);
  const rest = line.slice(end);
  const candidates: string[] = [];
  if (rest.startsWith("\\\"")) candidates.push(`${head}"${rest.slice(2)}`);
  if (rest.startsWith("\"")) candidates.push(`${head}\\"${rest.slice(1)}`);
  if (rest.startsWith("}") || rest.startsWith("]") || rest.startsWith(",")) {
    candidates.push(`${head}"${rest}`);
  }
  return candidates;
}

/** Rebuild a JSON line whose escapes Paperclip's log redaction swallowed, or null when unrecoverable. */
export function repairRedactedJsonLine(line: string): string | null {
  if (!line.includes(REDACTED_LOG_MARKER)) return null;
  let current = line;
  let position = jsonErrorPosition(current);
  if (position < 0) return current;

  for (let step = 0; step < REPAIR_MAX_STEPS; step += 1) {
    const markers = markerPositions(current);
    const preceding = markers.filter((marker) => marker <= position);
    const at = preceding.length > 0 ? preceding[preceding.length - 1] : markers[0];
    if (at === undefined) return null;

    let best: string | null = null;
    let bestPosition = position;
    for (const candidate of repairCandidates(current, at)) {
      const candidatePosition = jsonErrorPosition(candidate);
      if (candidatePosition < 0) return candidate;
      if (candidatePosition > bestPosition) {
        best = candidate;
        bestPosition = candidatePosition;
      }
    }
    if (best === null) return null;
    current = best;
    position = bestPosition;
  }
  return jsonErrorPosition(current) < 0 ? current : null;
}

const SALVAGE_EVENT_PREFIX = '{"type":"';
const SALVAGE_MAX_EVENTS = 8;

function balancedObjectEnd(line: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

export function salvageRedactedEvents(line: string): Record<string, unknown>[] {
  if (!line.includes(REDACTED_LOG_MARKER)) return [];
  const events: Record<string, unknown>[] = [];
  let cursor = line.indexOf(REDACTED_LOG_MARKER);
  while (cursor >= 0 && events.length < SALVAGE_MAX_EVENTS) {
    const start = line.indexOf(SALVAGE_EVENT_PREFIX, cursor + REDACTED_LOG_MARKER.length);
    if (start < 0) break;
    const end = balancedObjectEnd(line, start);
    if (end > start) {
      try {
        const parsed: unknown = JSON.parse(line.slice(start, end));
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          events.push(parsed as Record<string, unknown>);
        }
      } catch {
        break;
      }
    }
    cursor = line.indexOf(REDACTED_LOG_MARKER, start);
  }
  return events;
}
