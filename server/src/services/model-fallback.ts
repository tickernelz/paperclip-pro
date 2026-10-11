import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { heartbeatRuns, modelCooldowns, type Db } from "@tickernelz/paperclip-pro-db";
import { unprocessable } from "../errors.js";
import {
  AGENT_FALLBACK_MODELS_KEY,
  adapterSupportsFallbackModels,
  readAgentFallbackModels,
  validateAgentFallbackModels,
  type RunModelFallbackReason,
  type RunModelFallbackState,
} from "@tickernelz/paperclip-pro-shared";

export const MODEL_FALLBACK_DEFAULT_COOLDOWN_MS = 5 * 60_000;
export const MODEL_FALLBACK_STATE_KEY = "paperclipModelFallback";
export const MODEL_FALLBACK_PRIMARY_KEY = "paperclipPrimaryModel";
export const MODEL_FALLBACK_EXCLUDED_KEY = "paperclipModelFallbackExcluded";
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

export interface ModelFallbackRetryPlan {
  chain: string[];
  excluded: string[];
  next: { selector: string; cooling: boolean; availableAt: Date | null } | null;
}

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
  if (!Object.hasOwn(adapterConfig, AGENT_FALLBACK_MODELS_KEY)) return adapterConfig;
  if (!adapterSupportsFallbackModels(adapterType ?? "")) return adapterConfig;
  const primary = text(adapterConfig.model) || text(baseAdapterConfig?.model);
  const validation = validateAgentFallbackModels(adapterConfig[AGENT_FALLBACK_MODELS_KEY], primary);
  if (!validation.ok) throw unprocessable(validation.message, { key: AGENT_FALLBACK_MODELS_KEY });
  const next = { ...adapterConfig };
  if (validation.value.length === 0) delete next[AGENT_FALLBACK_MODELS_KEY];
  else next[AGENT_FALLBACK_MODELS_KEY] = validation.value;
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

/** Picks the model a run starts on and the order OMP may fall back through. */
export function selectRunModel(input: {
  primary: string;
  fallbackModels: unknown;
  excluded: readonly string[];
  cooldowns: Map<string, ModelCooldown>;
  now: Date;
}): RunModelSelection | null {
  const primary = input.primary.trim();
  if (!primary) return null;
  const chain = buildModelChain(primary, input.fallbackModels);
  if (chain.length < 2) return null;
  const eligible = chain.filter((selector) => !input.excluded.includes(selector));
  if (eligible.length === 0) {
    return { primary, chain, start: primary, overlayChain: chain.slice(1), reason: null };
  }
  const free = eligible.filter((selector) => !isCooling(input.cooldowns, selector, input.now));
  const start = free[0] ?? [...eligible].sort(
    (left, right) =>
      (input.cooldowns.get(left)?.until.getTime() ?? 0) - (input.cooldowns.get(right)?.until.getTime() ?? 0),
  )[0]!;
  const rest = eligible.filter((selector) => selector !== start);
  const overlayChain = [
    ...rest.filter((selector) => free.includes(selector)),
    ...rest.filter((selector) => !free.includes(selector)),
  ];
  const reason = start === primary
    ? null
    : input.excluded.includes(primary)
      ? "refusal"
      : input.cooldowns.get(primary)?.reason ?? "rate_limit";
  return { primary, chain, start, overlayChain, reason };
}

/** The candidate a Paperclip retry would start on after the given exclusions and cooldowns. */
export function nextModelFallbackCandidate(input: {
  chain: readonly string[];
  excluded: readonly string[];
  cooldowns: Map<string, ModelCooldown>;
  now: Date;
}): { selector: string; cooling: boolean; availableAt: Date | null } | null {
  const eligible = input.chain.filter((selector) => !input.excluded.includes(selector));
  if (eligible.length === 0) return null;
  const free = eligible.find((selector) => !isCooling(input.cooldowns, selector, input.now));
  if (free) return { selector: free, cooling: false, availableAt: null };
  const earliest = [...eligible].sort(
    (left, right) =>
      (input.cooldowns.get(left)?.until.getTime() ?? 0) - (input.cooldowns.get(right)?.until.getTime() ?? 0),
  )[0]!;
  return { selector: earliest, cooling: true, availableAt: input.cooldowns.get(earliest)?.until ?? null };
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
  const excluded = stringList(input.context[MODEL_FALLBACK_EXCLUDED_KEY]);
  const cooldowns = await loadModelCooldowns(input.db, input.companyId, chain, input.now);
  const selection = selectRunModel({
    primary,
    fallbackModels: input.config.fallbackModels,
    excluded,
    cooldowns,
    now: input.now,
  });
  if (!selection) return null;
  input.config.model = selection.start;
  input.config.fallbackModels = selection.overlayChain;
  const state: RunModelFallbackState | null = selection.reason
    ? {
        primaryModel: selection.primary,
        activeModel: selection.start,
        reason: selection.reason,
        switchedAt: input.now.toISOString(),
      }
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
  const refused = asRecord(input.run.resultJson).errorFamily === "model_refusal" ? readRunActiveModel(input.run) : null;
  const excluded = [...new Set([...stringList(context[MODEL_FALLBACK_EXCLUDED_KEY]), ...(refused ? [refused] : [])])];
  const cooldowns = await loadModelCooldowns(input.db, input.run.companyId, chain, input.now);
  return { chain, excluded, next: nextModelFallbackCandidate({ chain, excluded, cooldowns, now: input.now }) };
}

/** Run-event message for a model switch. */
export function modelFallbackEventMessage(input: { to: string; primary: string; reason: RunModelFallbackReason }): string {
  return `Fallback: ${input.to} (primary ${input.primary}: ${modelFallbackReasonLabel(input.reason)})`;
}
