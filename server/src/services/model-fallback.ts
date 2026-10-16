import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { heartbeatRuns, modelCooldowns, type Db } from "@tickernelz/paperclip-pro-db";
import { unprocessable } from "../errors.js";
import {
  AGENT_FALLBACK_EFFORTS_KEY,
  AGENT_FALLBACK_MODELS_KEY,
  adapterSupportsFallbackModels,
  fitAgentFallbackEfforts,
  readAgentFallbackEfforts,
  readAgentFallbackModels,
  validateAgentFallbackModels,
  type RunModelFallbackReason,
  type RunModelFallbackState,
} from "@tickernelz/paperclip-pro-shared";

export const MODEL_FALLBACK_DEFAULT_COOLDOWN_MS = 5 * 60_000;
export const MODEL_FALLBACK_STATE_KEY = "paperclipModelFallback";
export const MODEL_FALLBACK_PRIMARY_KEY = "paperclipPrimaryModel";
/** Per-model attempt counts carried by a retry lineage, so a fresh wake always starts over. */
export const MODEL_FALLBACK_ATTEMPTS_KEY = "paperclipModelAttempts";
/** The model a retry must start on, decided by the lineage that produced it. */
export const MODEL_FALLBACK_FORCED_MODEL_KEY = "paperclipForcedModel";
/** Why the lineage left the primary, carried so a fallback run reports it. */
export const MODEL_FALLBACK_REASON_KEY = "paperclipFallbackReason";
/** The primary model is tried twice before the chain moves on. */
export const MODEL_FALLBACK_PRIMARY_ATTEMPTS = 2;
/** The primary retry follows its failure closely so a blip does not look like an outage. */
export const MODEL_FALLBACK_PRIMARY_RETRY_DELAY_MS = 5_000;
/** Every later step of the chain waits one bounded interval. */
export const MODEL_FALLBACK_STEP_DELAY_MS = 30_000;
/** Attempts the lineage may consume, carried so recovery stops escalating once it is spent. */
export const MODEL_FALLBACK_BUDGET_KEY = "paperclipModelAttemptBudget";
export const MODEL_FALLBACK_EVENT = "model.fallback";
export const MODEL_FALLBACK_RESTORED_EVENT = "model.fallback_restored";
export const MODEL_FALLBACK_EXHAUSTED_EVENT = "model.fallback_exhausted";
export const MODEL_FALLBACK_ACTIVITY_ACTION = "issue.run_model_fallback";

export interface ModelCooldown {
  selector: string;
  until: Date;
  reason: RunModelFallbackReason;
}

export interface RunModelSelection {
  primary: string;
  chain: string[];
  start: string;
  overlayChain: string[];
  reason: RunModelFallbackReason | null;
}

export interface ModelFallbackStepPlan {
  chain: string[];
  attempts: Record<string, number>;
  /** The model the next attempt must start on, or null when the chain is spent. */
  start: string | null;
  /** True when the primary gets its immediate second try instead of the chain advancing. */
  fastRetry: boolean;
  /** Attempts the whole lineage may consume, primary retry included. */
  maxAttempts: number;
  /** When a cooled model becomes eligible again, for reporting only. */
  availableAt: Date | null;
}

export type ModelFallbackRetryPlan = ModelFallbackStepPlan;

