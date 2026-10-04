import { afterEach, describe, expect, it } from "vitest";
import { createOpenwaGatewayClient } from "../../services/openwa/gateway.js";
import {
  createOpenwaEventSocket,
  OpenwaReceiver,
  type OpenwaIngressEvent,
} from "../../services/openwa/receiver.js";
import { OpenwaState, readOpenwaCursor, writeOpenwaCursor } from "../../services/openwa/state.js";
import { memoryPersistence } from "../photon/fixture.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000111";
const PEER = "628222000222@c.us";

async function until(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function sequenceOf(event: OpenwaIngressEvent): number {
  return Number(String(event.data.body).replace("seq:", ""));
}

describe("OpenWA receiver", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function harness(options: { liveBufferLimit?: number; restLatencyMs?: number; intakeAfter?: number; seed?: (gateway: FakeOpenwaGateway, state: OpenwaState) => Promise<void> } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE, restLatencyMs: options.restLatencyMs });
    await gateway.start();
    cleanups.push(() => gateway.close());
    const state = new OpenwaState({ companyId: "c", endpointId: "e" }, memoryPersistence());
    await options.seed?.(gateway, state);
    const admitted: Array<{ event: OpenwaIngressEvent; key: string | null }> = [];
    const failures: unknown[] = [];
    let live = 0;
    const receiver = new OpenwaReceiver({
      gateway: createOpenwaGatewayClient({ baseUrl: gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID }),
      socket: createOpenwaEventSocket({ baseUrl: gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, reconnectDelayMs: 20, reconnectDelayMaxMs: 100 }),
      state,
      sessionId: SESSION_ID,
      intakeAfter: options.intakeAfter ?? 0,
      liveBufferLimit: options.liveBufferLimit,
      assertOwned: async () => {},
      admit: async (event, key) => {
        admitted.push({ event, key });
      },
      failure: async (error) => {
        failures.push(error);
      },
      live: async () => {
        live++;
      },
    });
    cleanups.push(() => receiver.close());
    return { gateway, state, receiver, admitted, failures, liveCount: () => live };
  }

  it("subscribes to the spec event set with the operator key", async () => {
    const h = await harness();
    h.receiver.start();
    await until(() => h.liveCount() === 1);
    expect(h.gateway.subscriptions).toEqual([
      {
        sessionId: SESSION_ID,
        events: [
          "message.received",
          "message.sent",
          "message.ack",
          "message.revoked",
          "message.edited",
          "message.reaction",
          "group.join",
          "group.leave",
          "group.update",
          "session.status",
          "session.restriction",
        ],
      },
    ]);
  });

  it("processes every message exactly once across a mid-stream socket kill, including stored rows without a waMessageId", async () => {
    const h = await harness();
    h.receiver.start();
    await until(() => h.liveCount() === 1);
    for (let i = 0; i < 20; i++) h.gateway.inbound({ chatId: PEER });
    await until(() => h.admitted.length === 20);
    h.gateway.killSocket();
    const idless: string[] = [];
    for (let i = 0; i < 10; i++) {
      const row = h.gateway.inbound({ chatId: PEER, emit: false, ...(i === 3 || i === 7 ? { waMessageId: null } : {}) });
      if (row.waMessageId === null) idless.push(row.id);
    }
    h.gateway.restartSocket();
    await until(() => h.liveCount() === 2);
    for (let i = 0; i < 10; i++) h.gateway.inbound({ chatId: PEER });
    await until(() => h.admitted.length >= 40);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sequences = h.admitted.map((entry) => sequenceOf(entry.event));
    expect(sequences).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(h.admitted.slice(20, 30).every((entry) => entry.event.source === "catch_up")).toBe(true);
    expect(h.admitted.slice(30).every((entry) => entry.event.source === "live")).toBe(true);
    const idlessKeys = h.admitted.filter((entry) => entry.event.data.id === null).map((entry) => entry.key);
    expect(idlessKeys).toEqual(idless.map((id) => "openwa:" + SESSION_ID + ":row:" + id));
    expect(new Set(h.admitted.map((entry) => entry.key)).size).toBe(40);
    expect(h.failures).toEqual([]);
  });

  it("drops an overflowing live buffer and rewalks storage without loss or duplicates", async () => {
    const h = await harness({ liveBufferLimit: 5, restLatencyMs: 150 });
    h.receiver.start();
    await h.gateway.waitForSubscription();
    for (let i = 0; i < 12; i++) h.gateway.inbound({ chatId: PEER });
    await until(() => h.liveCount() === 1);
    for (let i = 0; i < 3; i++) h.gateway.inbound({ chatId: PEER });
    await until(() => h.admitted.length >= 15);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.receiver.stats.bufferOverflows).toBe(1);
    expect(h.admitted.map((entry) => sequenceOf(entry.event))).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
  });

  it("stops the backward walk at the stored cursor and ignores rows older than 24 hours", async () => {
    const now = Math.floor(Date.now() / 1000);
    let cursorRow = "";
    const h = await harness({
      seed: async (gateway, state) => {
        gateway.inbound({ chatId: PEER, emit: false, timestamp: now - 3 * 24 * 3600 });
        gateway.inbound({ chatId: PEER, emit: false, timestamp: now - 25 * 3600 });
        const row = gateway.inbound({ chatId: PEER, emit: false, timestamp: now - 25 * 3600 + 1 });
        cursorRow = row.waMessageId!;
        await writeOpenwaCursor(state, SESSION_ID, { schema: 1, sessionId: SESSION_ID, waMessageId: row.waMessageId!, rowId: row.id, timestamp: row.timestamp! });
        gateway.inbound({ chatId: PEER, emit: false, timestamp: now - 23 * 3600 });
        gateway.inbound({ chatId: PEER, emit: false, timestamp: now - 10 });
      },
    });
    expect(cursorRow).not.toBe("");
    h.receiver.start();
    await until(() => h.liveCount() === 1);
    expect(h.admitted.map((entry) => sequenceOf(entry.event))).toEqual([4, 5]);
  });

  it("caps one catch-up at 2000 rows", async () => {
    const h = await harness({
      seed: async (gateway) => {
        for (let i = 0; i < 2_050; i++) gateway.inbound({ chatId: PEER, emit: false });
      },
    });
    h.receiver.start();
    await until(() => h.liveCount() === 1, 30_000);
    expect(h.admitted).toHaveLength(2_000);
    expect(sequenceOf(h.admitted[0].event)).toBe(51);
    expect(h.receiver.stats.truncatedCatchUps).toBe(1);
    const pages = h.gateway.requests.filter((request) => request.path.endsWith("/messages"));
    expect(pages.every((request) => request.query.limit === "100" && request.query.inlineMedia === "false")).toBe(true);
  }, 40_000);

  it("throttles cursor writes to one per 200 events and flushes on close", async () => {
    const h = await harness();
    h.receiver.start();
    await until(() => h.liveCount() === 1);
    for (let i = 0; i < 450; i++) h.gateway.inbound({ chatId: PEER });
    await until(() => h.admitted.length === 450);
    expect(h.receiver.stats.cursorCommits).toBe(2);
    await h.receiver.close();
    expect(h.receiver.stats.cursorCommits).toBe(3);
    const cursor = await readOpenwaCursor(h.state, SESSION_ID);
    expect(cursor?.waMessageId).toBe(h.admitted.at(-1)!.event.data.id);
  });

  it("restarts the walk when the gateway rejects a page cursor that disappeared", async () => {
    const h = await harness({
      seed: async (gateway) => {
        for (let i = 0; i < 150; i++) gateway.inbound({ chatId: PEER, emit: false });
      },
      restLatencyMs: 50,
    });
    h.receiver.start();
    await until(() => h.gateway.requests.some((request) => request.path.endsWith("/messages")));
    h.gateway.rows.splice(h.gateway.rows.length - 100, 1);
    await until(() => h.liveCount() === 1);
    expect(h.failures).toEqual([]);
    expect(new Set(h.admitted.map((entry) => entry.key)).size).toBe(h.admitted.length);
    expect(h.admitted.length).toBe(149);
  });

  it("halts without admitting when the event socket is refused for credentials", async () => {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    cleanups.push(() => gateway.close());
    const failures: unknown[] = [];
    const receiver = new OpenwaReceiver({
      gateway: createOpenwaGatewayClient({ baseUrl: gateway.baseUrl, apiKey: "wrong", sessionId: SESSION_ID }),
      socket: createOpenwaEventSocket({ baseUrl: gateway.baseUrl, apiKey: "wrong", reconnectDelayMs: 20 }),
      state: new OpenwaState({ companyId: "c", endpointId: "e" }, memoryPersistence()),
      sessionId: SESSION_ID,
      intakeAfter: 0,
      assertOwned: async () => {},
      admit: async () => {
        throw new Error("must not admit");
      },
      failure: async (error) => {
        failures.push(error);
      },
    });
    cleanups.push(() => receiver.close());
    receiver.start();
    await until(() => failures.length === 1);
    expect((failures[0] as { code?: string; fatal?: boolean }).code).toBe("credentials");
    expect((failures[0] as { fatal?: boolean }).fatal).toBe(true);
  });
});
