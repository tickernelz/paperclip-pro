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

export function watchLegacyControllerLease(db: Db, run: Run, controller: AbortController) {
  if (run.runtimeMode === "native" || !run.controllerBootId) {
    return { stop() {}, async assertOwned(_stage?: "dispatching") {} };
  }
  let stopped = false;
  let pending = false;
  let recovering = false;
  let expiresAt = run.controllerLeaseExpiresAt?.getTime() ?? 0;
  let deadline = setTimeout(() => onDeadline(), Math.max(0, expiresAt - Date.now()));
  deadline.unref();
  const abortLost = () => { if (!stopped) controller.abort(new Error("Legacy controller lease lost")); };
  const armDeadline = (from: number) => {
    clearTimeout(deadline);
    expiresAt = from + LEGACY_CONTROLLER_LEASE_MS;
    deadline = setTimeout(() => onDeadline(), Math.max(0, expiresAt - Date.now()));
    deadline.unref();
  };
  const boundedReclaim = () => new Promise<boolean>((resolve) => {
    const bound = setTimeout(() => resolve(false), LEGACY_CONTROLLER_RECLAIM_TIMEOUT_MS);
    bound.unref();
    reclaimLegacyControllerLease(db, run).then(
      (owned) => { clearTimeout(bound); resolve(owned); },
      () => { clearTimeout(bound); resolve(false); },
    );
  });
  const reclaimOrAbort = async () => {
    if (stopped || controller.signal.aborted) return false;
    const overdueMs = Math.max(0, Date.now() - expiresAt);
    const reclaimed = await boundedReclaim();
    if (stopped) return false;
    if (!reclaimed) { abortLost(); return false; }
    logger.warn({ runId: run.id, overdueMs }, "legacy controller lease overdue; reclaimed");
    armDeadline(Date.now());
    return true;
  };
  const onDeadline = () => {
    if (recovering || stopped) return;
    recovering = true;
    void reclaimOrAbort().finally(() => { recovering = false; });
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
    try {
      renewed = await Promise.race([renewLegacyControllerLease(db, run, stage), aborted]);
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
    }
    if (stopped) return;
    if (!renewed) {
      await reclaimOrAbort();
      controller.signal.throwIfAborted();
      return;
    }
    controller.signal.throwIfAborted();
    if (!stopped) armDeadline(startedAt);
  };
  const timer = setInterval(() => {
    if (pending || stopped) return;
    pending = true;
    void assertOwned().catch(() => reclaimOrAbort()).finally(() => { pending = false; });
  }, LEGACY_CONTROLLER_RENEW_MS);
  timer.unref();
  return { assertOwned, stop() { stopped = true; clearInterval(timer); clearTimeout(deadline); } };
}
