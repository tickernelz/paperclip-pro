import { AsyncLocalStorage } from "node:async_hooks";
import { Session } from "node:inspector/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatDeliveries,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { registerServerAdapter } from "../../adapters/registry.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { secretService } from "../../services/secrets.js";
import { OpenwaChatAdapter } from "../../services/openwa/adapter.js";
import { createOpenwaGatewayClient, type OpenwaGatewayClient } from "../../services/openwa/gateway.js";
import {
  normalizeOpenwaInbound,
  openwaDedupeKey,
  OpenwaReceiver,
  type OpenwaEventSocket,
  type OpenwaIngressEvent,
} from "../../services/openwa/receiver.js";
import { activeOpenwaScheduledWakes } from "../../services/openwa/scheduled-wakes.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "61111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000111";
const OWNER_PHONE = "628333000333";
const ALLOWED_PHONES = ["628444000441", "628444000442", "628444000443", "628444000444"];
const MEMBER_PHONE = "628666000666";
const STRANGER_PHONE = "628777000777";
const OWNER_LID = "190000000000001@lid";
const ACTIVE_GROUP = "120363000000000101@g.us";
const INACTIVE_GROUP = "120363000000000102@g.us";
const TELEGRAM_HOST = "api.telegram.org";
const TELEGRAM_BOT_ID = 887799;
const TELEGRAM_USER_ID = 417200777;
const BENCH_ADAPTER = "openwa_bench";
const TOKEN_PATTERN = /bench#(\d+)/;
const MiB = 1024 * 1024;
const RECONCILE_INTERVAL_MS = 1_000;
const SWEEP_RESCUE_MS = 500;

const jid = (phone: string) => phone + "@c.us";
const clock = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface BenchOptions {
  negativeControl: boolean;
  heapSampling: boolean;
  latencyMs: number;
  s0Samples: number;
  s0bSamples: number;
  s1Samples: number;
  s4Samples: number;
  s5Samples: number;
  burstSeconds: number;
  burstWarmupSeconds: number;
  burstRate: number;
  triggerEvery: number;
  killAtSeconds: number;
  killForSeconds: number;
  runMs: number;
  skip: Set<string>;
  out: string | null;
}

interface EventScope {
  id: string;
  source: "live" | "catch_up";
  arrival: number;
  queries: number;
  sql: string[];
  decided: number | null;
  outcome: string | null;
}

interface TxScope {
  tokens: Set<number>;
  deliveryTokens: Set<number>;
}

interface Summary {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

interface BudgetRow {
  seam: string;
  metric: string;
  value: number | string | null;
  budget: string;
  status: "pass" | "fail" | "not available";
  evidence?: string;
}

interface QueryWindow {
  queries: number;
  maxGapMs: number;
  gapStartMs: number;
  lastSqlBefore: string | null;
  firstSqlAfter: string | null;
}

function parseOptions(argv: string[]): BenchOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=", 2) as [string, string | undefined];
    if (value === undefined) flags.add(key);
    else values.set(key, value);
  }
  const number = (key: string, fallback: number) => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("--" + key + " needs a non-negative number");
    return parsed;
  };
  return {
    negativeControl: flags.has("negative-control"),
    heapSampling: flags.has("heap-sampling"),
    latencyMs: number("latency-ms", 20),
    s0Samples: number("s0-samples", 1000),
    s0bSamples: number("s0b-samples", 200),
    s1Samples: number("s1-samples", 60),
    s4Samples: number("s4-samples", 20),
    s5Samples: number("s5-samples", 40),
    burstSeconds: number("burst-seconds", 60),
    burstWarmupSeconds: number("burst-warmup-seconds", 15),
    burstRate: number("burst-rate", 50),
    triggerEvery: number("trigger-every", 10),
    killAtSeconds: number("kill-at-seconds", 30),
    killForSeconds: number("kill-for-seconds", 10),
    runMs: number("run-ms", 5000),
    skip: new Set((values.get("skip") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)),
    out: values.get("out") ?? null,
  };
}

function summarize(values: number[]): Summary {
  if (!values.length) return { n: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    n: sorted.length,
    p50: round(rank(50)),
    p95: round(rank(95)),
    p99: round(rank(99)),
    max: round(sorted[sorted.length - 1]!),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs: number, label: string, pollMs = 2): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + label);
    await sleep(pollMs);
  }
}

function collectGarbage(): () => void {
  const gc = vm.runInNewContext("gc") as (() => void) | undefined;
  return typeof gc === "function" ? gc : () => undefined;
}

function frameMessageId(frame: unknown): string | null {
  if (!frame || typeof frame !== "object") return null;
  const value = frame as { type?: unknown; payload?: { event?: unknown; data?: { id?: unknown } } };
  if (value.type !== "event") return null;
  const event = value.payload?.event;
  if (event !== "message.received" && event !== "message.sent") return null;
  return typeof value.payload?.data?.id === "string" ? value.payload.data.id : null;
}

function classifiedRole(param: string): string | null {
  try {
    const value = JSON.parse(param) as { openwa?: { principalRole?: unknown } };
    return typeof value.openwa?.principalRole === "string" ? value.openwa.principalRole : null;
  } catch {
    return null;
  }
}

class Instrumentation {
  readonly events = new AsyncLocalStorage<EventScope>();
  readonly transactions = new AsyncLocalStorage<TxScope>();
  readonly scopes = new Map<string, EventScope>();
  readonly admits = new Map<string, number>();
  readonly commits = new Map<number, number>();
  readonly deliveryCommits = new Map<number, number>();
  readonly classifiedRoles = new Map<number, string | null>();
  readonly wakes: Array<{ at: number; commentId: string | null }> = [];
  readonly queryTimes = new Float64Array(1 << 20);
  readonly querySql: string[] = new Array(1 << 14).fill("");
  readonly queryScope: Array<string | null> = new Array(1 << 14).fill(null);
  readonly stalls: Array<{ at: number; ms: number }> = [];
  openTransactions = 0;
  readonly txWaits: Array<{ at: number; ms: number; open: number }> = [];
  totalQueries = 0;
  private stallTimer: ReturnType<typeof setInterval> | null = null;

  watchStalls(): void {
    let last = clock();
    this.stallTimer = setInterval(() => {
      const now = clock();
      if (now - last > 25 && this.stalls.length < 10_000) this.stalls.push({ at: last, ms: Math.round(now - last - 5) });
      last = now;
    }, 5);
    this.stallTimer.unref?.();
  }

  stopStalls(): void {
    if (this.stallTimer) clearInterval(this.stallTimer);
  }

  stallsIn(from: number, to: number): Array<{ atMs: number; ms: number }> {
    return this.stalls.filter((stall) => stall.at + stall.ms >= from && stall.at <= to).map((stall) => ({ atMs: Math.round(stall.at - from), ms: stall.ms }));
  }

  waitsIn(from: number, to: number): Array<{ atMs: number; ms: number; open: number }> {
    return this.txWaits.filter((wait) => wait.at + wait.ms >= from && wait.at <= to && wait.ms > 5).map((wait) => ({ atMs: Math.round(wait.at - from), ms: Math.round(wait.ms), open: wait.open }));
  }

  scope(id: string, source: EventScope["source"]): EventScope {
    const existing = this.scopes.get(id);
    if (existing) return existing;
    const scope: EventScope = { id, source, arrival: clock(), queries: 0, sql: [], decided: null, outcome: null };
    this.scopes.set(id, scope);
    return scope;
  }

  trace(from: number, to: number, scopeId: string): string[] {
    const size = this.queryTimes.length;
    const lines: string[] = [];
    for (let index = Math.max(0, this.totalQueries - this.querySql.length); index < this.totalQueries; index++) {
      const at = this.queryTimes[index % size]!;
      if (at < from || at > to) continue;
      const own = this.queryScope[index % this.queryScope.length] === scopeId ? "* " : "  ";
      lines.push(own + (Math.round((at - from) * 10) / 10).toFixed(1) + " " + (this.querySql[index % this.querySql.length] ?? ""));
    }
    return lines;
  }

  window(from: number, to: number): QueryWindow {
    const size = this.queryTimes.length;
    const sqlAt = (index: number) =>
      index >= 0 && this.totalQueries - index <= this.querySql.length ? (this.querySql[index % this.querySql.length] ?? null) : null;
    let count = 0;
    let previous = from;
    let previousIndex = -1;
    let result: QueryWindow = { queries: 0, maxGapMs: 0, gapStartMs: 0, lastSqlBefore: null, firstSqlAfter: null };
    const consider = (at: number, nextSql: string | null) => {
      if (at - previous <= result.maxGapMs) return;
      result = {
        queries: 0,
        maxGapMs: Math.round((at - previous) * 1000) / 1000,
        gapStartMs: Math.round((previous - from) * 1000) / 1000,
        lastSqlBefore: previousIndex >= 0 ? sqlAt(previousIndex) : "window start",
        firstSqlAfter: nextSql,
      };
    };
    for (let index = Math.max(0, this.totalQueries - size); index < this.totalQueries; index++) {
      const at = this.queryTimes[index % size]!;
      if (at < from || at > to) continue;
      count++;
      consider(at, sqlAt(index));
      previous = at;
      previousIndex = index;
    }
    consider(to, "window end");
    return { ...result, queries: count };
  }

