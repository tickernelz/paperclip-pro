import { sql, type SQL } from "drizzle-orm";
import { heartbeatRuns } from "@tickernelz/paperclip-pro-db";

const ACKNOWLEDGEMENTS_KEY = "queuedSteeringAcknowledgements";

/** Write `resultJson` while keeping every steering acknowledgement the row already holds. */
export function resultJsonRetainingSteeringAcknowledgements(
  resultJson: Record<string, unknown> | null,
): SQL {
  const next = sql`${resultJson == null ? null : JSON.stringify(resultJson)}::jsonb`;
  const key = sql`${ACKNOWLEDGEMENTS_KEY}::text`;
  const stored = sql`(${heartbeatRuns.resultJson} -> ${key})`;
  return sql`case when jsonb_typeof(${stored}) = 'object'
    then coalesce(${next}, '{}'::jsonb) || jsonb_build_object(
      ${key},
      case when jsonb_typeof(${next} -> ${key}) = 'object'
        then (${next} -> ${key}) || ${stored}
        else ${stored} end)
    else ${next} end`;
}

export function withRetainedSteeringAcknowledgements<
  T extends { resultJson?: Record<string, unknown> | null },
>(patch: T | undefined): Omit<T, "resultJson"> & { resultJson?: SQL } {
  if (!patch) return {} as Omit<T, "resultJson">;
  const { resultJson, ...rest } = patch;
  if (resultJson === undefined) return rest;
  return { ...rest, resultJson: resultJsonRetainingSteeringAcknowledgements(resultJson) };
}
