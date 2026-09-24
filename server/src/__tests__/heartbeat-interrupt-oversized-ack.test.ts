import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  adapterExecutionControls,
  createAdapterExecutionControl,
} from "../services/adapter-execution-control.js";
import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres interrupt acknowledgement tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("interrupt acknowledgement on oversized result json", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-interrupt-ack-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    adapterExecutionControls.clear();
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns the adapter acknowledgement when the stopped run's result json exceeds the safe projection budget", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      runtimeMode: "legacy",
      runtimeModeResolvedAt: new Date(),
      contextSnapshot: { issueId: randomUUID() },
    });

    const oversizedTranscript = Array.from({ length: 8_000 }, (_, index) =>
      `${index.toString(16).padStart(4, "0")}-${randomUUID()}`,
    ).join("|");

    const control = createAdapterExecutionControl();
    adapterExecutionControls.set(runId, control);
    control.controller.signal.addEventListener("abort", () => {
      void db
        .update(heartbeatRuns)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          resultJson: {
            summary: "stopped",
            transcript: oversizedTranscript,
            executionCancellation: {
              state: "acknowledged",
              acknowledgedAt: new Date().toISOString(),
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId))
        .then(() => control.finish());
    });

    const stopped = await heartbeatService(db).cancelRun(runId, "Interrupted by operator");

    expect(stopped?.status).toBe("cancelled");
    expect(
      (stopped?.resultJson as { executionCancellation?: { state?: string } } | null)
        ?.executionCancellation?.state,
    ).toBe("acknowledged");

    const persisted = await db
      .select({ resultJson: heartbeatRuns.resultJson })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0]);
    expect(
      (persisted?.resultJson as { executionCancellation?: { state?: string } } | null)
        ?.executionCancellation?.state,
    ).toBe("acknowledged");
  }, 30_000);
});