  attach(db: Db): void {
    const logger = {
      logQuery: (query: string, params: unknown[]) => {
        this.queryTimes[this.totalQueries % this.queryTimes.length] = clock();
        this.querySql[this.totalQueries % this.querySql.length] = query.slice(0, 140);
        const event = this.events.getStore();
        this.queryScope[this.totalQueries % this.queryScope.length] = event?.id ?? null;
        this.totalQueries++;
        if (event && event.decided === null) {
          event.queries++;
          if (event.sql.length < 8) event.sql.push(query.slice(0, 160));
        }
        const tx = this.transactions.getStore();
        if (!tx) return;
        const comment = query.startsWith('insert into "issue_comments"');
        const delivery = query.startsWith('insert into "chat_deliveries"');
        if (!comment && !delivery) return;
        for (const param of params) {
          const match = typeof param === "string" ? TOKEN_PATTERN.exec(param) : null;
          if (!match) continue;
          const token = Number(match[1]);
          if (comment) tx.tokens.add(token);
          else {
            tx.deliveryTokens.add(token);
            if (!this.classifiedRoles.has(token)) this.classifiedRoles.set(token, classifiedRole(param as string));
          }
        }
      },
    };
    const session = (db as unknown as { session: { logger: unknown; options: { logger?: unknown } } }).session;
    session.logger = logger;
    session.options.logger = logger;
    const transaction = db.transaction.bind(db);
    (db as { transaction: unknown }).transaction = ((fn: Parameters<Db["transaction"]>[0], config?: Parameters<Db["transaction"]>[1]) => {
      const scope: TxScope = { tokens: new Set(), deliveryTokens: new Set() };
      const requested = clock();
      const open = this.openTransactions++;
      let entered = false;
      const body = ((tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => {
        if (!entered) {
          entered = true;
          if (this.txWaits.length < 50_000) this.txWaits.push({ at: requested, ms: clock() - requested, open });
        }
        return fn(tx);
      }) as Parameters<Db["transaction"]>[0];
      return this.transactions.run(scope, () => transaction(body, config)).finally(() => {
        this.openTransactions--;
      }).then((result) => {
        const at = clock();
        for (const token of scope.tokens) if (!this.commits.has(token)) this.commits.set(token, at);
        for (const token of scope.deliveryTokens) if (!this.deliveryCommits.has(token)) this.deliveryCommits.set(token, at);
        return result;
      });
    }) as Db["transaction"];
  }

  instrumentStats(stats: object): void {
    const target = stats as Record<string, number>;
    for (const key of ["discarded", "ownerActivity", "filtered", "admitted"]) {
      let value = target[key] ?? 0;
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: (next: number) => {
          value = next;
          const event = this.events.getStore();
          if (event && event.decided === null) {
            event.decided = clock();
            event.outcome = key;
          }
        },
      });
    }
  }

  patchSocketAndReceiver(): void {
    const events = this.events;
    const createEventSocket = OpenwaChatAdapter.prototype.createEventSocket;
    const instrumentation = this;
    OpenwaChatAdapter.prototype.createEventSocket = function (this: OpenwaChatAdapter): OpenwaEventSocket {
      const socket = createEventSocket.call(this);
      const open = socket.open.bind(socket);
      socket.open = (handlers) =>
        open({
          ...handlers,
          frame: (frame) => {
            const id = frameMessageId(frame);
            if (!id) return handlers.frame(frame);
            return events.run(instrumentation.scope(id, "live"), () => handlers.frame(frame));
          },
        });
      return socket;
    };
    const start = OpenwaReceiver.prototype.start;
    OpenwaReceiver.prototype.start = function (this: OpenwaReceiver) {
      const options = (this as unknown as { options: { admit(event: OpenwaIngressEvent, key: string | null): Promise<void> } }).options;
      const admit = options.admit.bind(options);
      options.admit = (event, key) => {
        const id = typeof event.data.id === "string" ? event.data.id : null;
        if (!id) return admit(event, key);
        instrumentation.admits.set(id, (instrumentation.admits.get(id) ?? 0) + 1);
        if (events.getStore()?.id === id) return admit(event, key);
        return events.run(instrumentation.scope(id, event.source), () => admit(event, key));
      };
      start.call(this);
    };
  }
}

