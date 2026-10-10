import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  assets,
  authUsers,
  chatActions,
  chatDeliveries,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueAttachments,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { SPEECH_TO_TEXT_DEFAULTS } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { resolveChatRunPresentationAuthorizationReason } from "../../services/chat-run-publications.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { issueService } from "../../services/issues.js";
import { secretService } from "../../services/secrets.js";
import { applyOpenwaRunContext, resolveOpenwaRunContext } from "../../services/openwa/authority.js";
import { OPENWA_WAKE_CONTEXT_KEY, buildOpenwaRunGuidance, type OpenwaWakeEvent } from "../../services/openwa/guidance.js";
import type { OpenwaLateTranscriptEvent } from "../../services/openwa/late-transcripts.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "31111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000321";
const OWNER_PHONE = "628333000321";
const MEMBER_PHONE = "628666000321";
const GROUP = "120363000000000321@g.us";
const STT_ENV = "OPENWA_ROUND_TRIP_STT_KEY";
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 7)]);
const VOICE = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 3)]);

const jid = (phone: string) => phone + "@c.us";

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

class FakeSttServer {
  text = "tolong cek invoice nomor 42";
  hold: Promise<void> | null = null;
  calls = 0;
  private server: Server | null = null;

  get baseUrl(): string {
    return "http://127.0.0.1:" + (this.server!.address() as AddressInfo).port + "/v1";
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      for await (const _chunk of req);
      this.calls++;
      if (this.hold) await this.hold;
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: this.text }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

type WakeupOptions = Parameters<ChatChannelServiceOptions["heartbeat"]["wakeup"]>[1];

describe.sequential("OpenWA round trip (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  let stt: FakeSttServer;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-round-trip-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-round-trip-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(scratch, "master.key");
    process.env[STT_ENV] = "sk-round-trip-stt";
    stt = new FakeSttServer();
    await stt.start();
  }, 60_000);
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    await instanceSettingsService(db).updateGeneral({ speechToText: { ...SPEECH_TO_TEXT_DEFAULTS } });
    stt.hold = null;
    stt.calls = 0;
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await stt?.close();
    await database?.cleanup();
    delete process.env[STT_ENV];
    if (scratch) await rm(scratch, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function setup() {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA round trip",
      issuePrefix: "R" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenWA Agent",
      role: "engineer",
      status: "idle",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    const wakes = new Map<string, WakeupOptions>();
    const wakeup = vi.fn<ChatChannelServiceOptions["heartbeat"]["wakeup"]>(async (wakeAgentId, opts) => {
      const request = opts.durableChatRequest;
      if (!request) return { accepted: true } as never;
      await db.transaction(async (tx) => {
        await request.authorize(tx as unknown as Parameters<typeof request.authorize>[0]);
        await tx
          .insert(agentWakeupRequests)
          .values({
            id: request.id,
            companyId: request.companyId,
            agentId: wakeAgentId,
            source: opts.source ?? "assignment",
            triggerDetail: opts.triggerDetail,
            reason: opts.reason,
            payload: opts.payload,
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: request.idempotencyKey,
            requestedAt: request.requestedAt,
            status: "queued",
          })
          .onConflictDoNothing();
      });
      wakes.set(request.id, opts);
      return { accepted: true } as never;
    });
    const lateTranscripts: OpenwaLateTranscriptEvent[] = [];
    const runtime = new ChatSdkRuntime();
    const service = chatChannelService(db, {
      runtime,
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup } as never,
      storage: createStorageService(createLocalDiskStorageProvider(path.join(scratch, "storage"))),
      scheduleDeferredWork: () => {},
      onOpenwaLateTranscript: (event) => {
        lateTranscripts.push(event);
      },
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
      openwaBurstWindowMs: 0,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const secret = await secretService(db).create(
      companyId,
      { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value: FAKE_OPENWA_KEY },
      { userId },
    );
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    await db
      .update(toolConnections)
      .set({
        status: "active",
        enabled: true,
        credentialSecretRefs: [
          { secretId: secret.id, versionSelector: "latest", configPath: "credentials.apiKey", required: true, label: "apiKey", projectionClass: "unclassified" },
        ],
      })
      .where(eq(toolConnections.id, row!.connectionId));
    await db.insert(companySecretBindings).values({
      companyId,
      secretId: secret.id,
      targetType: "tool_connection",
      targetId: row!.connectionId,
      configPath: "credentials.apiKey",
      versionSelector: "latest",
      required: true,
      label: "apiKey",
      projectionClass: "unclassified",
    });
    await db
      .update(chatEndpoints)
      .set({
        status: "active",
        providerAccountId: gateway.baseUrl + "#" + SESSION_ID,
        botExternalId: OWN_PHONE,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    const added = await service.openwa.addOwner(endpoint.id, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await service.confirmIdentityLink(token, userId);
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, wakes, lateTranscripts };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function goLive(t: Setup) {
    expect((await t.service.reconcileProviderRuntimes()).local).toBe(1);
    await t.gateway.waitForSubscription();
  }

  async function deliveries(t: Setup) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.createdAt));
  }

  async function admitted(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const before = (await deliveries(t)).length;
    const row = t.gateway.inbound(input);
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await deliveries(t);
      return rows.length > before && rows.every((entry) => entry.state === "processed" || entry.state === "filtered");
    }, 30_000);
    const delivery = (await deliveries(t)).at(-1)!;
    expect(delivery.state).toBe("processed");
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    await until(() => t.wakes.has(action!.id));
    const [request] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action!.id));
    return { row, delivery, request: request!, wake: t.wakes.get(action!.id)! };
  }

  async function runStart(t: Setup, wake: Awaited<ReturnType<typeof admitted>>) {
    const runId = randomUUID();
    const issueId = String(wake.wake.contextSnapshot!.issueId);
    const contextSnapshot: Record<string, unknown> = {
      ...wake.wake.contextSnapshot,
      paperclipOpenwa: { triggerClass: (wake.request.payload as { openwa: { triggerClass: string } }).openwa.triggerClass },
    };
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      wakeupRequestId: wake.request.id,
      startedAt: new Date(),
      contextSnapshot,
    });
    const resolveInput = { companyId: t.companyId, issueId, contextSnapshot, wakeupRequestId: wake.request.id, runId };
    const openwa = await resolveOpenwaRunContext(db, resolveInput);
    expect(openwa).not.toBeNull();
    applyOpenwaRunContext(contextSnapshot, openwa);
    const guidance = await buildOpenwaRunGuidance(db, {
      companyId: t.companyId,
      issueId,
      runId,
      wakeupRequestId: wake.request.id,
      openwa: openwa!,
      contextSnapshot,
    });
    expect(guidance).not.toBeNull();
    contextSnapshot[OPENWA_WAKE_CONTEXT_KEY] = guidance!.wakeEvent;
    await db.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, runId));
    return { runId, issueId, wakeEvent: guidance!.wakeEvent as OpenwaWakeEvent, markdown: guidance!.markdown };
  }

  async function finalComment(t: Setup, run: { runId: string; issueId: string }, body: string) {
    const authorizationReason = await resolveChatRunPresentationAuthorizationReason(db, { companyId: t.companyId, issueId: run.issueId, runId: run.runId });
    await issueService(db).addComment(run.issueId, body, { agentId: t.agentId, runId: run.runId }, { authorizationReason });
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, run.runId));
    await t.service.processPendingPublications(25);
  }

  async function attachmentsOfIssue(issueId: string) {
    return db
      .select({ id: issueAttachments.id, commentId: issueAttachments.issueCommentId, contentType: assets.contentType, byteSize: assets.byteSize })
      .from(issueAttachments)
      .innerJoin(assets, eq(assets.id, issueAttachments.assetId))
      .where(eq(issueAttachments.issueId, issueId));
  }

  it("answers an owner DM end to end without quoting and marks the trigger answered", async () => {
    const t = await setup();
    await goLive(t);
    const wake = await admitted(t, { chatId: jid(OWNER_PHONE), body: "tolong cek status deploy" });
    expect(wake.delivery).toMatchObject({ triggerClass: "owner", principalRole: "owner", answerState: "pending" });
    expect(wake.request.payload).toMatchObject({ openwa: { event: "message", triggerClass: "owner", deliveryIds: [wake.delivery.id] } });

    const run = await runStart(t, wake);
    expect(run.wakeEvent).toMatchObject({ event: "message", triggerClass: "owner", profile: "full", chat: { type: "dm" } });
    expect(run.wakeEvent.messages).toEqual([
      expect.objectContaining({ id: wake.row.waMessageId, triggerId: wake.delivery.id, text: "tolong cek status deploy", media: [], location: null, contact: null }),
    ]);
    expect(run.markdown).toContain("WhatsApp (OpenWA) guidance");

    await finalComment(t, run, "Deploy **sudah selesai**, semua _hijau_.");
    expect(t.gateway.sends).toEqual([
      expect.objectContaining({ chatId: jid(OWNER_PHONE), text: "Deploy *sudah selesai*, semua _hijau_." }),
    ]);
    expect(t.gateway.sends[0]).not.toHaveProperty("quotedMessageId");
    const [settled] = await db.select().from(chatDeliveries).where(eq(chatDeliveries.id, wake.delivery.id));
    expect(settled!.answerState).toBe("answered");
  }, 120_000);

  it("quotes the trigger when replying to a group mention", async () => {
    const t = await setup();
    t.gateway.groups.set(GROUP, {
      id: GROUP,
      name: "Ops",
      participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }],
    });
    await goLive(t);
    const wake = await admitted(t, {
      chatId: GROUP,
      author: jid(OWNER_PHONE),
      body: "@" + OWN_PHONE + " berapa error hari ini?",
      extra: { mentionedIds: [jid(OWN_PHONE)] },
    });
    expect(wake.delivery.triggerClass).toBe("owner");
    const run = await runStart(t, wake);
    expect(run.wakeEvent.chat).toMatchObject({ type: "group", name: "Ops" });

    await finalComment(t, run, "Ada 3 error, semuanya timeout.");
    expect(t.gateway.sends).toEqual([
      expect.objectContaining({ chatId: GROUP, quotedMessageId: wake.row.waMessageId, text: "Ada 3 error, semuanya timeout." }),
    ]);
  }, 120_000);

  it("stores a DM image on the inbound comment before the wake and exposes it in the wake payload", async () => {
    const t = await setup();
    await goLive(t);
    const waMessageId = t.gateway.nextWaMessageId(false, jid(OWNER_PHONE));
    t.gateway.setMedia(jid(OWNER_PHONE), waMessageId, { body: PNG, contentType: "image/png" });
    const wake = await admitted(t, {
      chatId: jid(OWNER_PHONE),
      waMessageId,
      body: "",
      extra: { type: "image", media: { mimetype: "image/png", sizeBytes: PNG.length, omitted: true } },
    });
    const issueId = String(wake.wake.contextSnapshot!.issueId);
    const stored = await attachmentsOfIssue(issueId);
    expect(stored).toEqual([expect.objectContaining({ commentId: wake.wake.contextSnapshot!.wakeCommentId, contentType: "image/png", byteSize: PNG.length })]);
    expect(t.gateway.mediaRequests(waMessageId)).toBe(1);

    const run = await runStart(t, wake);
    expect(run.wakeEvent.messages[0]!.media).toEqual([{ kind: "image", attachmentId: stored[0]!.id, filename: expect.stringMatching(/^image-[0-9a-f]{10}\.png$/), mime: "image/png", size: PNG.length }]);
  }, 120_000);

  it("carries a voice note transcript from the fake speech-to-text service into the wake payload", async () => {
    const t = await setup();
    await instanceSettingsService(db).updateGeneral({
      speechToText: { enabled: true, baseUrl: stt.baseUrl, model: "whisper-test", apiKeyEnvVar: STT_ENV, maxAudioSeconds: 600, sttWaitSeconds: 5 },
    });
    await goLive(t);
    const waMessageId = t.gateway.nextWaMessageId(false, jid(OWNER_PHONE));
    t.gateway.setMedia(jid(OWNER_PHONE), waMessageId, { body: VOICE, contentType: "audio/ogg" });
    const wake = await admitted(t, {
      chatId: jid(OWNER_PHONE),
      waMessageId,
      body: "",
      extra: { type: "ptt", media: { mimetype: "audio/ogg; codecs=opus", sizeBytes: VOICE.length, omitted: true } },
    });
    expect(stt.calls).toBe(1);
    const run = await runStart(t, wake);
    expect(run.wakeEvent.messages[0]!.media).toEqual([
      expect.objectContaining({ kind: "voice", mime: "audio/ogg", transcript: "tolong cek invoice nomor 42" }),
    ]);
    expect(run.markdown).toContain("tolong cek invoice nomor 42");
  }, 120_000);

  it("records a transcript that lands after the wake for the active run and carries it in the next wake", async () => {
    const t = await setup();
    await instanceSettingsService(db).updateGeneral({
      speechToText: { enabled: true, baseUrl: stt.baseUrl, model: "whisper-test", apiKeyEnvVar: STT_ENV, maxAudioSeconds: 600, sttWaitSeconds: 1 },
    });
    let release!: () => void;
    stt.hold = new Promise<void>((resolve) => (release = resolve));
    stt.text = "transkrip terlambat";
    await goLive(t);
    const waMessageId = t.gateway.nextWaMessageId(false, jid(OWNER_PHONE));
    t.gateway.setMedia(jid(OWNER_PHONE), waMessageId, { body: VOICE, contentType: "audio/ogg" });
    const voice = await admitted(t, {
      chatId: jid(OWNER_PHONE),
      waMessageId,
      body: "",
      extra: { type: "ptt", media: { mimetype: "audio/ogg", sizeBytes: VOICE.length, omitted: true } },
    });
    const first = await runStart(t, voice);
    expect(first.wakeEvent.messages[0]!.media).toEqual([expect.objectContaining({ kind: "voice", transcriptPending: true })]);

    release();
    await until(() => t.lateTranscripts.length === 1);
    expect(t.lateTranscripts[0]).toMatchObject({
      runId: first.runId,
      issueId: first.issueId,
      transcript: { waMessageId, transcriptStatus: "done", transcript: "transkrip terlambat", activeRunId: first.runId },
    });
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, first.runId));

    const next = await admitted(t, { chatId: jid(OWNER_PHONE), body: "sudah dengar pesan suaraku?" });
    const second = await runStart(t, next);
    expect(second.wakeEvent.messages.map((message) => message.text)).toEqual(["sudah dengar pesan suaraku?"]);
    expect(second.wakeEvent.lateTranscripts).toEqual([
      { messageId: waMessageId, attachmentId: expect.any(String), transcript: "transkrip terlambat" },
    ]);
    const third = await buildOpenwaRunGuidance(db, {
      companyId: t.companyId,
      issueId: second.issueId,
      runId: randomUUID(),
      wakeupRequestId: next.request.id,
      openwa: (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, second.runId)))[0]!.contextSnapshot!.paperclipOpenwa as never,
      contextSnapshot: {},
    });
    expect(third!.wakeEvent.lateTranscripts).toBeUndefined();
  }, 120_000);

  it("ignores a late transcript when no run of the conversation is active", async () => {
    const t = await setup();
    await instanceSettingsService(db).updateGeneral({
      speechToText: { enabled: true, baseUrl: stt.baseUrl, model: "whisper-test", apiKeyEnvVar: STT_ENV, maxAudioSeconds: 600, sttWaitSeconds: 1 },
    });
    let release!: () => void;
    stt.hold = new Promise<void>((resolve) => (release = resolve));
    await goLive(t);
    const waMessageId = t.gateway.nextWaMessageId(false, jid(OWNER_PHONE));
    t.gateway.setMedia(jid(OWNER_PHONE), waMessageId, { body: VOICE, contentType: "audio/ogg" });
    const voice = await admitted(t, {
      chatId: jid(OWNER_PHONE),
      waMessageId,
      body: "",
      extra: { type: "ptt", media: { mimetype: "audio/ogg", sizeBytes: VOICE.length, omitted: true } },
    });
    release();
    const issueId = String(voice.wake.contextSnapshot!.issueId);
    await until(async () => {
      const [record] = await db
        .select({ payload: chatActions.payload })
        .from(chatActions)
        .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.providerActionId, "openwa_media:" + waMessageId)));
      return (record?.payload as { items?: Array<{ transcriptStatus?: string }> } | undefined)?.items?.[0]?.transcriptStatus === "done";
    });
    await t.service.shutdown();
    services.splice(services.indexOf(t.service), 1);
    expect(t.lateTranscripts).toEqual([]);
    const stored = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, "openwa_late_transcripts")));
    expect(stored).toEqual([]);
    expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, t.companyId))).toEqual([]);
    expect(issueId).toMatch(/^[0-9a-f-]{36}$/);
  }, 120_000);
});
