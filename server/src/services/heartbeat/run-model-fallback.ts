import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  agents,
  heartbeatRuns,
  heartbeatRunEvents,
} from "@tickernelz/paperclip-pro-db";
import { and, eq } from "drizzle-orm";
import { parseObject } from "../../adapters/utils.js";
import { logActivity } from "../activity-log.js";
import {
  MODEL_FALLBACK_ACTIVITY_ACTION,
  MODEL_FALLBACK_DEFAULT_COOLDOWN_MS,
  MODEL_FALLBACK_EVENT,
  MODEL_FALLBACK_EXHAUSTED_EVENT,
  MODEL_FALLBACK_PRIMARY_KEY,
  MODEL_FALLBACK_RESTORED_EVENT,
  MODEL_FALLBACK_STATE_KEY,
  modelFallbackEventMessage,
  modelFallbackReasonForErrorFamily,
  persistRunModelFallbackState,
  prepareRunModelFallback,
  readRunActiveModel,
  recordModelCooldown,
  type ModelFallbackRetryPlan,
} from "../model-fallback.js";
import type { RunModelFallbackReason } from "@tickernelz/paperclip-pro-shared";

type Run = typeof heartbeatRuns.$inferSelect;
type RunEvent = {
  eventType: string;
  stream?: "system" | "stdout" | "stderr";
  level?: "info" | "warn" | "error";
  color?: string;
  message?: string;
  payload?: Record<string, unknown>;
};

export interface RunModelFallbackDependencies {
  db: Db;
  appendRunEvent: (run: Run, event: RunEvent) => Promise<unknown>;
}

export interface AdapterModelFallbackEvent {
  eventType: string;
  payload: unknown;
}

export interface RunModelFallback {
  applyRunModelFallback: (
    run: Run,
    agent: typeof agents.$inferSelect,
    config: Record<string, unknown>,
    context: Record<string, unknown>,
    options: { routerManaged: boolean; issueId: string | null },
  ) => Promise<void>;
  handleAdapterModelFallbackEvent: (run: Run, event: AdapterModelFallbackEvent) => Promise<void>;
  noteModelFallbackRunFailure: (run: Run) => Promise<void>;
  appendModelFallbackExhausted: (run: Run, plan: ModelFallbackRetryPlan) => Promise<void>;
}