export async function runOpenwaIngestBenchmark(input: { argv: string[]; root: string; scratch: string }): Promise<number> {
  const options = parseOptions(input.argv);
  const gc = collectGarbage();
  const startedAt = new Date().toISOString();
  const runDir = await mkdtemp(path.join(input.scratch, "run-"));
  process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(runDir, "master.key");
  const instrumentation = new Instrumentation();
  instrumentation.patchSocketAndReceiver();
  registerServerAdapter({
    type: BENCH_ADAPTER,
    supportsLocalAgentJwt: true,
    execute: async () => {
      await sleep(options.runMs);
      return { exitCode: 0, signal: null, timedOut: false, errorMessage: null, summary: "", provider: "bench", model: "bench" };
    },
    testEnvironment: async () => ({ adapterType: BENCH_ADAPTER, status: "pass", checks: [], testedAt: new Date().toISOString() }),
  });

  const database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-bench-");
  const db = createDb(database.connectionString);
  instrumentation.attach(db);
  instrumentation.watchStalls();
  const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE, restLatencyMs: options.latencyMs });
  await gateway.start();
  const realFetch = globalThis.fetch;
  const telegram = { secret: "", nextMessageId: 9_000 };
  const benchFetch = (async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    if (url.hostname !== TELEGRAM_HOST) return realFetch(resource, init);
    const method = url.pathname.split("/").at(-1) ?? "";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body || "{}") as Record<string, unknown>) : {};
    const ok = (result: unknown) => Response.json({ ok: true, result });
    if (method === "getMe") return ok({ id: TELEGRAM_BOT_ID, is_bot: true, first_name: "Bench", username: "paperclip_bench_bot" });
    if (method === "getWebhookInfo") return ok({ url: "" });
    if (method === "setWebhook") {
      telegram.secret = String(body.secret_token ?? "");
      return ok(true);
    }
    if (method === "sendMessage")
      return ok({
        message_id: ++telegram.nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(body.chat_id), type: "private", first_name: "Bench User" },
        text: body.text,
      });
    return ok(true);
  }) as typeof globalThis.fetch;
  globalThis.fetch = benchFetch;

  const heartbeat = heartbeatService(db);
  const wakeup: ChatChannelServiceOptions["heartbeat"]["wakeup"] = async (agentId, opts) => {
    const request = (opts as { durableChatRequest?: { commentId?: string } }).durableChatRequest;
    instrumentation.wakes.push({ at: clock(), commentId: request?.commentId ?? null });
    return heartbeat.wakeup(agentId, opts as Parameters<typeof heartbeat.wakeup>[1]);
  };
  const storage = createStorageService(createLocalDiskStorageProvider(path.join(runDir, "storage")));
  const runtime = new ChatSdkRuntime();
  const service = chatChannelService(db, {
    runtime,
    fetch: benchFetch,
    storage,
    publicBaseUrl: "https://paperclip.example",
    heartbeat: { wakeup },
    discordGatewayLeaseTtlMs: 120_000,
    discordGatewayLeaseRenewalIntervalMs: 60_000,
    discordGatewayLeaseWaitMs: 200,
    openwaBurstWindowMs: 0,
  });
  instrumentation.instrumentStats(service.openwaAdmissionStats);

  const lanes = new Map<string, Promise<unknown>>();
  const lane = (name: string, task: () => Promise<unknown>) => {
    if (lanes.has(name)) return;
    const pending = task()
      .catch(() => undefined)
      .finally(() => lanes.delete(name));
    lanes.set(name, pending);
  };
  const reconcileTimer = setInterval(() => {
    lane("provider runtimes", () => service.reconcileProviderRuntimes());
    lane("deliveries", () => service.processPendingDeliveries());
  }, RECONCILE_INTERVAL_MS);
  const results: Record<string, unknown> = {};
  const budgets: BudgetRow[] = [];
  let exitCode = 0;
  let tokenCounter = 0;
  const nextToken = () => ++tokenCounter;

  try {
    const fixture = await seed(db, service, gateway);
    if (options.negativeControl) {
      const peek = service.openwaPolicies.peek.bind(service.openwaPolicies);
      service.openwaPolicies.peek = (endpointId: string) => {
        void db
          .select({ id: chatEndpoints.id })
          .from(chatEndpoints)
          .where(and(eq(chatEndpoints.companyId, fixture.companyId), eq(chatEndpoints.id, endpointId)))
          .then(
            () => undefined,
            () => undefined,
          );
        return peek(endpointId);
      };
    }
    await service.reconcileProviderRuntimes();
    await gateway.waitForSubscription();

    const emit = (message: Parameters<FakeOpenwaGateway["inbound"]>[0]) => gateway.inbound(message);
    const decided = (id: string) => () => instrumentation.scopes.get(id)?.decided != null;
    const warm = async (message: Parameters<FakeOpenwaGateway["inbound"]>[0]) => {
      const row = emit(message);
      await until(decided(row.waMessageId!), 20_000, "warm-up classification");
    };
    await warm({ chatId: ACTIVE_GROUP, author: jid(MEMBER_PHONE), body: "warm up" });
    await until(() => service.openwaAdmissionStats.discoveries >= 1, 20_000, "active group discovery");
    await warm({ chatId: INACTIVE_GROUP, author: jid(MEMBER_PHONE), body: "warm up" });
    await until(() => service.openwaAdmissionStats.discoveries >= 2, 20_000, "inactive group discovery");
    await warm({ chatId: ACTIVE_GROUP, author: jid(MEMBER_PHONE), body: "warm up again" });

    if (!options.skip.has("s0")) {
      const latencies: number[] = [];
      const queryCounts: number[] = [];
      const offenders: string[] = [];
      for (let index = 0; index < options.s0Samples; index++) {
        const row = emit({ chatId: index % 4 === 3 ? INACTIVE_GROUP : ACTIVE_GROUP, author: jid(index % 2 ? MEMBER_PHONE : STRANGER_PHONE), body: "chatter " + index });
        await until(decided(row.waMessageId!), 10_000, "S0 discard");
        const scope = instrumentation.scopes.get(row.waMessageId!)!;
        if (scope.outcome !== "discarded") throw new Error("S0 sample was not discarded: " + scope.outcome);
        latencies.push(scope.decided! - scope.arrival);
        queryCounts.push(scope.queries);
        if (scope.queries && offenders.length < 5) offenders.push(...scope.sql);
      }
      const latency = summarize(latencies);
      const queries = { max: Math.max(...queryCounts), total: queryCounts.reduce((sum, value) => sum + value, 0), eventsWithQueries: queryCounts.filter(Boolean).length };
      results.s0 = { boundary: "client socket frame received -> admission stats.discarded++", latencyMs: latency, queries, offendingSql: offenders };
      budgets.push(
        { seam: "S0 non-trigger", metric: "p99 ms", value: latency.p99, budget: "< 1", status: latency.p99 !== null && latency.p99 < 1 ? "pass" : "fail" },
        {
          seam: "S0 non-trigger",
          metric: "DB queries per event (max)",
          value: queries.max,
          budget: "0",
          status: queries.max === 0 ? "pass" : "fail",
          ...(offenders.length ? { evidence: offenders[0] } : {}),
        },
      );
    }

    if (!options.skip.has("s0b")) {
      const latencies: number[] = [];
      const queryCounts: number[] = [];
      const lookupsBefore = service.openwaAdmissionStats.quoteLookups;
      for (let index = 0; index < options.s0bSamples; index++) {
        const quotedId = "true_" + ACTIVE_GROUP + "_3EB0" + randomBytes(8).toString("hex").toUpperCase();
        const row = emit({
          chatId: ACTIVE_GROUP,
          author: jid(MEMBER_PHONE),
          body: "replying to an old message " + index,
          extra: { quotedMessage: { id: quotedId, body: "old agent message" } },
        });
        await until(decided(row.waMessageId!), 10_000, "S0b discard");
        const scope = instrumentation.scopes.get(row.waMessageId!)!;
        latencies.push(scope.decided! - scope.arrival);
        queryCounts.push(scope.queries);
      }
      const latency = summarize(latencies);
      const maxQueries = Math.max(...queryCounts);
      const wakes = activeOpenwaScheduledWakes(fixture.endpointId);
      if (!wakes) throw new Error("S0b timer variant: the endpoint's scheduled-wake runtime is not active");
      const cancelLatencies: number[] = [];
      const cancelQueries: number[] = [];
      const cancelOffenders: string[] = [];
      const cancelledBefore = wakes.stats.cancelled;
      for (let index = 0; index < options.s0bSamples; index++) {
        const armed = emit({ chatId: ACTIVE_GROUP, author: jid(MEMBER_PHONE), body: "is the owner around " + index, extra: { mentionedIds: [jid(OWNER_PHONE)] } });
        await until(decided(armed.waMessageId!), 10_000, "S0b timer arm");
        await until(() => wakes.hasPendingAbsence(ACTIVE_GROUP), 10_000, "S0b absence timer armed");
        const row = emit({ chatId: ACTIVE_GROUP, author: jid(OWNER_PHONE), body: "owner is here " + index });
        await until(decided(row.waMessageId!), 10_000, "S0b timer cancel");
        await until(() => !wakes.hasPendingAbsence(ACTIVE_GROUP), 10_000, "S0b absence timer cancelled");
        const scope = instrumentation.scopes.get(row.waMessageId!)!;
        if (scope.outcome !== "ownerActivity") throw new Error("S0b timer sample was not owner activity: " + scope.outcome);
        cancelLatencies.push(scope.decided! - scope.arrival);
        cancelQueries.push(scope.queries);
        if (scope.queries > 1 && cancelOffenders.length < 5) cancelOffenders.push(...scope.sql);
      }
      const cancelLatency = summarize(cancelLatencies);
      const cancelMax = Math.max(...cancelQueries);
      const cancelled = wakes.stats.cancelled - cancelledBefore;
      results.s0b = {
        boundary: "client socket frame received -> discard, quote outside the in-memory outbound index (one stored lookup)",
        latencyMs: latency,
        queries: { max: maxQueries, min: Math.min(...queryCounts) },
        quoteLookups: service.openwaAdmissionStats.quoteLookups - lookupsBefore,
        timerCancelVariant: {
          boundary: "client socket frame received -> admission stats.ownerActivity++ for an owner message in a chat with an armed owner_absent timer (cancel included)",
          latencyMs: cancelLatency,
          queries: { max: cancelMax, min: Math.min(...cancelQueries) },
          cancelled,
          offendingSql: cancelOffenders,
        },
      };
      budgets.push(
        { seam: "S0b candidate check", metric: "p95 ms", value: latency.p95, budget: "<= 10", status: latency.p95 !== null && latency.p95 <= 10 ? "pass" : "fail" },
        { seam: "S0b candidate check", metric: "DB queries per event (max)", value: maxQueries, budget: "<= 1", status: maxQueries <= 1 ? "pass" : "fail" },
        {
          seam: "S0b pending-timer cancel",
          metric: "p95 ms",
          value: cancelLatency.p95,
          budget: "<= 10",
          status: cancelLatency.p95 !== null && cancelLatency.p95 <= 10 && cancelled === options.s0bSamples ? "pass" : "fail",
          ...(cancelled === options.s0bSamples ? {} : { evidence: cancelled + " of " + options.s0bSamples + " timers cancelled" }),
        },
        {
          seam: "S0b pending-timer cancel",
          metric: "DB queries per event (max)",
          value: cancelMax,
          budget: "<= 1",
          status: cancelMax <= 1 ? "pass" : "fail",
          ...(cancelOffenders.length ? { evidence: cancelOffenders[0] } : {}),
        },
      );
    }

    if (!options.skip.has("s1")) {
      const settleGap = options.latencyMs * 3 + 100;
      const openwaSamples: Array<{ token: number; id: string; arrival: number; queries: number }> = [];
      const requestsBefore = gateway.requests.length;
      for (let index = 0; index < options.s1Samples + 3; index++) {
        const token = nextToken();
        const wakesBefore = instrumentation.wakes.length;
        const queriesBefore = instrumentation.totalQueries;
        const row = emit({ chatId: jid(OWNER_PHONE), body: "please check bench#" + token });
        await until(() => instrumentation.commits.has(token) && instrumentation.wakes.length > wakesBefore, 30_000, "S1 OpenWA admission");
        if (index >= 3)
          openwaSamples.push({ token, id: row.waMessageId!, arrival: instrumentation.scopes.get(row.waMessageId!)!.arrival, queries: instrumentation.totalQueries - queriesBefore });
        await sleep(settleGap);
      }
      const gatewayCalls: Record<string, number> = {};
      for (const request of gateway.requests.slice(requestsBefore)) {
        const key = request.method + " " + request.path.replace("/api/sessions/" + SESSION_ID, "/api/sessions/:id");
        gatewayCalls[key] = (gatewayCalls[key] ?? 0) + 1;
      }
      const telegramSamples: Array<{ token: number; start: number; queries: number }> = [];
      for (let index = 0; index < options.s1Samples + 3; index++) {
        const token = nextToken();
        const wakesBefore = instrumentation.wakes.length;
        const queriesBefore = instrumentation.totalQueries;
        const start = clock();
        const response = await service.handleWebhook(
          fixture.telegramPublicId,
          "telegram",
          new Request("https://paperclip.example/api/chat-webhooks/" + fixture.telegramPublicId + "/telegram", {
            method: "POST",
            headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": telegram.secret },
            body: JSON.stringify({
              update_id: 70_000 + token,
              message: {
                message_id: 10_000 + token,
                date: Math.floor(Date.now() / 1000),
                chat: { id: TELEGRAM_USER_ID, type: "private", first_name: "Bench User" },
                from: { id: TELEGRAM_USER_ID, is_bot: false, first_name: "Bench User", username: "bench_user" },
                text: "please check bench#" + token,
              },
            }),
          }),
        );
        if (response.status !== 200) throw new Error("Telegram webhook returned " + response.status + ": " + (await response.text()).slice(0, 300));
        await until(() => instrumentation.commits.has(token) && instrumentation.wakes.length > wakesBefore, 30_000, "S1 Telegram admission");
        if (index >= 3) telegramSamples.push({ token, start, queries: instrumentation.totalQueries - queriesBefore });
        await sleep(settleGap);
      }
      const openwaS1 = openwaSamples.map((sample) => instrumentation.commits.get(sample.token)! - sample.arrival);
      const stage = (pick: (sample: { token: number; arrival: number; id: string }) => number) => summarize(openwaSamples.map(pick));
      const classifyStage = stage((sample) => instrumentation.scopes.get(sample.id)!.decided! - sample.arrival);
      const ingressStage = stage((sample) => instrumentation.deliveryCommits.get(sample.token)! - instrumentation.scopes.get(sample.id)!.decided!);
      const drainStage = stage((sample) => instrumentation.commits.get(sample.token)! - instrumentation.deliveryCommits.get(sample.token)!);
      const rescued = openwaSamples.filter((sample) => instrumentation.commits.get(sample.token)! - instrumentation.deliveryCommits.get(sample.token)! > SWEEP_RESCUE_MS).length;
      const telegramWork = telegramSamples.map((sample) => instrumentation.commits.get(sample.token)! - sample.start);
      const drainWindows = openwaSamples.map((sample) => instrumentation.window(instrumentation.deliveryCommits.get(sample.token)!, instrumentation.commits.get(sample.token)!));
      const telegramWindows = telegramSamples.map((sample) => instrumentation.window(sample.start, instrumentation.commits.get(sample.token)!));
      const medianGap = [...drainWindows].sort((a, b) => a.maxGapMs - b.maxGapMs)[Math.floor(drainWindows.length / 2)] ?? null;
      const medianDrainSample = [...openwaSamples].sort(
        (a, b) =>
          instrumentation.commits.get(a.token)! - instrumentation.deliveryCommits.get(a.token)! -
          (instrumentation.commits.get(b.token)! - instrumentation.deliveryCommits.get(b.token)!),
      )[Math.floor(openwaSamples.length / 2)];
      const medianDrainTrace = medianDrainSample
        ? instrumentation.trace(instrumentation.scopes.get(medianDrainSample.id)!.decided!, instrumentation.commits.get(medianDrainSample.token)!, medianDrainSample.id)
        : [];
      const commentTokens = await commentTokenMap(db, fixture.companyId);
      const dispatch = (tokens: number[]) =>
        tokens
          .map((token) => {
            const commit = instrumentation.commits.get(token);
            const wake = instrumentation.wakes.find((entry) => entry.commentId && commentTokens.get(entry.commentId) === token);
            return commit !== undefined && wake ? wake.at - commit : null;
          })
          .filter((value): value is number => value !== null);
      const openwaLatency = summarize(openwaS1);
      const telegramLatency = summarize(telegramWork);
      const ratio = openwaLatency.p95 !== null && telegramLatency.p95 ? Math.round((openwaLatency.p95 / telegramLatency.p95) * 1000) / 1000 : null;
      const s2 = summarize(dispatch(openwaSamples.map((sample) => sample.token)));
      results.s1 = {
        boundary:
          "OpenWA: client socket frame received -> commit of the transaction inserting the trigger's issue comment (conversation issue, comment, message link, staged wake). Telegram: service.handleWebhook called -> the same commit",
        openwaMs: openwaLatency,
        openwaStagesMs: {
          classify: classifyStage,
          frameDecisionToIngressDeliveryCommit: ingressStage,
          ingressDeliveryCommitToCommentCommit: drainStage,
        },
        drainStageQueries: summarize(drainWindows.map((entry) => entry.queries)),
        drainStageMaxIdleGapMs: summarize(drainWindows.map((entry) => entry.maxGapMs)),
        drainStageMedianSampleIdleGap: medianGap,
        medianSampleQueryTrace: medianDrainTrace,
        slowestSamples: [...openwaSamples]
          .sort((a, b) => instrumentation.commits.get(b.token)! - b.arrival - (instrumentation.commits.get(a.token)! - a.arrival))
          .slice(0, 4)
          .map((sample) => ({
            totalMs: Math.round(instrumentation.commits.get(sample.token)! - sample.arrival),
            ingressMs: Math.round(instrumentation.deliveryCommits.get(sample.token)! - sample.arrival),
            drain: instrumentation.window(instrumentation.deliveryCommits.get(sample.token)!, instrumentation.commits.get(sample.token)!),
            stalls: instrumentation.stallsIn(sample.arrival, instrumentation.commits.get(sample.token)!),
            txWaits: instrumentation.waitsIn(sample.arrival, instrumentation.commits.get(sample.token)!),
            ownTrace: instrumentation
              .trace(sample.arrival, instrumentation.commits.get(sample.token)!, sample.id)
              .filter((line) => line.startsWith("*"))
              .map((line) => line.slice(0, 110)),
          })),
        telegramToCommentQueries: summarize(telegramWindows.map((entry) => entry.queries)),
        telegramMaxIdleGapMs: summarize(telegramWindows.map((entry) => entry.maxGapMs)),
        dbQueriesEventToWake: {
          openwa: summarize(openwaSamples.map((sample) => sample.queries)),
          telegram: summarize(telegramSamples.map((sample) => sample.queries)),
          note: "process-wide queries from event to wake call; includes heartbeat.wakeup, run start and any 1 s reconcile sweep in that interval",
        },
        openwaGatewayRestCalls: gatewayCalls,
        openwaSamplesWaitingForReconcileSweep: rescued,
        reconcileSweepIntervalMs: RECONCILE_INTERVAL_MS,
        sampleSpacingMs: settleGap,
        telegramMs: telegramLatency,
        ratioP95: ratio,
      };
      results.s2 = {
        boundary: "comment transaction committed -> heartbeat.wakeup called (run start requested); OpenWA has no ingress reorder window",
        openwaMs: s2,
        telegramMs: summarize(dispatch(telegramSamples.map((sample) => sample.token))),
      };
      budgets.push(
        { seam: "S1 admission", metric: "p95 ms", value: openwaLatency.p95, budget: "<= 50", status: openwaLatency.p95 !== null && openwaLatency.p95 <= 50 ? "pass" : "fail" },
        {
          seam: "S1 admission",
          metric: "p95 / Telegram p95",
          value: ratio,
          budget: "<= 1.2",
          status: ratio !== null && ratio <= 1.2 ? "pass" : "fail",
          evidence: "Telegram p95 " + telegramLatency.p95 + " ms",
        },
        { seam: "S2 dispatch", metric: "p95 ms", value: s2.p95, budget: "<= 200", status: s2.p95 !== null && s2.p95 <= 200 ? "pass" : "fail" },
      );
    }

    if (!options.skip.has("s3")) {
      const s3 = await toolOverhead(db, input.root, fixture, options);
      results.s3 = s3.result;
      budgets.push(...s3.budgets);
    }

    if (!options.skip.has("s4")) {
      const issueId = await ownerConversationIssue(db, fixture.companyId, fixture.endpointId);
      if (!issueId) throw new Error("S4 needs the owner conversation issue from S1");
      const client = createOpenwaGatewayClient({ baseUrl: gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
      const transfers = new Map<string, number>();
      const timed: OpenwaGatewayClient = {
        ...client,
        async downloadMedia(request) {
          const started = clock();
          const download = await client.downloadMedia(request);
          download.stream.once("end", () => transfers.set(request.messageId, clock() - started));
          return download;
        },
      };
      const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(MiB - 8)]);
      const ingest: number[] = [];
      const transfer: number[] = [];
      const statuses: Record<string, number> = {};
      for (let index = 0; index < options.s4Samples + 2; index++) {
        const waMessageId = gateway.nextWaMessageId(false, jid(OWNER_PHONE));
        gateway.setMedia(jid(OWNER_PHONE), waMessageId, { body: image, contentType: "image/png" });
        const event = normalizeOpenwaInbound(
          {
            event: "message.received",
            sessionId: SESSION_ID,
            source: "live",
            data: {
              id: waMessageId,
              chatId: jid(OWNER_PHONE),
              from: jid(OWNER_PHONE),
              to: jid(OWN_PHONE),
              body: "",
              type: "image",
              timestamp: Math.floor(Date.now() / 1000),
              fromMe: false,
              kind: "individual",
              media: { mimetype: "image/png", sizeBytes: image.length, omitted: true },
            },
          },
          jid(OWN_PHONE),
          openwaDedupeKey(SESSION_ID, waMessageId)!,
          false,
        )!;
        const [comment] = await db.insert(issueComments).values({ companyId: fixture.companyId, issueId, body: "media sample", authorType: "system" }).returning();
        const started = clock();
        const [item] = await service.openwaMedia.ingestOpenwaTriggerMedia({
          endpoint: { id: fixture.endpointId, companyId: fixture.companyId },
          client: timed,
          issueId,
          commentId: comment!.id,
          event,
        });
        const total = clock() - started;
        statuses[item?.status ?? "none"] = (statuses[item?.status ?? "none"] ?? 0) + 1;
        const moved = transfers.get(waMessageId) ?? 0;
        if (index >= 2) {
          ingest.push(total - moved);
          transfer.push(moved);
        }
      }
      const latency = summarize(ingest);
      results.s4 = {
        boundary:
          "openwaMedia.ingestOpenwaTriggerMedia wall time minus gateway transfer (downloadMedia call -> stream end), measured at the media service that admission calls after the inbound comment commits",
        bytes: image.length,
        ingestExcludingTransferMs: latency,
        transferMs: summarize(transfer),
        statuses,
      };
      const allStored = (statuses.stored ?? 0) === options.s4Samples + 2;
      budgets.push({
        seam: "S4 media",
        metric: "p95 ms (1 MiB, transfer excluded)",
        value: latency.p95,
        budget: "<= 300",
        status: allStored && latency.p95 !== null && latency.p95 <= 300 ? "pass" : "fail",
        ...(allStored ? {} : { evidence: "statuses " + JSON.stringify(statuses) }),
      });
    }

    if (!options.skip.has("s5")) {
      const learnToken = nextToken();
      const learn = emit({
        chatId: ACTIVE_GROUP,
        author: OWNER_LID,
        body: "@" + OWN_PHONE + " bench#" + learnToken,
        extra: { mentionedIds: [jid(OWN_PHONE)], isLidSender: true, senderPhone: OWNER_PHONE },
      });
      await until(decided(learn.waMessageId!), 10_000, "S5 LID learn");
      await until(() => instrumentation.commits.has(learnToken), 30_000, "S5 learn admission");
      const samples: Array<{ token: number; id: string; kind: "owner_lid" | "unknown_lid" }> = [];
      for (let index = 0; index < options.s5Samples; index++) {
        const token = nextToken();
        const kind = index % 2 === 0 ? "owner_lid" : "unknown_lid";
        const author = kind === "owner_lid" ? OWNER_LID : "19" + String(1_000_000_000_000 + index) + "@lid";
        const row = emit({
          chatId: ACTIVE_GROUP,
          author,
          body: "@" + OWN_PHONE + " bench#" + token,
          extra: { mentionedIds: [jid(OWN_PHONE)], isLidSender: true },
        });
        await until(decided(row.waMessageId!), 10_000, "S5 classification");
        samples.push({ token, id: row.waMessageId!, kind });
      }
      const tokens = samples.map((sample) => sample.token);
      await until(async () => (await deliveryRoles(db, fixture.endpointId, tokens)).size >= tokens.length, 60_000, "S5 deliveries", 50);
      const roles = await deliveryRoles(db, fixture.endpointId, tokens);
      let hits = 0;
      let misses = 0;
      let ownerRecognised = 0;
      let ownerKeptAtCommit = 0;
      let unknownFailClosed = 0;
      const resolution: number[] = [];
      for (const sample of samples) {
        const scope = instrumentation.scopes.get(sample.id)!;
        resolution.push(scope.decided! - scope.arrival);
        const classified = instrumentation.classifiedRoles.get(sample.token) ?? null;
        if (classified === "owner") hits++;
        else misses++;
        if (sample.kind === "owner_lid" && classified === "owner") ownerRecognised++;
        if (sample.kind === "owner_lid" && roles.get(sample.token) === "owner") ownerKeptAtCommit++;
        if (sample.kind === "unknown_lid" && classified !== "owner" && roles.get(sample.token) !== "owner") unknownFailClosed++;
      }
      const latency = summarize(resolution);
      const ownerSamples = samples.filter((sample) => sample.kind === "owner_lid").length;
      const unknownSamples = samples.length - ownerSamples;
      results.s5 = {
        boundary:
          "client socket frame received -> classification decision for @lid senders without senderPhone. The pipeline has no gateway LID lookup: a learned owner LID resolves from the in-memory snapshot, an unknown LID fails closed to outside_allowlist without a network call",
        resolutionMs: latency,
        hitRatio: Math.round((hits / Math.max(1, hits + misses)) * 1000) / 1000,
        hits,
        misses,
        ownerLidRecognisedByClassifier: ownerRecognised + "/" + ownerSamples,
        ownerLidRoleAfterAdmissionRecheck: ownerKeptAtCommit + "/" + ownerSamples,
        unknownLidFailClosed: unknownFailClosed + "/" + unknownSamples,
      };
      budgets.push(
        { seam: "S5 LID miss", metric: "max resolution ms", value: latency.max, budget: "<= 2000", status: latency.max !== null && latency.max <= 2000 ? "pass" : "fail" },
        {
          seam: "S5 LID miss",
          metric: "learned owner LID recognised by classifier",
          value: ownerRecognised + "/" + ownerSamples,
          budget: "all",
          status: ownerRecognised === ownerSamples ? "pass" : "fail",
          evidence: "owner role kept after in-transaction recheck: " + ownerKeptAtCommit + "/" + ownerSamples,
        },
        {
          seam: "S5 LID miss",
          metric: "unknown LID fails closed",
          value: unknownFailClosed + "/" + unknownSamples,
          budget: "all",
          status: unknownFailClosed === unknownSamples ? "pass" : "fail",
        },
      );
    }

    if (!options.skip.has("burst")) {
      const burst = await runBurst(db, gateway, instrumentation, fixture, options, nextToken, gc);
      results.burst = burst.result;
      budgets.push(...burst.budgets);
    }

    const context = await contextBudget();
    results.context = context.result;
    budgets.push(...context.budgets);
  } catch (error) {
    results.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    exitCode = 2;
  } finally {
    clearInterval(reconcileTimer);
    instrumentation.stopStalls();
    await Promise.allSettled([...lanes.values()]);
    await service.shutdown().catch(() => undefined);
    await heartbeat.drainActiveRunExecutions().catch(() => undefined);
    await gateway.close().catch(() => undefined);
    globalThis.fetch = realFetch;
    await database.cleanup().catch(() => undefined);
    await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const failed = budgets.filter((row) => row.status === "fail");
  if (failed.length && exitCode === 0) exitCode = 1;
  const partial = [
    ...[...options.skip].map((seam) => "skipped: " + seam),
    ...budgets.filter((row) => row.status === "not available").map((row) => "not available: " + row.seam + " " + row.metric),
  ];
  if (partial.length && exitCode === 0) exitCode = 3;
  const report = {
    benchmark: "openwa-ingest",
    startedAt,
    finishedAt: new Date().toISOString(),
    node: process.version,
    negativeControl: options.negativeControl,
    options: { ...options, skip: [...options.skip] },
    totalDbQueries: instrumentation.totalQueries,
    results,
    budgets,
    partial: partial.length > 0,
    partialReasons: partial,
    pass: exitCode === 0,
    profiling: "Re-run with node --cpu-prof scripts/bench/openwa-ingest.mjs --skip=<other seams> to profile a failing seam; offending SQL and idle gaps are listed per seam",
  };
  const outFile =
    options.out ??
    path.join(input.scratch, "results", "openwa-ingest-" + (options.negativeControl ? "negative-control-" : "") + startedAt.replace(/[:.]/g, "-") + ".json");
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(report, null, 2) + "\n");
  printTable(budgets, results);
  console.log("\nJSON result: " + outFile);
  console.log(
    exitCode === 0
      ? "PASS"
      : exitCode === 1
        ? "FAIL: " + failed.length + " budget(s) violated"
        : exitCode === 3
          ? "PARTIAL: not AC17 evidence (" + partial.join("; ") + ")"
          : "ERROR: benchmark aborted",
  );
  return exitCode;
}

