import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentTaskSessions,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import type * as AdaptersModule from "../adapters/index.ts";

const SAVED_SESSION_ID = "saved-session";
const instructionOperator = { type: "board", userId: "local-board", source: "local_implicit" } as const;

const savedSessionResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  errorMessage: null,
  summary: "Worked on the issue.",
  provider: "test",
  model: "model-a",
  sessionParams: { sessionId: SAVED_SESSION_ID },
  sessionDisplayId: SAVED_SESSION_ID,
};

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async (_input?: unknown): Promise<Record<string, unknown>> => ({})),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof AdaptersModule>(
    "../adapters/index.ts",
  );
  const adapter = {
    type: "codex_local",
    supportsLocalAgentJwt: false,
    execute: mockAdapterExecute,
  };
  return {
    ...actual,
    getServerAdapter: vi.fn(() => adapter),
    findActiveServerAdapter: vi.fn(() => adapter),
  };
});

import { runningProcesses } from "../adapters/index.ts";
import { heartbeatService, resetHeartbeatServerShutdownForTests } from "../services/heartbeat.ts";
import { agentInstructionRevisionService } from "../services/agent-instruction-revisions.ts";
import { resolveManagedInstructionsRoot } from "../services/agent-instructions.ts";
import { agentService } from "../services/agents.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres process-loss session resume tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type AdapterInput = {
  runId: string;
  runtime: { sessionId: string | null; sessionParams: Record<string, unknown> | null };
};

