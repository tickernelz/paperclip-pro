import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@tickernelz/paperclip-pro-db";
import { logger } from "../middleware/logger.js";

// A boot UUID has meaning across containers; a numeric PID does not.
export const legacyControllerBootId = randomUUID();
export const LEGACY_CONTROLLER_LEASE_MS = 60_000;
export const LEGACY_CONTROLLER_RENEW_MS = 10_000;
export const LEGACY_CONTROLLER_RECLAIM_TIMEOUT_MS = 10_000;

type Run = typeof heartbeatRuns.$inferSelect;

/** Commit these fields in the same UPDATE that claims a queued run. */
export function legacyControllerClaim(runtimeMode: string) {
  if (runtimeMode === "native") return {};
  return {
    controllerBootId: legacyControllerBootId,
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
    executionStage: "preparing",
  };
}

export async function renewLegacyControllerLease(
  db: Db,
  run: Pick<Run, "id" | "companyId" | "controllerBootId">,
  stage?: "dispatching",
): Promise<boolean> {
  const [renewed] = await db.update(heartbeatRuns).set({
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
    ...(stage ? { executionStage: stage } : {}),
  }).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.runtimeMode, "legacy"), eq(heartbeatRuns.status, "running"),
    eq(heartbeatRuns.controllerBootId, legacyControllerBootId),
    gt(heartbeatRuns.controllerLeaseExpiresAt, sql`clock_timestamp()`),
  )).returning({ id: heartbeatRuns.id });
  return Boolean(renewed);
}

export async function hasLiveLegacyController(db: Db, run: Run): Promise<boolean> {
  if (run.runtimeMode === "native" || !run.controllerBootId) return false;
  const [owner] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.status, "running"),
    gt(heartbeatRuns.controllerLeaseExpiresAt, sql`clock_timestamp()`),
  ));
  return Boolean(owner);
}

/** Atomically revoke an expired controller. Renewal and revocation serialize on
 * the run row. Expiry permits cleanup, never dispatch of a replacement agent. */
export async function revokeExpiredLegacyController(db: Db, run: Run): Promise<boolean> {
  if (run.runtimeMode === "native" || !run.controllerBootId) return true;
  const [revoked] = await db.update(heartbeatRuns).set({
    controllerBootId: randomUUID(),
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
  }).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.status, "running"),
    eq(heartbeatRuns.controllerBootId, run.controllerBootId),
    lte(heartbeatRuns.controllerLeaseExpiresAt, sql`clock_timestamp()`),
  )).returning({ id: heartbeatRuns.id });
  return Boolean(revoked);
}

export async function reclaimLegacyControllerLease(
  db: Db,
  run: Pick<Run, "id" | "companyId">,
): Promise<boolean> {
  const [reclaimed] = await db.update(heartbeatRuns).set({
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
  }).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.runtimeMode, "legacy"), eq(heartbeatRuns.status, "running"),
    eq(heartbeatRuns.controllerBootId, legacyControllerBootId),
  )).returning({ id: heartbeatRuns.id });
  return Boolean(reclaimed);
}

export const LEGACY_CONTROLLER_LEASE_LOST_CODE = "controller_lease_lost";

export class LegacyControllerLeaseLostError extends Error {
  readonly code = LEGACY_CONTROLLER_LEASE_LOST_CODE;
  constructor() {
    super("Legacy controller lease lost");
    this.name = "LegacyControllerLeaseLostError";
  }
}

export function isLegacyControllerLeaseLoss(reason: unknown): reason is LegacyControllerLeaseLostError {
  return reason instanceof LegacyControllerLeaseLostError;
}

type ReclaimOutcome = "owned" | "lost" | "unknown";