async function seed(db: Db, service: ChatChannelService, gateway: FakeOpenwaGateway) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const userId = randomUUID();
  await instanceSettingsService(db).updateExperimental({ enableChatConnectors: true });
  await db.insert(companies).values({
    id: companyId,
    name: "OpenWA benchmark",
    issuePrefix: "B" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
    requireBoardApprovalForNewAgents: false,
  });
  await db.insert(agents).values({
    id: agentId,
    companyId,
    name: "Bench Agent",
    role: "engineer",
    status: "idle",
    adapterType: BENCH_ADAPTER,
    adapterConfig: {},
    runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 20 } },
    permissions: {},
  });
  await db.insert(authUsers).values({ id: userId, name: "Owner", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
  gateway.groups.set(ACTIVE_GROUP, {
    id: ACTIVE_GROUP,
    name: "Bench active",
    participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }, { id: jid(STRANGER_PHONE) }],
  });
  gateway.groups.set(INACTIVE_GROUP, { id: INACTIVE_GROUP, name: "Bench inactive", participants: [{ id: jid(OWN_PHONE) }, { id: jid(MEMBER_PHONE) }] });

  const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
  const secret = await secretService(db).create(
    companyId,
    { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value: FAKE_OPENWA_KEY },
    { userId },
  );
  const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
  const binding = { secretId: secret.id, versionSelector: "latest", configPath: "credentials.apiKey", required: true, label: "apiKey", projectionClass: "unclassified" } as const;
  await db.update(toolConnections).set({ status: "active", enabled: true, credentialSecretRefs: [binding] }).where(eq(toolConnections.id, row!.connectionId));
  await db.insert(companySecretBindings).values({ companyId, targetType: "tool_connection", targetId: row!.connectionId, ...binding });
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
  for (const phone of ALLOWED_PHONES) await service.openwa.addSenderRule(endpoint.id, { list: "allow", e164: "+" + phone }, userId);

  const telegramEndpoint = await service.create(companyId, { provider: "telegram", assignedAgentId: agentId }, userId);
  await service.configure(telegramEndpoint.id, { action: "configure", credentials: { botToken: TELEGRAM_BOT_ID + ":bench-telegram-token" } }, userId);
  await db.update(chatEndpoints).set({ status: "active" }).where(eq(chatEndpoints.id, telegramEndpoint.id));
  return {
    companyId,
    agentId,
    userId,
    endpointId: endpoint.id,
    telegramEndpointId: telegramEndpoint.id,
    telegramPublicId: telegramEndpoint.publicId,
  };
}