function readContextText(context: Record<string, unknown>, key: string): string | null {
  const value = context[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readHeartbeatRunErrorFamily(
  run: Pick<Run, "errorCode" | "resultJson">,
): string | null {
  const resultJson = parseObject(run.resultJson);
  const persistedFamily = readNonEmptyString(resultJson.errorFamily);
  if (persistedFamily) return persistedFamily;
  if (run.errorCode === "provider_quota") return "provider_quota";
  if (
    run.errorCode === "codex_transient_upstream" ||
    run.errorCode === "claude_transient_upstream" ||
    run.errorCode === "codex_harness_crash"
  ) {
    return "transient_upstream";
  }
  return null;
}

function readTransientRetryNotBeforeFromRun(
  run: Pick<Run, "resultJson">,
): Date | null {
  const resultJson = parseObject(run.resultJson);
  const value = resultJson.retryNotBefore ?? resultJson.transientRetryNotBefore;
  if (!(
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof Date
  )) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createRunModelFallback(dependencies: RunModelFallbackDependencies): RunModelFallback {
  const { db, appendRunEvent } = dependencies;

  async function logRunModelFallbackActivity(
    run: Pick<Run, "id" | "companyId" | "agentId">,
    issueId: string | null,
    details: { from: string; to: string; reason: RunModelFallbackReason; phase: "run_start" | "in_run" },
  ) {
    if (!issueId) return;
    await logActivity(db, {
      companyId: run.companyId,
      actorType: "system",
      actorId: "heartbeat",
      agentId: run.agentId,
      runId: run.id,
      action: MODEL_FALLBACK_ACTIVITY_ACTION,
      entityType: "issue",
      entityId: issueId,
      details: { runId: run.id, agentId: run.agentId, ...details },
    });
  }

  async function applyRunModelFallback(
    run: Run,
    agent: typeof agents.$inferSelect,
    config: Record<string, unknown>,
    context: Record<string, unknown>,
    options: { routerManaged: boolean; issueId: string | null },
  ) {
    const hadFallbackContext =
      context[MODEL_FALLBACK_PRIMARY_KEY] !== undefined ||
      context[MODEL_FALLBACK_STATE_KEY] !== undefined;
    const prepared = await prepareRunModelFallback({
      db,
      companyId: run.companyId,
      adapterType: agent.adapterType,
      routerManaged: options.routerManaged,
      config,
      context,
      now: new Date(),
    });
    if (!prepared) {
      delete context[MODEL_FALLBACK_PRIMARY_KEY];
      delete context[MODEL_FALLBACK_STATE_KEY];
      if (hadFallbackContext) {
        await persistRunModelFallbackState(db, run.id, { primary: null, state: null });
      }
      return;
    }
    const { selection, state } = prepared;
    context[MODEL_FALLBACK_PRIMARY_KEY] = selection.primary;
    context[MODEL_FALLBACK_STATE_KEY] = state;
    await persistRunModelFallbackState(db, run.id, { primary: selection.primary, state });
    if (!state) return;
    await appendRunEvent(run, {
      eventType: MODEL_FALLBACK_EVENT,
      stream: "system",
      level: "warn",
      message: modelFallbackEventMessage({ to: state.activeModel, primary: state.primaryModel, reason: state.reason }),
      payload: {
        phase: "run_start",
        from: selection.primary,
        to: selection.start,
        primary: selection.primary,
        reason: state.reason,
        retryAfterMs: null,
      },
    });
    await logRunModelFallbackActivity(run, options.issueId, {
      from: selection.primary,
      to: selection.start,
      reason: state.reason,
      phase: "run_start",
    });
  }

  async function handleAdapterModelFallbackEvent(
    run: Run,
    event: AdapterModelFallbackEvent,
  ) {
    const payload = parseObject(event.payload);
    const context = parseObject(run.contextSnapshot);
    const primary = readContextText(context, MODEL_FALLBACK_PRIMARY_KEY)
      ?? (typeof payload.primary === "string" && payload.primary.trim() ? payload.primary : null);
    const issueId = readContextText(context, "issueId");
    if (event.eventType === MODEL_FALLBACK_RESTORED_EVENT) {
      await persistRunModelFallbackState(db, run.id, { state: null });
      return;
    }
    const from = typeof payload.from === "string" ? payload.from : null;
    const to = typeof payload.to === "string" ? payload.to : null;
    const reason: RunModelFallbackReason =
      payload.reason === "rate_limit" || payload.reason === "upstream" || payload.reason === "refusal"
        ? payload.reason
        : "upstream";
    if (!from || !to || !primary) return;
    const now = new Date();
    const retryAfterMs = typeof payload.retryAfterMs === "number" && payload.retryAfterMs > 0
      ? payload.retryAfterMs
      : MODEL_FALLBACK_DEFAULT_COOLDOWN_MS;
    await recordModelCooldown(db, {
      companyId: run.companyId,
      selector: from,
      until: new Date(now.getTime() + retryAfterMs),
      reason,
      sourceRunId: run.id,
    });
    await persistRunModelFallbackState(db, run.id, {
      state: to === primary
        ? null
        : { primaryModel: primary, activeModel: to, reason, switchedAt: now.toISOString() },
    });
    await logRunModelFallbackActivity(run, issueId, { from, to, reason, phase: "in_run" });
  }

  async function noteModelFallbackRunFailure(run: Run) {
    const context = parseObject(run.contextSnapshot);
    const primary = readContextText(context, MODEL_FALLBACK_PRIMARY_KEY);
    if (!primary) return;
    const reason = modelFallbackReasonForErrorFamily(readHeartbeatRunErrorFamily(run));
    const active = readRunActiveModel(run);
    if (!reason || reason === "refusal" || !active) return;
    const now = new Date();
    const retryNotBefore = readTransientRetryNotBeforeFromRun(run);
    await recordModelCooldown(db, {
      companyId: run.companyId,
      selector: active,
      until: retryNotBefore && retryNotBefore.getTime() > now.getTime()
        ? retryNotBefore
        : new Date(now.getTime() + MODEL_FALLBACK_DEFAULT_COOLDOWN_MS),
      reason,
      sourceRunId: run.id,
    });
  }

  async function appendModelFallbackExhausted(
    run: Run,
    plan: ModelFallbackRetryPlan,
  ) {
    const [existing] = await db
      .select({ id: heartbeatRunEvents.id })
      .from(heartbeatRunEvents)
      .where(and(
        eq(heartbeatRunEvents.companyId, run.companyId),
        eq(heartbeatRunEvents.runId, run.id),
        eq(heartbeatRunEvents.eventType, MODEL_FALLBACK_EXHAUSTED_EVENT),
      ))
      .limit(1);
    if (existing) return;
    const context = parseObject(run.contextSnapshot);
    const primary = readContextText(context, MODEL_FALLBACK_PRIMARY_KEY) ?? plan.chain[0] ?? null;
    const reason = modelFallbackReasonForErrorFamily(readHeartbeatRunErrorFamily(run));
    await appendRunEvent(run, {
      eventType: MODEL_FALLBACK_EXHAUSTED_EVENT,
      stream: "system",
      level: "error",
      message: `Model fallback exhausted: ${plan.chain.join(" -> ")}; no further model will be tried`,
      payload: { primary, tried: plan.chain, reason },
    });
  }

  return {
    applyRunModelFallback,
    handleAdapterModelFallbackEvent,
    noteModelFallbackRunFailure,
    appendModelFallbackExhausted,
  };
}
