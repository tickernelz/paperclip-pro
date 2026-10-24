import { describe, expect, it } from "vitest";
import type { TerminalServerFrame } from "@tickernelz/paperclip-pro-shared";
import { localTerminalFiles } from "./files.js";
import { TerminalSessionManager } from "./manager.js";
import type { TerminalExit, TerminalProcess } from "./process.js";
import { TerminalScrollback } from "./scrollback.js";

class FakeProcess implements TerminalProcess {
  killed = false;
  resized: Array<[number, number]> = [];
  dataListeners: Array<(data: string) => void> = [];
  exitListeners: Array<(exit: TerminalExit) => void> = [];
  write() {}
  resize(cols: number, rows: number) {
    this.resized.push([cols, rows]);
  }
  kill() {
    this.killed = true;
  }
  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
  }
  onExit(listener: (exit: TerminalExit) => void) {
    this.exitListeners.push(listener);
  }
  emit(data: string) {
    for (const listener of this.dataListeners) listener(data);
  }
  exit(code: number | null, signal: string | null = null) {
    for (const listener of this.exitListeners) listener({ exitCode: code, signal });
  }
}

const holder = { userId: "user-1", actorSource: "session", authSessionId: "auth-1" };

function setup(options: { idleKillMs?: number; tokenTtlMs?: number } = {}) {
  let now = 1_000_000;
  const clock = { now: () => now };
  const manager = new TerminalSessionManager({ clock, reapIntervalMs: 0, ...options });
  const process = new FakeProcess();
  const session = manager.register({
    companyId: "company-a",
    kind: "local",
    title: "t",
    cwd: "/tmp",
    issueId: null,
    environmentId: null,
    cols: 80,
    rows: 24,
    createdByUserId: "user-1",
    process,
    files: localTerminalFiles("/tmp"),
  });
  return { manager, process, session, advance: (ms: number) => (now += ms) };
}

describe("TerminalSessionManager", () => {
  it("kills a session only after the idle window with no attached clients", () => {
    const { manager, process, session, advance } = setup({ idleKillMs: 1000 });
    const frames: TerminalServerFrame[] = [];
    const attached = manager.attach("company-a", session.id, { send: (frame) => frames.push(frame) })!;
    advance(5000);
    expect(manager.reapIdle()).toEqual([]);
    attached.detach();
    advance(999);
    expect(manager.reapIdle()).toEqual([]);
    expect(process.killed).toBe(false);
    advance(1);
    expect(manager.reapIdle()).toEqual([session.id]);
    expect(process.killed).toBe(true);
    expect(manager.get("company-a", session.id)).toMatchObject({ status: "exited" });
    expect(manager.mintAttachToken("company-a", session.id, holder)).toBeNull();
    process.exit(null, "SIGHUP");
    expect(manager.get("company-a", session.id)).toBeNull();
  });

  it("keeps a killed session as exited until the process exit fires", () => {
    const { manager, process, session } = setup();
    const token = manager.mintAttachToken("company-a", session.id, holder)!;
    expect(manager.kill("company-a", session.id)).toMatchObject({ status: "exited" });
    expect(manager.list("company-a")).toHaveLength(1);
    expect(manager.consumeAttachToken(token.token)).toBeNull();
    expect(manager.kill("company-a", session.id)).toBeNull();
    expect(manager.capacityDenial("company-a", "user-1")).toBeNull();
    process.exit(null, "SIGHUP");
    expect(manager.list("company-a")).toEqual([]);
  });

  it("reaps a never-attached session after the idle window", () => {
    const { manager, process, advance } = setup({ idleKillMs: 500 });
    advance(499);
    expect(manager.reapIdle()).toHaveLength(0);
    advance(1);
    expect(manager.reapIdle()).toHaveLength(1);
    expect(process.killed).toBe(true);
  });

  it("makes attach tokens single-use, company-bound and expiring", () => {
    const { manager, session, advance } = setup({ tokenTtlMs: 60_000 });
    expect(manager.mintAttachToken("company-b", session.id, holder)).toBeNull();
    const first = manager.mintAttachToken("company-a", session.id, holder)!;
    expect(manager.consumeAttachToken(first.token)).toEqual({
      companyId: "company-a",
      sessionId: session.id,
      kind: "local",
      userId: "user-1",
      actorSource: "session",
      authSessionId: "auth-1",
    });
    expect(manager.consumeAttachToken(first.token)).toBeNull();

    const second = manager.mintAttachToken("company-a", session.id, holder)!;
    advance(60_000);
    expect(manager.consumeAttachToken(second.token)).toBeNull();
    expect(manager.consumeAttachToken("not-a-token")).toBeNull();
  });

  it("replays scrollback on attach and broadcasts output and exit to every client", () => {
    const { manager, process, session } = setup();
    process.emit("before attach\r\n");
    const a: TerminalServerFrame[] = [];
    const b: TerminalServerFrame[] = [];
    manager.attach("company-a", session.id, { send: (frame) => a.push(frame) });
    manager.attach("company-a", session.id, { send: (frame) => b.push(frame) });
    expect(a.map((frame) => frame.type)).toEqual(["ready", "replay"]);
    expect(a[1]).toEqual({ type: "replay", data: "before attach\r\n" });
    process.emit("live");
    process.exit(3);
    for (const frames of [a, b]) {
      expect(frames.slice(-2)).toEqual([
        { type: "output", data: "live" },
        { type: "exit", exitCode: 3, signal: null },
      ]);
    }
    expect(manager.get("company-a", session.id)).toMatchObject({ status: "exited", exitCode: 3, attachedClients: 2 });
  });

  it("clamps resize to the contract bounds", () => {
    const { manager, process, session } = setup();
    manager.resize("company-a", session.id, 99_999, 0);
    expect(process.resized).toEqual([[1000, 1]]);
  });
});

describe("TerminalScrollback", () => {
  it("keeps only the newest bytes within the limit", () => {
    const buffer = new TerminalScrollback(10);
    buffer.append("abcdef");
    buffer.append("ghij");
    buffer.append("klm");
    expect(buffer.read()).toBe("ghijklm");
    buffer.append("0123456789ABCDEF");
    expect(buffer.read()).toBe("6789ABCDEF");
    expect(buffer.byteLength).toBeLessThanOrEqual(10);
  });
});
