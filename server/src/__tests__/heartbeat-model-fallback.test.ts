import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  modelCooldowns,
} from "@tickernelz/paperclip-pro-db";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@tickernelz/paperclip-pro-adapter-utils";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { attentionService } from "../services/attention.ts";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const PRIMARY = "anthropic/claude-opus";
const BACKUP = "openai/gpt-5";
const SECOND = "google/gemini-pro";

type Behavior = (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>;

const ok: Behavior = async () => ({ exitCode: 0, signal: null, timedOut: false, summary: "done" });

function failure(errorFamily: "provider_quota" | "transient_upstream" | "model_refusal", retryNotBefore?: string): Behavior {
  return async (ctx) => ({
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorMessage: errorFamily === "model_refusal" ? "The model refused the request" : "429 Too Many Requests",
    errorCode: `omp_${errorFamily}`,
    errorFamily,
    ...(retryNotBefore ? { retryNotBefore } : {}),
    resultJson: {
      errorFamily,
      ...(retryNotBefore ? { retryNotBefore } : {}),
      modelFallback: { active: String(ctx.config.model ?? "") },
    },
  });
}

async function waitForRun(heartbeat: ReturnType<typeof heartbeatService>, runId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await heartbeat.getRun(runId);
    if (run && !["queued", "running"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return heartbeat.getRun(runId);
}

describeEmbeddedPostgres("per-agent fallback models", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let paperclipHome: string | null = null;
  const previousHome = process.env.PAPERCLIP_HOME;
  const behaviors = new Map<string, Behavior[]>();
  const captured = new Map<string, { config: Record<string, unknown>; context: Record<string, unknown> }>();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-model-fallback-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-model-fallback-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    registerServerAdapter({
      type: "omp_local",
      execute: async (ctx) => {
        captured.set(ctx.runId, { config: { ...ctx.config }, context: { ...ctx.context } });
        const queue = behaviors.get(ctx.agent.id) ?? [];
        const next = queue.shift() ?? ok;
        return next(ctx);
      },
      testEnvironment: async () => ({ adapterType: "omp_local", status: "pass", checks: [], testedAt: new Date().toISOString() }),
    });
  }, 30_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    behaviors.clear();
    captured.clear();
  });

  afterAll(async () => {
    unregisterServerAdapter("omp_local");
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousHome;
    if (paperclipHome) await fs.rm(paperclipHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await tempDb?.cleanup();
  });

  async function seed(adapterConfig: Record<string, unknown>) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Fallback",
      issuePrefix: `F${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "board-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Fallback agent",
      role: "engineer",
      status: "idle",
      adapterType: "omp_local",
      adapterConfig,
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Work",
      status: "todo",
      assigneeAgentId: agentId,
      responsibleUserId: "board-user",
    });
    return { companyId, agentId, issueId };
  }

  async function runOnce(target: { agentId: string; issueId: string }) {
    const queued = await heartbeat.wakeup(target.agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "model_fallback_probe",
      payload: { issueId: target.issueId },
      requestedByActorType: "user",
      requestedByActorId: "board-user",
      contextSnapshot: { issueId: target.issueId, taskId: target.issueId },
    });
    expect(queued).not.toBeNull();
    const finished = await waitForRun(heartbeat, queued!.id);
    return { run: finished!, seen: captured.get(queued!.id)! };
  }

  async function promoteAndResume(dueAt: Date) {
    await expect.poll(async () => {
      const held = await db
        .select({ id: environmentLeases.id })
        .from(environmentLeases)
        .where(and(eq(environmentLeases.status, "active"), isNull(environmentLeases.releasedAt)));
      return held.length;
    }, { timeout: 10_000 }).toBe(0);
    await heartbeat.promoteDueScheduledRetries(new Date(dueAt.getTime() + 1_000));
    await heartbeat.resumeQueuedRuns();
  }

  async function retryOf(runId: string) {
    const [row] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.retryOfRunId, runId));
    return row ?? null;
  }

  async function cooldownRows(companyId: string) {
    return db.select().from(modelCooldowns).where(eq(modelCooldowns.companyId, companyId));
  }

  it("starts on the first non-cooling candidate after OMP reports a fallback, then back on the primary after expiry", async () => {
    const target = await seed({ model: PRIMARY, thinking: "high", fallbackModels: [BACKUP, SECOND], modelEfforts: { [BACKUP]: "low" } });
    behaviors.set(target.agentId, [
      async (ctx) => {
        await ctx.onEvent?.({
          eventType: "model.fallback",
          stream: "system",
          level: "warn",
          message: `Fallback: ${BACKUP}`,
          payload: { phase: "in_run", from: PRIMARY, to: BACKUP, primary: PRIMARY, reason: "rate_limit", retryAfterMs: 600_000 },
        });
        return ok(ctx);
      },
    ]);
    const first = await runOnce(target);
    expect(first.run.status).toBe("succeeded");
    expect(first.seen.config.model).toBe(PRIMARY);
    expect(first.seen.config.fallbackModels).toEqual([BACKUP, SECOND]);
    const [cooldown] = await cooldownRows(target.companyId);
    expect(cooldown?.selector).toBe(PRIMARY);
    expect(cooldown!.cooldownUntil.getTime()).toBeGreaterThan(Date.now() + 500_000);
    const activity = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, target.companyId),
      eq(activityLog.action, "issue.run_model_fallback"),
    ));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.entityId).toBe(target.issueId);
    expect(activity[0]!.details).toMatchObject({ from: PRIMARY, to: BACKUP, reason: "rate_limit", phase: "in_run" });

    const second = await runOnce(target);
    expect(second.seen.config.model).toBe(BACKUP);
    expect(second.seen.config.fallbackModels).toEqual([SECOND, PRIMARY]);
    expect(second.seen.config.modelEfforts).toEqual({ [BACKUP]: "low", [PRIMARY]: "high" });
    expect(second.seen.context.paperclipModelFallback).toMatchObject({
      primaryModel: PRIMARY,
      activeModel: BACKUP,
      reason: "rate_limit",
    });
    const startEvents = await db.select().from(heartbeatRunEvents).where(and(
      eq(heartbeatRunEvents.runId, second.run.id),
      eq(heartbeatRunEvents.eventType, "model.fallback"),
    ));
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]!.payload).toMatchObject({ phase: "run_start", from: PRIMARY, to: BACKUP });

    await db.update(modelCooldowns).set({ cooldownUntil: new Date(Date.now() - 1_000) }).where(eq(modelCooldowns.companyId, target.companyId));
    const third = await runOnce(target);
    expect(third.seen.config.model).toBe(PRIMARY);
    expect(third.seen.context.paperclipModelFallback ?? null).toBeNull();
  }, 60_000);

  it("retries a quota failure on the next candidate at the base backoff instead of the primary's reset time", async () => {
    const target = await seed({ model: PRIMARY, fallbackModels: [BACKUP] });
    behaviors.set(target.agentId, [failure("provider_quota", "2030-04-22T21:00:00.000Z")]);
    const failed = await runOnce(target);
    expect(failed.run.status).toBe("failed");
    await expect.poll(() => cooldownRows(target.companyId).then((rows) => rows.length), { timeout: 5_000 }).toBe(1);
    const [cooldown] = await cooldownRows(target.companyId);
    expect(cooldown).toMatchObject({ selector: PRIMARY, reason: "rate_limit" });
    expect(cooldown!.cooldownUntil.toISOString()).toBe("2030-04-22T21:00:00.000Z");
    await expect.poll(() => retryOf(failed.run.id).then((row) => row?.status ?? null), { timeout: 5_000 }).toBe("scheduled_retry");
    const retry = await retryOf(failed.run.id);
    expect(retry!.scheduledRetryAt!.getTime()).toBeLessThan(Date.now() + 60 * 60_000);
    expect((retry!.contextSnapshot as Record<string, unknown>).providerQuotaRetryNotBefore).toBeUndefined();

    await promoteAndResume(retry!.scheduledRetryAt!);
    const finished = await waitForRun(heartbeat, retry!.id);
    expect(finished?.status).toBe("succeeded");
    expect(captured.get(retry!.id)?.config.model).toBe(BACKUP);
  }, 60_000);

  it("retries a refusal on the next candidate without a company cooldown", async () => {
    const target = await seed({ model: PRIMARY, fallbackModels: [BACKUP] });
    behaviors.set(target.agentId, [failure("model_refusal")]);
    const failed = await runOnce(target);
    expect(failed.run.status).toBe("failed");
    await expect.poll(() => retryOf(failed.run.id).then((row) => row?.status ?? null), { timeout: 5_000 }).toBe("scheduled_retry");
    const retry = await retryOf(failed.run.id);
    expect((retry!.contextSnapshot as Record<string, unknown>).paperclipModelFallbackExcluded).toEqual([PRIMARY]);
    expect(await cooldownRows(target.companyId)).toHaveLength(0);

    await promoteAndResume(retry!.scheduledRetryAt!);
    const finished = await waitForRun(heartbeat, retry!.id);
    expect(captured.get(retry!.id)?.config.model).toBe(BACKUP);
    expect(captured.get(retry!.id)?.config.fallbackModels).toEqual([]);
    expect(finished?.status).toBe("succeeded");
  }, 60_000);

  it("keeps the existing retry timing when every candidate is cooling down", async () => {
    const target = await seed({ model: PRIMARY, fallbackModels: [BACKUP] });
    await db.insert(modelCooldowns).values({
      companyId: target.companyId,
      selector: BACKUP,
      cooldownUntil: new Date("2031-01-01T00:00:00.000Z"),
      reason: "rate_limit",
    });
    behaviors.set(target.agentId, [failure("provider_quota", "2030-04-22T21:00:00.000Z")]);
    const failed = await runOnce(target);
    await expect.poll(() => retryOf(failed.run.id).then((row) => row?.status ?? null), { timeout: 5_000 }).toBe("scheduled_retry");
    const retry = await retryOf(failed.run.id);
    expect(retry!.scheduledRetryAt!.toISOString()).toBe("2030-04-22T21:00:00.000Z");
    expect((retry!.contextSnapshot as Record<string, unknown>).providerQuotaRetryNotBefore).toBe("2030-04-22T21:00:00.000Z");
  }, 60_000);

  it("leaves runs unchanged when the agent has no fallback models", async () => {
    const target = await seed({ model: PRIMARY });
    behaviors.set(target.agentId, [failure("provider_quota", "2030-04-22T21:00:00.000Z")]);
    const failed = await runOnce(target);
    expect(failed.seen.config.model).toBe(PRIMARY);
    expect(failed.seen.config).not.toHaveProperty("fallbackModels");
    expect(failed.seen.context).not.toHaveProperty("paperclipPrimaryModel");
    expect(await cooldownRows(target.companyId)).toHaveLength(0);
    await expect.poll(() => retryOf(failed.run.id).then((row) => row?.status ?? null), { timeout: 5_000 }).toBe("scheduled_retry");
    const retry = await retryOf(failed.run.id);
    expect(retry!.scheduledRetryAt!.toISOString()).toBe("2030-04-22T21:00:00.000Z");

    const refusal = await seed({ model: PRIMARY });
    behaviors.set(refusal.agentId, [failure("model_refusal")]);
    const refused = await runOnce(refusal);
    expect(refused.run.status).toBe("failed");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const refusalRetry = await retryOf(refused.run.id);
    expect((refusalRetry?.contextSnapshot as Record<string, unknown> | undefined)?.paperclipModelFallbackExcluded).toBeUndefined();
    expect(await cooldownRows(refusal.companyId)).toHaveLength(0);
  }, 60_000);

  it("raises an attention item when the chain is exhausted and clears it after a later success", async () => {
    const target = await seed({ model: PRIMARY, fallbackModels: [BACKUP] });
    behaviors.set(target.agentId, [failure("model_refusal"), failure("model_refusal")]);
    const failed = await runOnce(target);
    await expect.poll(() => retryOf(failed.run.id).then((row) => row?.status ?? null), { timeout: 5_000 }).toBe("scheduled_retry");
    const retry = await retryOf(failed.run.id);
    await promoteAndResume(retry!.scheduledRetryAt!);
    const exhausted = await waitForRun(heartbeat, retry!.id);
    expect(exhausted?.status).toBe("failed");
    expect(captured.get(retry!.id)?.config.model).toBe(BACKUP);
    await expect.poll(async () => {
      const rows = await db.select().from(heartbeatRunEvents).where(and(
        eq(heartbeatRunEvents.runId, retry!.id),
        eq(heartbeatRunEvents.eventType, "model.fallback_exhausted"),
      ));
      return rows.length;
    }, { timeout: 5_000 }).toBe(1);
    expect(await retryOf(retry!.id)).toBeNull();

    const attention = attentionService(db);
    const before = await attention.list(target.companyId);
    const item = before.items.find((entry) => entry.subject.kind === "run" && entry.subject.id === retry!.id);
    expect(item?.sourceKind).toBe("failed_run");
    expect(item?.whyNow).toContain("fallback");

    const otherIssueId = randomUUID();
    await db.insert(issues).values({
      id: otherIssueId,
      companyId: target.companyId,
      title: "Other work",
      status: "todo",
      assigneeAgentId: target.agentId,
      responsibleUserId: "board-user",
    });
    const later = await runOnce({ agentId: target.agentId, issueId: otherIssueId });
    expect(later.run.status).toBe("succeeded");
    const after = await attention.list(target.companyId);
    expect(after.items.some((entry) => entry.subject.kind === "run" && entry.subject.id === retry!.id)).toBe(false);
  }, 60_000);
});