type Fixture = Awaited<ReturnType<typeof seed>>;

async function commentTokenMap(db: Db, companyId: string): Promise<Map<string, number>> {
  const rows = await db.select({ id: issueComments.id, body: issueComments.body }).from(issueComments).where(eq(issueComments.companyId, companyId));
  const map = new Map<string, number>();
  for (const row of rows) {
    const match = TOKEN_PATTERN.exec(row.body ?? "");
    if (match) map.set(row.id, Number(match[1]));
  }
  return map;
}

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: SamplingNode[];
}

async function retainedHeapSites(session: Session): Promise<{ totalMb: number; byFrame: string[]; byFirstProductFrame: string[] }> {
  const { profile } = (await session.post("HeapProfiler.getSamplingProfile")) as unknown as { profile: { head: SamplingNode } };
  await session.post("HeapProfiler.stopSampling");
  session.disconnect();
  const byFrame = new Map<string, number>();
  const byProduct = new Map<string, number>();
  let total = 0;
  const label = (frame: SamplingNode["callFrame"]) =>
    (frame.functionName || "(anonymous)") + " " + frame.url.replace(/^.*\/(server|packages|node_modules)\//, "$1/") + ":" + (frame.lineNumber + 1);
  const walk = (node: SamplingNode, stack: SamplingNode["callFrame"][]) => {
    const frames = [...stack, node.callFrame];
    if (node.selfSize) {
      total += node.selfSize;
      const top = label(node.callFrame);
      byFrame.set(top, (byFrame.get(top) ?? 0) + node.selfSize);
      const product = [...frames].reverse().find((frame) => /\/server\/src\//.test(frame.url));
      const key = product ? label(product) : "(no server/src frame)";
      byProduct.set(key, (byProduct.get(key) ?? 0) + node.selfSize);
    }
    for (const child of node.children) walk(child, frames);
  };
  walk(profile.head, []);
  const top = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([key, size]) => (Math.round((size / MiB) * 100) / 100).toFixed(2) + " MB " + key);
  return { totalMb: Math.round((total / MiB) * 10) / 10, byFrame: top(byFrame), byFirstProductFrame: top(byProduct) };
}

async function deliveryRoles(db: Db, endpointId: string, tokens: number[]): Promise<Map<number, string | null>> {
  const wanted = new Set(tokens);
  const rows = await db
    .select({
      token: sql<string | null>`substring(${chatDeliveries.normalizedEvent}->'message'->>'text' from 'bench#([0-9]+)')`,
      principalRole: chatDeliveries.principalRole,
    })
    .from(chatDeliveries)
    .where(
      and(
        eq(chatDeliveries.endpointId, endpointId),
        notInArray(chatDeliveries.state, ["received", "processing"]),
        sql`${chatDeliveries.normalizedEvent}->'message'->>'text' like '%bench#%'`,
      ),
    );
  const roles = new Map<number, string | null>();
  for (const row of rows) {
    const token = row.token === null ? Number.NaN : Number(row.token);
    if (wanted.has(token)) roles.set(token, row.principalRole ?? null);
  }
  return roles;
}

async function ownerConversationIssue(db: Db, companyId: string, endpointId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.originId, "chat:" + endpointId + ":" + jid(OWNER_PHONE) + ":1")));
  return row?.id ?? null;
}

