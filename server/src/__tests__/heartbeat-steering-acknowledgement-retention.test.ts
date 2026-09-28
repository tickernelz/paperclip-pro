import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { withRetainedSteeringAcknowledgements } from "../services/steering-acknowledgements.ts";
import { runningProcesses } from "../adapters/index.ts";

const adapterGate = vi.hoisted(() => ({
  started: null as null | ((runId: string) => void),
  release: new Map<string, () => void>(),
  result: { exitCode: 0 as number | null, errorMessage: null as string | null },
}));

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: async (ctx: { runId: string }) => {
        const started = adapterGate.started;
        if (started) {
          adapterGate.started = null;
          const { promise, resolve } = Promise.withResolvers<void>();
          adapterGate.release.set(ctx.runId, resolve);
          started(ctx.runId);
          await promise;
        }
        return {
          exitCode: adapterGate.result.exitCode,
          signal: null,
          timedOut: false,
          errorMessage: adapterGate.result.errorMessage,
          summary: "Steered turn finished.",
          provider: "test",
          model: "test-model",
          resultJson: { stopReason: "end_turn", toolCalls: 3 },
        };
      },
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

describeEmbeddedPostgres("steering acknowledgements survive run finalization", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-steer-ack-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function runToAcknowledgementThenFinish(result: { exitCode: number | null; errorMessage: string | null }) {
    adapterGate.result = result;
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `S${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Steered",
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
      title: "Steer me",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      responsibleUserId: "responsible-user",
    });
    const heartbeat = heartbeatService(db);
    const started = Promise.withResolvers<string>();
    adapterGate.started = started.resolve;
    await heartbeat.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, wakeReason: "issue_assigned" },
    });
    const runId = await started.promise;

    const acknowledgement = {
      status: "acknowledged",
      queueId: randomUUID(),
      turnId: "omp-rpc-turn:steered",
      acknowledgedAt: new Date().toISOString(),
    };
    const commentId = randomUUID();
    await db
      .update(heartbeatRuns)
      .set({
        resultJson: sql`coalesce(${heartbeatRuns.resultJson}, '{}'::jsonb) || ${JSON.stringify({
          queuedSteeringAcknowledgements: { [commentId]: acknowledgement },
        })}::jsonb`,
      })
      .where(eq(heartbeatRuns.id, runId));

    adapterGate.release.get(runId)!();
    await heartbeat.drainActiveRunExecutions();
    runningProcesses.clear();
    const [finished] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    return { finished, commentId, acknowledgement };
  }

  it("keeps the acknowledgement when a steered turn succeeds", async () => {
    const { finished, commentId, acknowledgement } = await runToAcknowledgementThenFinish({
      exitCode: 0,
      errorMessage: null,
    });
    expect(finished.status).toBe("succeeded");
    const result = finished.resultJson as Record<string, unknown>;
    expect(result.queuedSteeringAcknowledgements).toEqual({ [commentId]: acknowledgement });
    expect(result.toolCalls).toBe(3);
  }, 60_000);

  it("keeps the acknowledgement when a steered turn fails", async () => {
    const { finished, commentId, acknowledgement } = await runToAcknowledgementThenFinish({
      exitCode: 1,
      errorMessage: "provider exited",
    });
    expect(finished.status).toBe("failed");
    expect((finished.resultJson as Record<string, unknown>).queuedSteeringAcknowledgements).toEqual({
      [commentId]: acknowledgement,
    });
  }, 60_000);

  it("leaves the stored result alone when a patch carries resultJson: undefined", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `U${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Untouched",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const stored = { summary: "kept", queuedSteeringAcknowledgements: { c: { status: "acknowledged" } } };
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      resultJson: stored,
    });

    await db
      .update(heartbeatRuns)
      .set({ status: "running", ...withRetainedSteeringAcknowledgements({ resultJson: undefined, error: null }) })
      .where(eq(heartbeatRuns.id, runId));

    const [row] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(row.resultJson).toEqual(stored);
  });
});