describeEmbeddedPostgres("process-loss continuation session resume", () => {
  let db!: Db;
  let tempDb: EmbeddedPostgresTestDatabase | null = null;
  const previousHome = process.env.PAPERCLIP_HOME;
  let paperclipHome: string | null = null;

  beforeAll(async () => {
    paperclipHome = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-process-loss-home-")),
    );
    process.env.PAPERCLIP_HOME = paperclipHome;
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-process-loss-session-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    resetHeartbeatServerShutdownForTests();
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    runningProcesses.clear();
    mockAdapterExecute.mockReset();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousHome;
    if (paperclipHome) await fs.rm(paperclipHome, { recursive: true, force: true });
  });

  async function seedAgentWithSavedSession(adapterType = "codex_local") {
    mockAdapterExecute.mockImplementation(async () => savedSessionResult);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const instructionsRoot = resolveManagedInstructionsRoot({ id: agentId, companyId, name: "Irfan", adapterConfig: {} });
    await fs.mkdir(instructionsRoot, { recursive: true });
    const instructionsPath = path.join(instructionsRoot, "AGENTS.md");
    await fs.writeFile(instructionsPath, "You are Irfan. Version one.\n", "utf8");

    const issueId = randomUUID();
    const issuePrefix = `S${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Irfan",
      role: "engineer",
      status: "idle",
      adapterType,
      adapterConfig: {
        model: "model-a",
        instructionsBundleMode: "managed",
        instructionsRootPath: instructionsRoot,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: instructionsPath,
        promptTemplate: "Continue the assigned work.",
      },
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Keep the provider session across a restart",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      responsibleUserId: "responsible-user",
      monitorNextCheckAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const heartbeat = heartbeatService(db);
    const first = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      requestedByActorType: "user",
      requestedByActorId: "responsible-user",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_commented" },
    });
    expect(first).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    expect((await heartbeat.getRun(first!.id))?.status).toBe("succeeded");
    const sessions = await db
      .select()
      .from(agentTaskSessions)
      .where(eq(agentTaskSessions.agentId, agentId));
    expect(sessions.map((row) => row.sessionDisplayId)).toEqual([SAVED_SESSION_ID]);
    return { companyId, agentId, issueId };
  }

  async function editInstructionsThroughBundleWrite(agentId: string) {
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0]!);
    const revisions = agentInstructionRevisionService(db);
    const target = { companyId: agent.companyId, agentId };
    const baseline = await revisions.readCurrent(target, instructionOperator);
    await revisions.commit(
      {
        ...target,
        entryFile: "AGENTS.md",
        content: "You are Irfan. Version two, edited by Jono.\n",
        baseRevisionId: baseline?.revision.id ?? null,
        source: "board",
      },
      instructionOperator,
    );
  }

  async function loseRunningTurnToShutdown(input: {
    companyId: string;
    agentId: string;
    issueId: string;
  }) {
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    const now = new Date();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId: input.companyId,
      agentId: input.agentId,
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      payload: { issueId: input.issueId },
      status: "claimed",
      runId,
      claimedAt: now,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "running",
      wakeupRequestId,
      contextSnapshot: {
        issueId: input.issueId,
        taskId: input.issueId,
        wakeReason: "issue_commented",
      },
      sessionIdBefore: SAVED_SESSION_ID,
      nextEventSeq: 2,
      startedAt: now,
    });
    await db.insert(heartbeatRunEvents).values({
      companyId: input.companyId,
      agentId: input.agentId,
      runId,
      seq: 1,
      eventType: "adapter.invoke",
      payload: { adapterType: "codex_local" },
    });
    await db.update(agents).set({ status: "running" }).where(eq(agents.id, input.agentId));
    await db
      .update(issues)
      .set({ checkoutRunId: runId, executionRunId: runId })
      .where(eq(issues.id, input.issueId));

    const drain = await heartbeatService(db).drainRunningRunsForShutdown("SIGTERM");
    const continuation = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.retryOfRunId, runId))
      .then((rows) => rows[0]!);
    expect(drain.retryRunIds).toEqual([continuation.id]);
    expect(continuation).toMatchObject({
      status: "scheduled_retry",
      scheduledRetryReason: "process_lost",
    });
    return continuation;
  }

  async function runContinuationAfterRestart(continuation: {
    id: string;
    scheduledRetryAt: Date | null;
  }) {
    resetHeartbeatServerShutdownForTests();
    const restarted = heartbeatService(db);
    const promotion = await restarted.promoteDueScheduledRetries(
      new Date((continuation.scheduledRetryAt ?? new Date()).getTime() + 1_000),
    );
    expect(promotion.runIds).toContain(continuation.id);
    await restarted.resumeQueuedRuns();
    await drainHeartbeatRunsToQuiescence(db, restarted);
    return continuation.id;
  }

  async function settledTurn(runId: string) {
    const heartbeat = heartbeatService(db);
    const run = await heartbeat.getRun(runId);
    const adapterInput = mockAdapterExecute.mock.calls
      .map(([input]) => input as AdapterInput)
      .find((input) => input.runId === runId);
    const session = (run?.resultJson as {
      configFreshness?: {
        session?: {
          reset: boolean;
          resetReasons: string[];
          changedCategories: string[];
          taskSessionReused: boolean;
        };
      };
    } | null)?.configFreshness?.session;
    return { run, adapterInput, session };
  }

  it("resumes the saved session when only instructions changed while the turn was lost to a restart", async () => {
    const seeded = await seedAgentWithSavedSession();
    const continuation = await loseRunningTurnToShutdown(seeded);
    await editInstructionsThroughBundleWrite(seeded.agentId);

    const continuationId = await runContinuationAfterRestart(continuation);
    const turn = await settledTurn(continuationId);

    expect(turn.run?.status).toBe("succeeded");
    expect(turn.adapterInput?.runtime.sessionId).toBe(SAVED_SESSION_ID);
    expect(turn.run?.sessionIdBefore).toBe(SAVED_SESSION_ID);
    expect(turn.session).toMatchObject({
      reset: false,
      resetReasons: [],
      taskSessionReused: true,
    });
    expect(turn.session?.changedCategories).toEqual(["instructions"]);
  });

  it("starts a fresh session for a process-loss continuation when the configured model changed", async () => {
    const seeded = await seedAgentWithSavedSession();
    const continuation = await loseRunningTurnToShutdown(seeded);
    await editInstructionsThroughBundleWrite(seeded.agentId);
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, seeded.agentId))
      .then((rows) => rows[0]!);
    await db
      .update(agents)
      .set({ adapterConfig: { ...(agent.adapterConfig as Record<string, unknown>), model: "model-b" } })
      .where(eq(agents.id, seeded.agentId));

    const continuationId = await runContinuationAfterRestart(continuation);
    const turn = await settledTurn(continuationId);

    expect(turn.run?.status).toBe("succeeded");
    expect(turn.adapterInput?.runtime.sessionId).toBeNull();
    expect(turn.session?.reset).toBe(true);
    expect(turn.session?.taskSessionReused).toBe(false);
  });

  async function wakeOnComment(seeded: { agentId: string; issueId: string }) {
    const heartbeat = heartbeatService(db);
    const next = await heartbeat.wakeup(seeded.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      requestedByActorType: "user",
      requestedByActorId: "responsible-user",
      payload: { issueId: seeded.issueId },
      contextSnapshot: {
        issueId: seeded.issueId,
        taskId: seeded.issueId,
        wakeReason: "issue_commented",
      },
    });
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    return settledTurn(next!.id);
  }

  async function changeAdapterConfigThroughRevision(
    agentId: string,
    patch: Record<string, unknown>,
  ) {
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0]!);
    await agentService(db).update(
      agentId,
      { adapterConfig: { ...(agent.adapterConfig as Record<string, unknown>), ...patch } },
      {
        recordRevision: {
          createdByAgentId: null,
          createdByUserId: "responsible-user",
          source: "patch",
        },
      },
    );
  }

  it("resumes an omp_local session in place after its model and thinking change", async () => {
    const seeded = await seedAgentWithSavedSession("omp_local");
    await changeAdapterConfigThroughRevision(seeded.agentId, { model: "model-b", thinking: "low" });

    const turn = await wakeOnComment(seeded);

    expect(turn.run?.status).toBe("succeeded");
    expect(turn.adapterInput?.runtime.sessionId).toBe(SAVED_SESSION_ID);
    expect(turn.session).toMatchObject({ reset: false, resetReasons: [], taskSessionReused: true });
    const [stored] = await db
      .select()
      .from(agentTaskSessions)
      .where(eq(agentTaskSessions.agentId, seeded.agentId));
    expect(stored?.sessionParamsJson).toMatchObject({ __paperclipConfiguredModel: "model-b" });
  });

  it("still starts a fresh omp_local session when another adapter setting changes with the model", async () => {
    const seeded = await seedAgentWithSavedSession("omp_local");
    await changeAdapterConfigThroughRevision(seeded.agentId, { model: "model-b", smolModel: "vendor/smol" });

    const turn = await wakeOnComment(seeded);

    expect(turn.run?.status).toBe("succeeded");
    expect(turn.adapterInput?.runtime.sessionId).toBeNull();
    expect(turn.session?.reset).toBe(true);
    expect(turn.session?.changedCategories).toEqual(
      expect.arrayContaining(["adapterConfig"]),
    );
  });

  it("starts a fresh codex_local session after its model changes", async () => {
    const seeded = await seedAgentWithSavedSession();
    await changeAdapterConfigThroughRevision(seeded.agentId, { model: "model-b" });

    const turn = await wakeOnComment(seeded);

    expect(turn.run?.status).toBe("succeeded");
    expect(turn.adapterInput?.runtime.sessionId).toBeNull();
    expect(turn.session?.reset).toBe(true);
    expect(turn.session?.resetReasons).toEqual(
      expect.arrayContaining(['configured model changed from "model-a" to "model-b"']),
    );
  });

  it("keeps resetting the session for an ordinary comment wake after the instructions changed", async () => {
    const seeded = await seedAgentWithSavedSession();
    await editInstructionsThroughBundleWrite(seeded.agentId);

    const heartbeat = heartbeatService(db);
    const next = await heartbeat.wakeup(seeded.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      requestedByActorType: "user",
      requestedByActorId: "responsible-user",
      payload: { issueId: seeded.issueId },
      contextSnapshot: {
        issueId: seeded.issueId,
        taskId: seeded.issueId,
        wakeReason: "issue_commented",
      },
    });
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const turn = await settledTurn(next!.id);

    expect(turn.run?.status).toBe("succeeded");
    expect(turn.adapterInput?.runtime.sessionId).toBeNull();
    expect(turn.session?.reset).toBe(true);
    expect(turn.session?.changedCategories).toEqual(
      expect.arrayContaining(["instructions"]),
    );
  });
});