const REASON_LABELS: Record<RunModelFallbackReason, string> = {
  rate_limit: "rate limit",
  upstream: "upstream error",
  refusal: "refusal",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/** Human label for a fallback reason. */
export function modelFallbackReasonLabel(reason: RunModelFallbackReason): string {
  return REASON_LABELS[reason];
}

/** The fallback reason for a run failure family, or null when the family must not fall back. */
export function modelFallbackReasonForErrorFamily(family: unknown): RunModelFallbackReason | null {
  if (family === "provider_quota") return "rate_limit";
  if (family === "transient_upstream") return "upstream";
  if (family === "model_refusal") return "refusal";
  return null;
}

function isReason(value: unknown): value is RunModelFallbackReason {
  return value === "rate_limit" || value === "upstream" || value === "refusal";
}

/** Validates an agent's fallback list before it is stored; an empty list is removed. */
export function normalizeAgentFallbackModelsConfig(
  adapterType: string | null | undefined,
  adapterConfig: Record<string, unknown>,
  baseAdapterConfig?: Record<string, unknown>,
): Record<string, unknown> {
  if (!adapterSupportsFallbackModels(adapterType ?? "")) return adapterConfig;
  const touchesList = Object.hasOwn(adapterConfig, AGENT_FALLBACK_MODELS_KEY);
  if (!touchesList && !Object.hasOwn(adapterConfig, AGENT_FALLBACK_EFFORTS_KEY)) return adapterConfig;
  const next = { ...adapterConfig };
  let fallbacks = readAgentFallbackModels(baseAdapterConfig?.[AGENT_FALLBACK_MODELS_KEY]);
  if (touchesList) {
    const primary = text(adapterConfig.model) || text(baseAdapterConfig?.model);
    const validation = validateAgentFallbackModels(adapterConfig[AGENT_FALLBACK_MODELS_KEY], primary);
    if (!validation.ok) throw unprocessable(validation.message, { key: AGENT_FALLBACK_MODELS_KEY });
    fallbacks = validation.value;
    if (fallbacks.length === 0) delete next[AGENT_FALLBACK_MODELS_KEY];
    else next[AGENT_FALLBACK_MODELS_KEY] = fallbacks;
  }
  const efforts = fitAgentFallbackEfforts(adapterConfig[AGENT_FALLBACK_EFFORTS_KEY], fallbacks);
  if (Object.keys(efforts).length === 0) delete next[AGENT_FALLBACK_EFFORTS_KEY];
  else next[AGENT_FALLBACK_EFFORTS_KEY] = efforts;
  return next;
}

/** Primary first, then the agent's fallback list, without duplicates. */
export function buildModelChain(primary: string, fallbackModels: unknown): string[] {
  const chain = [primary.trim()];
  for (const selector of readAgentFallbackModels(fallbackModels)) {
    if (!chain.includes(selector)) chain.push(selector);
  }
  return chain;
}

function isCooling(cooldowns: Map<string, ModelCooldown>, selector: string, now: Date): boolean {
  const cooldown = cooldowns.get(selector);
  return Boolean(cooldown && cooldown.until.getTime() > now.getTime());
}

/** Attempts one selector may consume inside a lineage: the primary twice, every fallback once. */
export function modelFallbackAttemptLimit(selector: string, primary: string): number {
  return selector === primary ? MODEL_FALLBACK_PRIMARY_ATTEMPTS : 1;
}

/** Attempts a whole lineage may consume: every chain entry tried to its own limit. */
export function modelFallbackAttemptBudget(chain: readonly string[], primary: string): number {
  return chain.reduce((total, selector) => total + modelFallbackAttemptLimit(selector, primary), 0);
}

/** Decides the model for the next attempt; null start means the chain is spent. */
export function planModelFallbackStep(input: {
  chain: readonly string[];
  primary: string;
  active: string;
  reason: RunModelFallbackReason;
  attempts: Readonly<Record<string, number>>;
  now: Date;
}): ModelFallbackStepPlan {
  const chain = [...input.chain];
  const attempts: Record<string, number> = { ...input.attempts };
  attempts[input.active] = (attempts[input.active] ?? 0) + 1;
  const exhausted = (selector: string) =>
    (attempts[selector] ?? 0) >= modelFallbackAttemptLimit(selector, input.primary);
  const retriesPrimary =
    input.reason !== "refusal" &&
    input.active === input.primary &&
    !exhausted(input.primary);
  const start = retriesPrimary
    ? input.primary
    : chain.find((selector) => selector !== input.active && !exhausted(selector)) ?? null;
  return {
    chain,
    attempts,
    start,
    fastRetry: retriesPrimary,
    maxAttempts: modelFallbackAttemptBudget(chain, input.primary),
    availableAt: null,
  };
}


/** Active cooldowns for the given selectors in one company. */
export async function loadModelCooldowns(
  db: Db,
  companyId: string,
  selectors: readonly string[],
  now: Date,
): Promise<Map<string, ModelCooldown>> {
  const cooldowns = new Map<string, ModelCooldown>();
  if (selectors.length === 0) return cooldowns;
  const rows = await db
    .select({ selector: modelCooldowns.selector, until: modelCooldowns.cooldownUntil, reason: modelCooldowns.reason })
    .from(modelCooldowns)
    .where(and(
      eq(modelCooldowns.companyId, companyId),
      inArray(modelCooldowns.selector, [...selectors]),
      gt(modelCooldowns.cooldownUntil, now),
    ));
  for (const row of rows) {
    cooldowns.set(row.selector, {
      selector: row.selector,
      until: row.until,
      reason: isReason(row.reason) ? row.reason : "rate_limit",
    });
  }
  return cooldowns;
}

/** Records that a selector is cooling down for the whole company, keeping the later expiry. */
export async function recordModelCooldown(
  db: Db,
  input: { companyId: string; selector: string; until: Date; reason: RunModelFallbackReason; sourceRunId: string | null },
): Promise<void> {
  const selector = input.selector.trim();
  if (!selector || input.reason === "refusal") return;
  await db
    .insert(modelCooldowns)
    .values({
      companyId: input.companyId,
      selector,
      cooldownUntil: input.until,
      reason: input.reason,
      sourceRunId: input.sourceRunId,
    })
    .onConflictDoUpdate({
      target: [modelCooldowns.companyId, modelCooldowns.selector],
      set: {
        reason: sql`case when excluded.cooldown_until > ${modelCooldowns.cooldownUntil} then excluded.reason else ${modelCooldowns.reason} end`,
        sourceRunId: sql`case when excluded.cooldown_until > ${modelCooldowns.cooldownUntil} then excluded.source_run_id else ${modelCooldowns.sourceRunId} end`,
        cooldownUntil: sql`greatest(${modelCooldowns.cooldownUntil}, excluded.cooldown_until)`,
        updatedAt: new Date(),
      },
    });
}

/** Rewrites the run's execution config to start on the selected model with the rest as OMP's chain. */
export async function prepareRunModelFallback(input: {
  db: Db;
  companyId: string;
  adapterType: string;
  routerManaged: boolean;
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  now: Date;
}): Promise<{ selection: RunModelSelection; state: RunModelFallbackState | null } | null> {
  if (!adapterSupportsFallbackModels(input.adapterType)) return null;
  if (input.routerManaged) {
    delete input.config.fallbackModels;
    return null;
  }
  const primary = text(input.config.model);
  const chain = primary ? buildModelChain(primary, input.config.fallbackModels) : [];
  if (chain.length < 2) return null;
  const forced = text(input.context[MODEL_FALLBACK_FORCED_MODEL_KEY]);
  const start = forced && chain.includes(forced) ? forced : primary;
  input.config.model = start;
  input.config.fallbackModels = chain.filter((selector) => selector !== start);
  const overlayChain = input.config.fallbackModels as string[];
  const reason: RunModelFallbackReason | null = start === primary
    ? null
    : isReason(input.context[MODEL_FALLBACK_REASON_KEY])
      ? (input.context[MODEL_FALLBACK_REASON_KEY] as RunModelFallbackReason)
      : "upstream";
  const primaryEffort = text(input.config.thinking);
  if (start !== primary && primaryEffort) {
    input.config[AGENT_FALLBACK_EFFORTS_KEY] = {
      ...readAgentFallbackEfforts(input.config[AGENT_FALLBACK_EFFORTS_KEY]),
      [primary]: primaryEffort,
    };
  }
  const selection: RunModelSelection = { primary, chain, start, overlayChain, reason };
  const state: RunModelFallbackState | null = reason
    ? { primaryModel: primary, activeModel: start, reason, switchedAt: input.now.toISOString() }
    : null;
  return { selection, state };
}

/** Persists the live fallback view of a run so live-run readers see it while the run is going. */
export async function persistRunModelFallbackState(
  db: Db,
  runId: string,
  values: { primary?: string | null; state: RunModelFallbackState | null },
): Promise<void> {
  const patch: Record<string, unknown> = { [MODEL_FALLBACK_STATE_KEY]: values.state };
  if (values.primary !== undefined) patch[MODEL_FALLBACK_PRIMARY_KEY] = values.primary;
  await db
    .update(heartbeatRuns)
    .set({
      contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(heartbeatRuns.id, runId));
}

/** The selector a finished run was on, from the adapter result, else its live state. */
export function readRunActiveModel(run: { resultJson: unknown; contextSnapshot: unknown }): string | null {
  const reported = text(asRecord(asRecord(run.resultJson).modelFallback).active);
  if (reported) return reported;
  const context = asRecord(run.contextSnapshot);
  return text(asRecord(context[MODEL_FALLBACK_STATE_KEY]).activeModel) || text(context[MODEL_FALLBACK_PRIMARY_KEY]) || null;
}

/** Retry plan for a run whose fallback chain was armed, or null when it had none. */
export async function planModelFallbackRetry(input: {
  db: Db;
  run: { companyId: string; contextSnapshot: unknown; resultJson: unknown };
  agentAdapterConfig: unknown;
  now: Date;
}): Promise<ModelFallbackRetryPlan | null> {
  const context = asRecord(input.run.contextSnapshot);
  const primary = text(context[MODEL_FALLBACK_PRIMARY_KEY]);
  if (!primary) return null;
  const chain = buildModelChain(primary, asRecord(input.agentAdapterConfig).fallbackModels);
  if (chain.length < 2) return null;
  const reason = modelFallbackReasonForErrorFamily(asRecord(input.run.resultJson).errorFamily);
  if (!reason) return null;
  const active = readRunActiveModel(input.run) ?? primary;
  if (!chain.includes(active)) return null;
  const step = planModelFallbackStep({
    chain,
    primary,
    active,
    reason,
    attempts: readModelFallbackAttempts(context[MODEL_FALLBACK_ATTEMPTS_KEY]),
    now: input.now,
  });
  const cooldowns = await loadModelCooldowns(input.db, input.run.companyId, chain, input.now);
  const availableAt = step.start ? null : cooldowns.get(primary)?.until ?? null;
  return { ...step, availableAt };
}

/** Attempts a run lineage may spend: its recorded model budget, else the adapter-agnostic budget. */
export function readModelFallbackAttemptBudget(
  contextSnapshot: Record<string, unknown> | null | undefined,
  unbudgetedAttempts: number,
): number {
  const recorded = contextSnapshot?.[MODEL_FALLBACK_BUDGET_KEY];
  if (typeof recorded !== "number" || !Number.isFinite(recorded) || recorded <= 0) return unbudgetedAttempts;
  return Math.floor(recorded);
}

/** Reads a lineage attempt map leniently: non-negative integer counts per selector. */
export function readModelFallbackAttempts(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const attempts: Record<string, number> = {};
  for (const [selector, count] of Object.entries(record)) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    const key = selector.trim();
    if (key) attempts[key] = Math.floor(count);
  }
  return attempts;
}
/** Run-event message for a model switch. */
export function modelFallbackEventMessage(input: { to: string; primary: string; reason: RunModelFallbackReason }): string {
  return `Fallback: ${input.to} (primary ${input.primary}: ${modelFallbackReasonLabel(input.reason)})`;
}
