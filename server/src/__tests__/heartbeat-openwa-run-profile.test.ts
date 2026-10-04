import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  chatConversations,
  chatEndpoints,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  toolApplications,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const TEST_ADAPTER_TYPE = "openwa_profile_capture";

async function waitForRunToFinish(heartbeat: ReturnType<typeof heartbeatService>, runId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await heartbeat.getRun(runId);
    if (run && !["queued", "running"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return heartbeat.getRun(runId);
}

describeEmbeddedPostgres("heartbeat OpenWA run profile at run start", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let paperclipHome: string | null = null;
  const previousHome = process.env.PAPERCLIP_HOME;
  const previousApiUrl = process.env.PAPERCLIP_API_URL;
  const captured = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-openwa-profile-");
    db = createDb(tempDb.connectionString);
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-openwa-profile-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";
    registerServerAdapter({
      type: TEST_ADAPTER_TYPE,
      execute: async (ctx) => {
        captured.set(ctx.runId, { ...ctx.context });
        return { exitCode: 0, signal: null, timedOut: false, label: "Captured context" };
      },
      testEnvironment: async () => ({ adapterType: TEST_ADAPTER_TYPE, status: "pass", checks: [], testedAt: new Date().toISOString() }),
    });
  }, 30_000);

  afterEach(() => {
    captured.clear();
  });

  afterAll(async () => {
    unregisterServerAdapter(TEST_ADAPTER_TYPE);
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousHome;
    if (previousApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = previousApiUrl;
    if (paperclipHome) await fs.rm(paperclipHome, { recursive: true, force: true });
    await tempDb?.cleanup();
  });

  async function seed(opts: { openwa: boolean }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const endpointId = randomUUID();
    const prefix = `O${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId, name: "OpenWA profile", issuePrefix: prefix, requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "board-user",
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Profile agent", role: "engineer", status: "idle",
      adapterType: TEST_ADAPTER_TYPE, adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await db.insert(issues).values({
      id: issueId, companyId, title: "Chat", status: "todo", assigneeAgentId: agentId, responsibleUserId: "board-user",
    });
    if (opts.openwa) {
      const applicationId = randomUUID();
      const connectionId = randomUUID();
      await db.insert(toolApplications).values({
        id: applicationId, companyId, applicationKey: `chat:openwa:${endpointId}`, name: "OpenWA", type: "chat", status: "active",
      });
      await db.insert(toolConnections).values({
        id: connectionId, companyId, applicationId, name: "OpenWA", uid: `chat-openwa-${endpointId}`,
        connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true,
      });
      await db.insert(chatEndpoints).values({
        id: endpointId, companyId, connectionId, provider: "openwa", publicId: randomUUID(), assignedAgentId: agentId, status: "active",
      });
      await db.insert(chatConversations).values({
        companyId, endpointId, issueId, externalConversationId: "openwa:session-1:628111@c.us",
        externalThreadId: "openwa:session-1:628111@c.us", externalLabel: "Member", state: "active",
      });
    }
    return { companyId, agentId, issueId, endpointId };
  }

  async function run(target: Awaited<ReturnType<typeof seed>>, actor: { type: "user" | "agent"; id: string }) {
    const heartbeat = heartbeatService(db);
    const queued = await heartbeat.wakeup(target.agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "openwa_profile_probe",
      payload: { issueId: target.issueId },
      requestedByActorType: actor.type,
      requestedByActorId: actor.id,
      contextSnapshot: { issueId: target.issueId, taskId: target.issueId, paperclipToolProfile: "full" },
    });
    expect(queued).not.toBeNull();
    const finished = await waitForRunToFinish(heartbeat, queued!.id);
    expect(finished?.status).toBe("succeeded");
    const [row] = await db.select({ contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(eq(heartbeatRuns.id, queued!.id));
    return { adapterContext: captured.get(queued!.id) ?? {}, persisted: row?.contextSnapshot ?? {} };
  }

  it("writes read_only for a non-owner run on an OpenWA conversation issue before the adapter runs", async () => {
    const target = await seed({ openwa: true });
    const { adapterContext, persisted } = await run(target, { type: "agent", id: target.agentId });
    expect(adapterContext.paperclipToolProfile).toBe("read_only");
    expect(adapterContext.paperclipOpenwa).toEqual({
      endpointId: target.endpointId, chatKey: "628111@c.us", triggerClass: "other", profile: "read_only",
      toolProfile: "read_only", event: null, grantIds: [], deliveryIds: [], grantedCategories: [], runAllowedCategories: [],
      requesterPrincipalId: null, approvalRequestId: null, triggerPrincipalId: null,
    });
    expect(persisted).toMatchObject({ paperclipToolProfile: "read_only", paperclipOpenwa: { profile: "read_only" } });
  });

  it("writes full for a board-user-requested run on an OpenWA conversation issue", async () => {
    const target = await seed({ openwa: true });
    const { adapterContext } = await run(target, { type: "user", id: "board-user" });
    expect(adapterContext.paperclipToolProfile).toBe("full");
    expect(adapterContext.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "full" });
  });

  it("leaves run contexts on non-OpenWA issues untouched", async () => {
    const target = await seed({ openwa: false });
    const { adapterContext } = await run(target, { type: "agent", id: target.agentId });
    expect(adapterContext.paperclipToolProfile).toBe("full");
    expect(adapterContext).not.toHaveProperty("paperclipOpenwa");
    expect(adapterContext.issueId).toBe(target.issueId);
  });
});
