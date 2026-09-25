import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService, markLocalCliRunStarting } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

type AdapterLog = (stream: "stdout" | "stderr", chunk: string) => Promise<void>;

const adapterGate = vi.hoisted(() => ({
  waiters: [] as Array<() => void>,
  contexts: new Map<string, { onLog: (stream: string, chunk: string) => Promise<void> }>(),
}));

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async (ctx: { runId: string; onLog: (stream: string, chunk: string) => Promise<void> }) => {
    adapterGate.contexts.set(ctx.runId, ctx);
    await new Promise<void>((resolve) => { adapterGate.waiters.push(resolve); });
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      summary: "Local concurrency cap test run.",
      provider: "test",
      model: "test-model",
    };
  }),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fn();
}

describeEmbeddedPostgres("instance-wide local CLI run concurrency", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-local-run-cap-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgentWithWork(companyId: string, index: number) {
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `LocalRunner${index}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Mission ${index}`,
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      responsibleUserId: "responsible-user",
    });
    return { agentId, issueId };
  }

  async function seedAgentsWithWork(companyId: string, count: number) {
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `L${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const seeded: Array<{ agentId: string; issueId: string }> = [];
    for (let index = 0; index < count; index += 1) {
      seeded.push(await seedAgentWithWork(companyId, index));
    }
    return seeded;
  }

  async function adapterLogFor(runId: string): Promise<AdapterLog> {
    expect(await waitForCondition(async () => adapterGate.contexts.has(runId))).toBe(true);
    const ctx = adapterGate.contexts.get(runId)!;
    return (stream, chunk) => ctx.onLog(stream, chunk);
  }

  async function reportStartupSignal(runId: string) {
    const log = await adapterLogFor(runId);
    await log("stdout", '{"type":"session","version":3,"id":"01a0d6d4","cwd":"/tmp"}\n');
  }

  async function settle(ms = 400) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function countRuns(companyId: string, status: string) {
    const rows = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, companyId));
    return rows.filter((row) => row.status === status).length;
  }

  async function wakeAll(
    heartbeat: ReturnType<typeof heartbeatService>,
    seeded: Array<{ agentId: string; issueId: string }>,
  ) {
    for (const { agentId, issueId } of seeded) {
      await heartbeat.wakeup(agentId, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: { issueId },
        contextSnapshot: { issueId, wakeReason: "issue_assigned" },
      });
    }
  }

  async function drainEverything(heartbeat: ReturnType<typeof heartbeatService>) {
    while (adapterGate.waiters.length > 0) adapterGate.waiters.shift()!();
    await waitForCondition(async () => {
      while (adapterGate.waiters.length > 0) adapterGate.waiters.shift()!();
      const rows = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns);
      return rows.every((row) => row.status !== "running" && row.status !== "queued");
    }, 20_000);
    await heartbeat.drainActiveRunExecutions();
    runningProcesses.clear();
    adapterGate.contexts.clear();
  }

  async function runningRunIds(companyId: string) {
    const rows = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, companyId));
    return rows.filter((row) => row.status === "running").map((row) => row.id);
  }

  it("holds queued local runs at the instance cap and starts the next when one finishes", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 5);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: { ...process.env, PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "2" },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 2)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const firstWave = await runningRunIds(companyId);
    expect(firstWave).toHaveLength(2);
    expect(await countRuns(companyId, "queued")).toBe(3);

    adapterGate.waiters.shift()!();
    expect(await waitForCondition(async () => (await countRuns(companyId, "succeeded")) >= 1)).toBe(true);

    await heartbeat.resumeQueuedRuns();
    expect(await waitForCondition(async () => {
      const running = await runningRunIds(companyId);
      return running.length === 2 && running.some((id) => !firstWave.includes(id));
    })).toBe(true);
    for (let probe = 0; probe < 10; probe += 1) {
      expect((await runningRunIds(companyId)).length).toBeLessThanOrEqual(2);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
    expect(await countRuns(companyId, "cancelled")).toBe(0);
    expect(await countRuns(companyId, "succeeded")).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it("ignores a running row that no local process backs", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 1);
    const strandedCompanyId = randomUUID();
    const [stranded] = await seedAgentsWithWork(strandedCompanyId, 1);
    await db.insert(heartbeatRuns).values({
      companyId: strandedCompanyId,
      agentId: stranded!.agentId,
      status: "running",
      responsibleUserId: "responsible-user",
    });
    const heartbeat = heartbeatService(db, {
      runtimeEnv: { ...process.env, PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "1" },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 1)).toBe(true);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "succeeded")).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("dispatches another agent's queued run as soon as a cap slot frees", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 2);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: { ...process.env, PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "1" },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 1)).toBe(true);
    const firstWave = await runningRunIds(companyId);
    expect(await countRuns(companyId, "queued")).toBe(1);

    expect(await waitForCondition(async () => adapterGate.waiters.length > 0)).toBe(true);
    adapterGate.waiters.shift()!();
    expect(await waitForCondition(async () => {
      const running = await runningRunIds(companyId);
      return running.length === 1 && !firstWave.includes(running[0]!);
    })).toBe(true);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "succeeded")).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("starts every queued local run when the instance cap allows it", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 5);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "5",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "5",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 5)).toBe(true);
    expect(await countRuns(companyId, "queued")).toBe(0);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 60_000);

  it("holds the fifth start while four local runs are still starting, and releases it on the startup signal", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 5);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "10",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "4",
        PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "600",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 4)).toBe(true);
    await settle();
    expect(await countRuns(companyId, "running")).toBe(4);
    expect(await countRuns(companyId, "queued")).toBe(1);

    const firstRunId = (await runningRunIds(companyId))[0]!;
    const log = await adapterLogFor(firstRunId);
    await log("stderr", "Still starting after 10s \u2014 phase: loadExtensions\n");
    await settle();
    expect(await countRuns(companyId, "running")).toBe(4);
    expect(await countRuns(companyId, "queued")).toBe(1);

    await reportStartupSignal(firstRunId);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 5)).toBe(true);
    expect(await countRuns(companyId, "queued")).toBe(0);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 90_000);

  it("holds the eleventh local run at the total cap even when nothing is starting", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 11);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "10",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "11",
        PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "600",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 10, 20_000)).toBe(true);
    for (const runId of await runningRunIds(companyId)) await reportStartupSignal(runId);
    await settle(600);
    expect(await countRuns(companyId, "running")).toBe(10);
    expect(await countRuns(companyId, "queued")).toBe(1);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 120_000);

  it("lets a long-waiting queued run bypass the startup gate", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 5);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "10",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "4",
        PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "600",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 4)).toBe(true);
    await heartbeat.resumeQueuedRuns();
    await settle();
    expect(await countRuns(companyId, "running")).toBe(4);
    expect(await countRuns(companyId, "queued")).toBe(1);

    await db
      .update(heartbeatRuns)
      .set({ createdAt: new Date(Date.now() - 700_000) })
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "queued")));
    await heartbeat.resumeQueuedRuns();
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 5)).toBe(true);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 90_000);

  it("keeps a long-waiting queued run behind the total cap", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 5);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "4",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "4",
        PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "600",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 4)).toBe(true);
    await db
      .update(heartbeatRuns)
      .set({ createdAt: new Date(Date.now() - 700_000) })
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "queued")));
    await heartbeat.resumeQueuedRuns();
    await settle(600);
    expect(await countRuns(companyId, "running")).toBe(4);
    expect(await countRuns(companyId, "queued")).toBe(1);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 90_000);

  it("stops counting a start that never reported its signal", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 1);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "10",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "1",
        PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "600",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 1)).toBe(true);
    const stuckRunId = (await runningRunIds(companyId))[0]!;

    const second = await seedAgentWithWork(companyId, 1);
    await wakeAll(heartbeat, [second]);
    await settle(600);
    expect(await countRuns(companyId, "running")).toBe(1);
    expect(await countRuns(companyId, "queued")).toBe(1);

    markLocalCliRunStarting(stuckRunId, Date.now() - 601_000);
    await heartbeat.resumeQueuedRuns();
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 2)).toBe(true);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 90_000);

  it("re-evaluates a gated queued run without an external scheduler tick", async () => {
    const companyId = randomUUID();
    const seeded = await seedAgentsWithWork(companyId, 1);
    const heartbeat = heartbeatService(db, {
      runtimeEnv: {
        ...process.env,
        PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "10",
        PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "1",
        PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "2",
      },
    });

    await wakeAll(heartbeat, seeded);
    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 1)).toBe(true);
    const second = await seedAgentWithWork(companyId, 1);
    await wakeAll(heartbeat, [second]);
    expect(await countRuns(companyId, "queued")).toBe(1);

    expect(await waitForCondition(async () => (await countRuns(companyId, "running")) === 2, 15_000)).toBe(true);

    await drainEverything(heartbeat);
    expect(await countRuns(companyId, "failed")).toBe(0);
  }, 90_000);
});