export function watchLegacyControllerLease(db: Db, run: Run, controller: AbortController) {
  if (run.runtimeMode === "native" || !run.controllerBootId) {
    return { stop() {}, async assertOwned(_stage?: "dispatching") {} };
  }
  let stopped = false;
  let pending = false;
  let recovering = false;
  let unconfirmedSince: number | null = null;
  let ownershipChecks = 0;
  let expiresAt = run.controllerLeaseExpiresAt?.getTime() ?? 0;
  let deadline = setTimeout(() => onDeadline(), Math.max(0, expiresAt - Date.now()));
  deadline.unref();
  const abortLost = () => {
    if (stopped || controller.signal.aborted) return;
    logger.error({ runId: run.id }, "legacy controller lease lost; stopping the run");
    controller.abort(new LegacyControllerLeaseLostError());
  };
  const schedule = (delayMs: number) => {
    clearTimeout(deadline);
    deadline = setTimeout(() => onDeadline(), Math.max(0, delayMs));
    deadline.unref();
  };
  const armDeadline = (from: number) => {
    expiresAt = from + LEGACY_CONTROLLER_LEASE_MS;
    schedule(expiresAt - Date.now());
  };
  const boundedReclaim = () => new Promise<ReclaimOutcome>((resolve) => {
    const bound = setTimeout(() => resolve("unknown"), LEGACY_CONTROLLER_RECLAIM_TIMEOUT_MS);
    bound.unref();
    reclaimLegacyControllerLease(db, run).then(
      (owned) => { clearTimeout(bound); resolve(owned ? "owned" : "lost"); },
      () => { clearTimeout(bound); resolve("unknown"); },
    );
  });
  const settleReclaim = async (failClosed: boolean) => {
    if (stopped || controller.signal.aborted) return false;
    const overdueMs = Math.max(0, Date.now() - expiresAt);
    const outcome = await boundedReclaim();
    if (stopped) return false;
    if (outcome === "owned") {
      logger.warn({ runId: run.id, overdueMs }, "legacy controller lease overdue; reclaimed");
      unconfirmedSince = null;
      armDeadline(Date.now());
      return true;
    }
    if (outcome === "lost" || failClosed) { abortLost(); return false; }
    unconfirmedSince ??= Date.now();
    logger.warn({ runId: run.id, overdueMs, unconfirmedMs: Date.now() - unconfirmedSince },
      "legacy controller lease could not be confirmed; keeping the live run and retrying");
    schedule(LEGACY_CONTROLLER_RENEW_MS);
    return false;
  };
  const onDeadline = () => {
    if (recovering || stopped) return;
    recovering = true;
    void settleReclaim(ownershipChecks > 0).finally(() => { recovering = false; });
  };
  const assertOwned = async (stage?: "dispatching") => {
    if (stopped) return;
    controller.signal.throwIfAborted();
    const startedAt = Date.now();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    let renewed: boolean;
    ownershipChecks += 1;
    try {
      renewed = await Promise.race([renewLegacyControllerLease(db, run, stage), aborted]);
    } finally {
      ownershipChecks -= 1;
      controller.signal.removeEventListener("abort", onAbort);
    }
    if (stopped) return;
    if (!renewed) {
      await settleReclaim(true);
      controller.signal.throwIfAborted();
      return;
    }
    controller.signal.throwIfAborted();
    unconfirmedSince = null;
    if (!stopped) armDeadline(startedAt);
  };
  const renewInBackground = async () => {
    const startedAt = Date.now();
    const renewed = await renewLegacyControllerLease(db, run).catch(() => false);
    if (stopped || controller.signal.aborted) return;
    if (renewed) { unconfirmedSince = null; armDeadline(startedAt); return; }
    if (recovering) return;
    recovering = true;
    try { await settleReclaim(false); } finally { recovering = false; }
  };
  const timer = setInterval(() => {
    if (pending || stopped) return;
    pending = true;
    void renewInBackground().finally(() => { pending = false; });
  }, LEGACY_CONTROLLER_RENEW_MS);
  timer.unref();
  return { assertOwned, stop() { stopped = true; clearInterval(timer); clearTimeout(deadline); } };
}
