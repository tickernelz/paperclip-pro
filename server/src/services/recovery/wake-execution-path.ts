import { sql } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns } from "@tickernelz/paperclip-pro-db";

export type BackstopTerminalRunStatus = "interrupted" | "succeeded" | "cancelled";

export function wakeStatusForTerminalRun(status: BackstopTerminalRunStatus) {
  if (status === "succeeded") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export function wakeRequestHoldsExecutionPath() {
  return sql`not (${agentWakeupRequests.status} = 'claimed' and exists (
    select 1 from ${heartbeatRuns}
    where ${heartbeatRuns.companyId} = ${agentWakeupRequests.companyId}
      and (${heartbeatRuns.id} = ${agentWakeupRequests.runId} or ${heartbeatRuns.wakeupRequestId} = ${agentWakeupRequests.id})
      and ${heartbeatRuns.status} not in ('queued', 'running', 'scheduled_retry')
  ))`;
}