async function toolOverhead(db: Db, root: string, fixture: Fixture, options: BenchOptions): Promise<{ result: unknown; budgets: BudgetRow[] }> {
  const toolsPath = path.join(root, "server/src/services/openwa/tools.ts");
  const unavailable = (reason: string) => ({
    result: { status: "not available", reason },
    budgets: [{ seam: "S3 tool overhead", metric: "p95 ms", value: null, budget: "<= 30", status: "not available" as const, evidence: reason }],
  });
  if (!existsSync(toolsPath)) return unavailable("requires T9: server/src/services/openwa/tools.ts is not on this branch");
  const tools = (await import(pathToFileURL(toolsPath).href)) as {
    executeOpenwaTool?: (db: Db, binding: { companyId: string; agentId: string; runId: string; issueId: string }, name: string, value: unknown) => Promise<unknown>;
  };
  if (typeof tools.executeOpenwaTool !== "function") return unavailable("requires T9: tools.ts does not export executeOpenwaTool");
  const issueId = await ownerConversationIssue(db, fixture.companyId, fixture.endpointId);
  if (!issueId) throw new Error("S3 needs the owner conversation issue from S1");
  const [run] = await db
    .insert(heartbeatRuns)
    .values({
      companyId: fixture.companyId,
      agentId: fixture.agentId,
      status: "running",
      startedAt: new Date(),
      contextSnapshot: {
        issueId,
        taskId: issueId,
        paperclipOpenwa: {
          endpointId: fixture.endpointId,
          chatKey: jid(OWNER_PHONE),
          triggerClass: "owner",
          profile: "full",
          grantIds: [],
          requesterPrincipalId: null,
          approvalRequestId: null,
        },
      },
    })
    .returning({ id: heartbeatRuns.id });
  const binding = { companyId: fixture.companyId, agentId: fixture.agentId, runId: run!.id, issueId };
  const overhead: number[] = [];
  const resultBytes: number[] = [];
  for (let index = 0; index < 55; index++) {
    const started = clock();
    const value = await tools.executeOpenwaTool(db, binding, "openwa_read_chat", {});
    const elapsed = clock() - started;
    if (index >= 5) {
      overhead.push(elapsed - options.latencyMs);
      resultBytes.push(Buffer.byteLength(JSON.stringify(value ?? null)));
    }
  }
  await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, run!.id));
  const latency = summarize(overhead);
  const maxBytes = Math.max(...resultBytes);
  return {
    result: { boundary: "executeOpenwaTool('openwa_read_chat', {}) wall time minus one fake gateway REST latency", overheadMs: latency, resultBytesMax: maxBytes },
    budgets: [
      { seam: "S3 tool overhead", metric: "p95 ms", value: latency.p95, budget: "<= 30", status: latency.p95 !== null && latency.p95 <= 30 ? "pass" : "fail" },
      { seam: "Context", metric: "openwa_read_chat result bytes (max)", value: maxBytes, budget: "<= 16384", status: maxBytes <= 16_384 ? "pass" : "fail" },
    ],
  };
}

async function contextBudget(): Promise<{ result: unknown; budgets: BudgetRow[] }> {
  const shared = (await import("@tickernelz/paperclip-pro-shared")) as Record<string, unknown>;
  const tools = shared.OPENWA_TOOLS;
  if (!Array.isArray(tools)) {
    const reason = "requires T9: OPENWA_TOOLS is not exported from @tickernelz/paperclip-pro-shared on this branch";
    return {
      result: { status: "not available", reason },
      budgets: [{ seam: "Context", metric: "tool schema tokens", value: null, budget: "<= ~3000", status: "not available", evidence: reason }],
    };
  }
  const schemas = tools.map((tool) => {
    const entry = tool as { name?: unknown; description?: unknown; inputSchema?: unknown; schema?: unknown };
    return { name: entry.name, description: entry.description, input_schema: entry.inputSchema ?? entry.schema };
  });
  const bytes = Buffer.byteLength(JSON.stringify(schemas));
  const tokens = Math.ceil(bytes / 4);
  return {
    result: { tools: schemas.length, schemaBytes: bytes, estimatedTokens: tokens, tokenizer: "bytes/4 estimate: the repo ships no tokenizer" },
    budgets: [{ seam: "Context", metric: "tool schema tokens (bytes/4)", value: tokens, budget: "<= ~3000", status: tokens <= 3_000 ? "pass" : "fail", evidence: bytes + " bytes" }],
  };
}

async function agentQueueBacklog(db: Db, agentId: string): Promise<{ wakes: number; runs: number }> {
  const [wakes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentWakeupRequests)
    .where(and(eq(agentWakeupRequests.agentId, agentId), inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"])));
  const [runs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"])));
  return { wakes: wakes?.count ?? 0, runs: runs?.count ?? 0 };
}

async function cancelLeftoverWakes(db: Db, agentId: string): Promise<number> {
  const cancelled = await db
    .update(agentWakeupRequests)
    .set({ status: "cancelled", finishedAt: new Date(), error: "openwa bench: leftover from an earlier seam, cancelled before the burst" })
    .where(and(eq(agentWakeupRequests.agentId, agentId), eq(agentWakeupRequests.status, "deferred_issue_execution")))
    .returning({ id: agentWakeupRequests.id });
  return cancelled.length;
}

async function drainAgentQueue(db: Db, agentId: string, timeoutMs: number): Promise<{ ms: number; error: string | null }> {
  const started = clock();
  let idleSince: number | null = null;
  for (;;) {
    const backlog = await agentQueueBacklog(db, agentId);
    const now = clock();
    if (backlog.wakes === 0 && backlog.runs === 0) {
      idleSince ??= now;
      if (now - idleSince >= 1_000) return { ms: Math.round(idleSince - started), error: null };
    } else idleSince = null;
    if (now - started > timeoutMs)
      return { ms: Math.round(now - started), error: "queue not drained after " + timeoutMs + " ms: " + backlog.wakes + " pending wakes, " + backlog.runs + " live runs" };
    await sleep(250);
  }
}

async function runBurst(
  db: Db,
  gateway: FakeOpenwaGateway,
  instrumentation: Instrumentation,
  fixture: Fixture,
  options: BenchOptions,
  nextToken: () => number,
  gc: () => void,
): Promise<{ result: unknown; budgets: BudgetRow[] }> {
  const preBurstBacklog = await agentQueueBacklog(db, fixture.agentId);
  const preBurstCancelled = await cancelLeftoverWakes(db, fixture.agentId);
  const preBurstDrain = await drainAgentQueue(db, fixture.agentId, 60_000);
  gc();
  await sleep(200);
  gc();
  const memoryAtStart = process.memoryUsage();
  let memoryBefore = memoryAtStart;
  const memoryTimeline: Array<Record<string, number>> = [];
  const sampleMemory = () => {
    const usage = process.memoryUsage();
    memoryTimeline.push({ atS: Math.round((clock() - start) / 100) / 10, rss: Math.round(usage.rss / MiB), heapTotal: Math.round(usage.heapTotal / MiB), heapUsed: Math.round(usage.heapUsed / MiB), external: Math.round(usage.external / MiB), arrayBuffers: Math.round(usage.arrayBuffers / MiB) });
  };
  const memoryTimer = setInterval(sampleMemory, 5_000);
  const heapSession = options.heapSampling ? new Session() : null;
  if (heapSession) {
    heapSession.connect();
    await heapSession.post("HeapProfiler.startSampling", { samplingInterval: 16_384 });
  }
  const warmupTotal = Math.round(options.burstWarmupSeconds * options.burstRate);
  const total = warmupTotal + Math.round(options.burstSeconds * options.burstRate);
  const interval = 1000 / options.burstRate;
  const emitted: Array<{ id: string; sequence: number; token: number | null; live: boolean }> = [];
  const triggerKinds = [
    { chatId: jid(OWNER_PHONE), author: undefined, mention: false },
    ...ALLOWED_PHONES.map((phone) => ({ chatId: jid(phone), author: undefined, mention: false })),
    { chatId: ACTIVE_GROUP, author: jid(MEMBER_PHONE), mention: true },
    { chatId: ACTIVE_GROUP, author: jid(OWNER_PHONE), mention: true },
  ];
  const killAt = (options.burstWarmupSeconds + options.killAtSeconds) * 1000;
  const killUntil = killAt + options.killForSeconds * 1000;
  let killed = false;
  let killedAt: number | null = null;
  let restoredAt: number | null = null;
  const start = clock();
  const lagSamples: number[] = [];
  for (let index = 0; index < total; index++) {
    const due = start + index * interval;
    const wait = due - clock();
    if (wait > 0) await sleep(wait);
    if (index === warmupTotal && warmupTotal > 0) {
      gc();
      memoryBefore = process.memoryUsage();
      sampleMemory();
    }
    lagSamples.push(clock() - due);
    const elapsed = clock() - start;
    if (!killed && options.killForSeconds > 0 && elapsed >= killAt && elapsed < killUntil) {
      gateway.killSocket();
      killed = true;
      killedAt = elapsed;
    }
    if (killed && restoredAt === null && elapsed >= killUntil) {
      gateway.restartSocket();
      restoredAt = elapsed;
    }
    const trigger = options.triggerEvery > 0 && index % options.triggerEvery === options.triggerEvery - 1;
    const live = gateway.subscriberCount > 0;
    if (trigger) {
      const token = nextToken();
      const kind = triggerKinds[Math.floor(index / options.triggerEvery) % triggerKinds.length]!;
      const row = gateway.inbound({
        chatId: kind.chatId,
        ...(kind.author ? { author: kind.author } : {}),
        body: (kind.mention ? "@" + OWN_PHONE + " " : "") + "burst bench#" + token,
        ...(kind.mention ? { extra: { mentionedIds: [jid(OWN_PHONE)] } } : {}),
      });
      emitted.push({ id: row.waMessageId!, sequence: row.sequence, token, live });
    } else {
      const row = gateway.inbound({
        chatId: index % 5 === 4 ? INACTIVE_GROUP : ACTIVE_GROUP,
        author: jid(index % 2 ? MEMBER_PHONE : STRANGER_PHONE),
        body: "burst chatter " + index,
      });
      emitted.push({ id: row.waMessageId!, sequence: row.sequence, token: null, live });
    }
  }
  if (killed && restoredAt === null) {
    gateway.restartSocket();
    restoredAt = clock() - start;
  }
  const burstEnd = clock();
  const triggerTokens = emitted.filter((entry) => entry.token !== null).map((entry) => entry.token!);
  let settleError: string | null = null;
  try {
    await until(() => emitted.every((entry) => instrumentation.admits.has(entry.id)), 120_000, "burst receiver catch-up");
    await until(async () => (await deliveryRoles(db, fixture.endpointId, triggerTokens)).size >= triggerTokens.length, 180_000, "burst trigger admission", 250);
  } catch (error) {
    settleError = error instanceof Error ? error.message : String(error);
  }
  const settledAt = clock();
  gc();
  await sleep(200);
  gc();
  clearInterval(memoryTimer);
  sampleMemory();
  const retainedAllocations = heapSession ? await retainedHeapSites(heapSession) : null;
  const memoryAfter = process.memoryUsage();
  const rssBefore = memoryBefore.rss;
  const heapBefore = memoryBefore.heapUsed;
  const rssAfter = memoryAfter.rss;
  const heapAfter = memoryAfter.heapUsed;
  const lost = emitted.filter((entry) => !instrumentation.admits.has(entry.id));
  const duplicated = emitted.filter((entry) => (instrumentation.admits.get(entry.id) ?? 0) > 1);
  const deliveryRows = await db
    .select({ normalizedEvent: chatDeliveries.normalizedEvent, triggerClass: chatDeliveries.triggerClass })
    .from(chatDeliveries)
    .where(and(eq(chatDeliveries.endpointId, fixture.endpointId), gte(chatDeliveries.createdAt, new Date(start - 1000))));
  const perToken = new Map<number, number>();
  const tokenClass = new Map<number, string | null>();
  for (const row of deliveryRows) {
    const match = TOKEN_PATTERN.exec(JSON.stringify(row.normalizedEvent ?? {}));
    if (!match) continue;
    const token = Number(match[1]);
    perToken.set(token, (perToken.get(token) ?? 0) + 1);
    tokenClass.set(token, row.triggerClass ?? null);
  }
  const triggersNotOnce = triggerTokens.filter((token) => perToken.get(token) !== 1);
  const offline = emitted.filter((entry) => entry.token !== null && !entry.live);
  const offlineNotOnce = offline.filter((entry) => perToken.get(entry.token!) !== 1);
  const nonTriggerScopes = emitted
    .filter((entry) => entry.token === null)
    .map((entry) => instrumentation.scopes.get(entry.id))
    .filter((scope): scope is EventScope => Boolean(scope));
  const nonTriggerQueryEvents = nonTriggerScopes.filter((scope) => scope.queries > 0);
  const postBurstDrain = await drainAgentQueue(db, fixture.agentId, 180_000);
  const runs = await db
    .select({
      contextSnapshot: heartbeatRuns.contextSnapshot,
      startedAt: heartbeatRuns.startedAt,
      createdAt: heartbeatRuns.createdAt,
      finishedAt: heartbeatRuns.finishedAt,
      status: heartbeatRuns.status,
      error: heartbeatRuns.error,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.agentId, fixture.agentId), gte(heartbeatRuns.createdAt, new Date(start))));
  const runOutcomes = new Map<string, { count: number; maxMs: number; minMs: number; errors: Set<string> }>();
  for (const run of runs) {
    const context = (run.contextSnapshot ?? {}) as { issueId?: unknown; openwa?: { triggerClass?: unknown } };
    const key = String(context.issueId).slice(0, 8) + "|" + String(context.openwa?.triggerClass ?? "-") + "|" + run.status;
    const durationMs = run.finishedAt && run.startedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : -1;
    const entry = runOutcomes.get(key) ?? { count: 0, maxMs: -Infinity, minMs: Infinity, errors: new Set<string>() };
    entry.count++;
    entry.maxMs = Math.max(entry.maxMs, durationMs);
    entry.minMs = Math.min(entry.minMs, durationMs);
    if (run.error && entry.errors.size < 3) entry.errors.add(String(run.error).slice(0, 160));
    runOutcomes.set(key, entry);
  }
  const commentTokens = await commentTokenMap(db, fixture.companyId);
  const tokenIssue = new Map<number, string>();
  const commentIds = [...commentTokens.keys()];
  const commentRows = commentIds.length
    ? await db
        .select({ id: issueComments.id, issueId: issueComments.issueId })
        .from(issueComments)
        .where(and(eq(issueComments.companyId, fixture.companyId), inArray(issueComments.id, commentIds)))
    : [];
  for (const row of commentRows) tokenIssue.set(commentTokens.get(row.id)!, row.issueId);
  const windowMs = options.runMs;
  const pairWindows = new Map<string, Set<number>>();
  for (const token of triggerTokens) {
    const commit = instrumentation.commits.get(token);
    const issueId = tokenIssue.get(token);
    if (commit === undefined || !issueId) continue;
    const pair = issueId + "|" + (tokenClass.get(token) ?? "other");
    let entry = pairWindows.get(pair);
    if (!entry) pairWindows.set(pair, (entry = new Set()));
    entry.add(Math.floor((commit - start) / windowMs));
  }
  const pairRuns = new Map<string, number>();
  const pairWindowRuns = new Map<string, number>();
  let openwaRuns = 0;
  for (const run of runs) {
    const context = (run.contextSnapshot ?? {}) as {
      issueId?: unknown;
      paperclipOpenwa?: { triggerClass?: unknown };
      openwa?: { triggerClass?: unknown };
    };
    if (!context.paperclipOpenwa && !context.openwa) continue;
    openwaRuns++;
    const triggerClass = context.paperclipOpenwa?.triggerClass ?? context.openwa?.triggerClass ?? "other";
    const pair = String(context.issueId) + "|" + String(triggerClass);
    pairRuns.set(pair, (pairRuns.get(pair) ?? 0) + 1);
    const slot = pair + "|" + Math.floor(((run.startedAt ?? run.createdAt).getTime() - start) / windowMs);
    pairWindowRuns.set(slot, (pairWindowRuns.get(slot) ?? 0) + 1);
  }
  const violations = [...pairWindowRuns.entries()].filter(([, runs]) => runs > 1).map(([slot, runs]) => ({ slot, runs }));
  const starved = [...pairWindows.keys()].filter((pair) => !pairRuns.has(pair));
  const pairs = [...pairWindows.entries()].map(([pair, windows]) => ({ pair, runs: pairRuns.get(pair) ?? 0, windowsWithTriggers: windows.size }));
  const burstWakes = instrumentation.wakes.filter((wake) => wake.at >= start).length;
  const rssGrowthMb = Math.round(((rssAfter - rssBefore) / MiB) * 10) / 10;
  const result = {
    messages: total,
    triggers: triggerTokens.length,
    rateTarget: options.burstRate,
    emitDurationMs: Math.round(burstEnd - start),
    schedulerLagMs: summarize(lagSamples),
    settleMs: Math.round(settledAt - burstEnd),
    settleError,
    receiver: { lost: lost.length, duplicated: duplicated.length, lostSample: lost.slice(0, 5).map((entry) => entry.sequence) },
    reconnect: {
      killedAtMs: killedAt === null ? null : Math.round(killedAt),
      restoredAtMs: restoredAt === null ? null : Math.round(restoredAt),
      triggersWhileOffline: offline.length,
      offlineTriggersNotExactlyOnce: offlineNotOnce.length,
    },
    admission: { triggersNotExactlyOnce: triggersNotOnce.length, sample: triggersNotOnce.slice(0, 5) },
    wakes: {
      rule: "per burst window (= run duration): at most one run started per (conversation issue, trigger class); every pair with admitted triggers gets a run of its class once the agent queue has drained; earlier seams' leftover wakes are cancelled before the burst",
      heartbeatWakeupCalls: burstWakes,
      openwaRuns,
      queueBeforeBurst: { ...preBurstBacklog, cancelledLeftoverWakes: preBurstCancelled, drainMs: preBurstDrain.ms, error: preBurstDrain.error },
      queueAfterBurst: { drainMs: postBurstDrain.ms, error: postBurstDrain.error },
      windowMs,
      pairs,
      violations: violations.slice(0, 10),
      pairsWithTriggersButNoRunOfTheirClass: starved,
      runOutcomes: Object.fromEntries([...runOutcomes].map(([key, value]) => [key, { ...value, errors: [...value.errors] }])),
    },
    nonTriggerEventsWithQueries: { count: nonTriggerQueryEvents.length, of: nonTriggerScopes.length, sample: nonTriggerQueryEvents.slice(0, 3).map((scope) => scope.sql) },
    rss: { beforeMb: Math.round(rssBefore / MiB), afterMb: Math.round(rssAfter / MiB), growthMb: rssGrowthMb },
    heapUsedAfterGc: { beforeMb: Math.round(heapBefore / MiB), afterMb: Math.round(heapAfter / MiB), growthMb: Math.round(((heapAfter - heapBefore) / MiB) * 10) / 10 },
    memoryAtBurstStart: Object.fromEntries(Object.entries(memoryAtStart).map(([key, value]) => [key, Math.round(value / MiB)])),
    rssGrowthIncludingWarmupMb: Math.round(((rssAfter - memoryAtStart.rss) / MiB) * 10) / 10,
    memoryBefore: Object.fromEntries(Object.entries(memoryBefore).map(([key, value]) => [key, Math.round(value / MiB)])),
    memoryAfter: Object.fromEntries(Object.entries(memoryAfter).map(([key, value]) => [key, Math.round(value / MiB)])),
    memoryTimeline,
    ...(retainedAllocations ? { retainedAllocations } : {}),
  };
  const budgets: BudgetRow[] = [
    {
      seam: "Burst",
      metric: "lost / duplicated messages (sequence check)",
      value: lost.length + " / " + duplicated.length,
      budget: "0 / 0",
      status: !lost.length && !duplicated.length && !settleError ? "pass" : "fail",
      ...(settleError ? { evidence: settleError } : {}),
    },
    {
      seam: "Burst",
      metric: "windows with > 1 run for one (conversation, class)",
      value: violations.length,
      budget: "0",
      status: violations.length === 0 && openwaRuns > 0 ? "pass" : "fail",
      evidence: openwaRuns + " runs for " + burstWakes + " wake calls, window " + windowMs + " ms",
    },
    {
      seam: "Burst",
      metric: "(conversation, class) pairs with triggers but no run of that class",
      value: starved.length,
      budget: "0",
      status: starved.length === 0 && !preBurstDrain.error && !postBurstDrain.error ? "pass" : "fail",
      evidence: [
        "before burst: " + preBurstCancelled + " leftover wakes cancelled, " + preBurstBacklog.runs + " runs drained in " + preBurstDrain.ms + " ms; after burst: queue drained in " + postBurstDrain.ms + " ms",
        preBurstDrain.error,
        postBurstDrain.error,
        starved.length ? "spec 7.2: classes never share a wake" : null,
      ].filter(Boolean).join("; "),
    },
    {
      seam: "Burst",
      metric: "RSS growth MB",
      value: rssGrowthMb,
      budget: "< 50",
      status: rssGrowthMb < 50 ? "pass" : "fail",
      evidence:
        "after " + options.burstWarmupSeconds + " s warm-up; heapUsed after GC " + Math.round(heapBefore / MiB) + " -> " + Math.round(heapAfter / MiB) + " MB; RSS incl. warm-up +" +
        Math.round((rssAfter - memoryAtStart.rss) / MiB) + " MB",
    },
    {
      seam: "Burst",
      metric: "non-trigger events with DB queries",
      value: nonTriggerQueryEvents.length + "/" + nonTriggerScopes.length,
      budget: "0",
      status: nonTriggerQueryEvents.length === 0 ? "pass" : "fail",
    },
    {
      seam: "Reconnect",
      metric: "triggers not admitted exactly once",
      value: triggersNotOnce.length,
      budget: "0",
      status: triggersNotOnce.length === 0 && (options.killForSeconds === 0 || offline.length > 0) ? "pass" : "fail",
      evidence: offline.length + " triggers sent while the socket was down",
    },
  ];
  return { result, budgets };
}

function printTable(budgets: BudgetRow[], results: Record<string, unknown>): void {
  const rows = budgets.map((row) => [row.seam, row.metric, row.value === null ? "-" : String(row.value), row.budget, row.status, row.evidence ?? ""]);
  const header = ["Seam", "Metric", "Value", "Budget", "Status", "Evidence"];
  const widths = header.map((title, column) => Math.min(70, Math.max(title.length, ...rows.map((row) => row[column]!.length))));
  const line = (cells: string[]) => "| " + cells.map((cell, column) => cell.slice(0, widths[column]).padEnd(widths[column]!)).join(" | ") + " |";
  console.log(line(header));
  console.log("|" + widths.map((width) => "-".repeat(width + 2)).join("|") + "|");
  for (const row of rows) console.log(line(row));
  if (results.error) console.log("\nBenchmark error:\n" + String(results.error));
}
