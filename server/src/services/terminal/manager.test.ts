import headless from "@xterm/headless";
import { describe, expect, it } from "vitest";
import type { TerminalServerFrame } from "@tickernelz/paperclip-pro-shared";
import { localTerminalFiles } from "./files.js";
import { TerminalSessionManager } from "./manager.js";
import type { TerminalExit, TerminalProcess } from "./process.js";
import { TerminalScreen } from "./screen.js";

const { Terminal } = headless;

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

function setup(
  options: { idleKillMs?: number; tokenTtlMs?: number; scrollbackRows?: number; cols?: number; rows?: number } = {},
) {
  let now = 1_000_000;
  const clock = { now: () => now };
  const { cols = 80, rows = 24, ...rest } = options;
  const manager = new TerminalSessionManager({ clock, reapIntervalMs: 0, ...rest });
  const process = new FakeProcess();
  const session = manager.register({
    companyId: "company-a",
    kind: "local",
    title: "t",
    cwd: "/tmp",
    issueId: null,
    environmentId: null,
    cols,
    rows,
    createdByUserId: "user-1",
    process,
    files: localTerminalFiles("/tmp"),
  });
  return { manager, process, session, advance: (ms: number) => (now += ms) };
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function render(data: string, cols: number, rows: number) {
  const terminal = new Terminal({ cols, rows, scrollback: 100, allowProposedApi: true });
  terminal.reset();
  await new Promise<void>((resolve) => terminal.write(data, resolve));
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < rows; index += 1)
    lines.push(buffer.getLine(buffer.baseY + index)?.translateToString(true) ?? "");
  const result = { lines, text: lines.join("\n"), bufferType: buffer.type };
  terminal.dispose();
  return result;
}

function replayData(frames: TerminalServerFrame[]): string {
  const frame = frames.find((entry) => entry.type === "replay");
  return frame && frame.type === "replay" ? frame.data : "";
}

const paintRows = (count: number) =>
  Array.from({ length: count }, (_, index) => `\x1b[${index + 1};1H\x1b[32mPAINT-ROW-${index + 1}\x1b[0m`).join("");

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

  it("replays the screen on attach and broadcasts output and exit to every client", async () => {
    const { manager, process, session } = setup();
    process.emit("before attach\r\n");
    const a: TerminalServerFrame[] = [];
    const b: TerminalServerFrame[] = [];
    manager.attach("company-a", session.id, { send: (frame) => a.push(frame) });
    manager.attach("company-a", session.id, { send: (frame) => b.push(frame) });
    await waitFor(() => a.length >= 2 && b.length >= 2, "both replays");
    expect(a.map((frame) => frame.type)).toEqual(["ready", "replay"]);
    expect((await render(replayData(a), 80, 24)).text).toContain("before attach");
    process.emit("live\r\n");
    process.exit(3);
    await waitFor(() => a.some((frame) => frame.type === "exit"), "exit frames");
    for (const frames of [a, b]) {
      expect(frames.slice(-2)).toEqual([
        { type: "output", data: "live\r\n" },
        { type: "exit", exitCode: 3, signal: null },
      ]);
    }
    expect(manager.get("company-a", session.id)).toMatchObject({ status: "exited", exitCode: 3, attachedClients: 2 });
  });

  it("restores every painted row after megabytes of diff-only updates", async () => {
    const { manager, process, session } = setup({ cols: 100, rows: 50 });
    process.emit(`\x1b[2J\x1b[H${paintRows(40)}`);
    for (let batch = 0; batch < 10; batch += 1) {
      let chunk = "";
      for (let step = 0; step < 300; step += 1) {
        chunk += `\x1b[50;1H\x1b[2Kstatus ${batch * 300 + step} streaming tokens`;
      }
      process.emit(chunk);
    }
    const frames: TerminalServerFrame[] = [];
    manager.attach("company-a", session.id, { send: (frame) => frames.push(frame) });
    await waitFor(() => frames.some((frame) => frame.type === "replay"), "replay");
    const screen = await render(replayData(frames), 100, 50);
    for (let row = 1; row <= 40; row += 1) expect(screen.lines[row - 1]).toContain(`PAINT-ROW-${row}`);
    expect(screen.lines[49]).toContain("status 2999");
  });

  it("restores an alternate-screen application in the alternate buffer", async () => {
    const { manager, process, session } = setup({ cols: 100, rows: 50 });
    process.emit(`\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[2J\x1b[H${paintRows(30)}`);
    const frames: TerminalServerFrame[] = [];
    manager.attach("company-a", session.id, { send: (frame) => frames.push(frame) });
    await waitFor(() => frames.some((frame) => frame.type === "replay"), "replay");
    const screen = await render(replayData(frames), 100, 50);
    expect(screen.bufferType).toBe("alternate");
    for (let row = 1; row <= 30; row += 1) expect(screen.lines[row - 1]).toContain(`PAINT-ROW-${row}`);
  });

  it("delivers output that arrives during attach exactly once and only after the replay", async () => {
    const { manager, process, session } = setup();
    process.emit("alpha\r\n");
    const frames: TerminalServerFrame[] = [];
    manager.attach("company-a", session.id, { send: (frame) => frames.push(frame) });
    process.emit("bravo\r\n");
    process.emit("charlie\r\n");
    process.exit(0);
    await waitFor(() => frames.some((frame) => frame.type === "exit"), "exit");
    const replayIndex = frames.findIndex((frame) => frame.type === "replay");
    expect(replayIndex).toBeGreaterThan(-1);
    const firstOutput = frames.findIndex((frame) => frame.type === "output");
    if (firstOutput !== -1) expect(firstOutput).toBeGreaterThan(replayIndex);
    const stream = frames
      .slice(replayIndex)
      .map((frame) => (frame.type === "replay" || frame.type === "output" ? frame.data : ""))
      .join("");
    const lines = (await render(stream, 80, 24)).lines;
    for (const marker of ["alpha", "bravo", "charlie"]) {
      expect(lines.filter((line) => line === marker)).toEqual([marker]);
    }
  });

  it("replays the final screen of an exited session", async () => {
    const { manager, process, session } = setup();
    process.emit("final output\r\n");
    process.exit(0);
    process.exit(0);
    const frames: TerminalServerFrame[] = [];
    manager.attach("company-a", session.id, { send: (frame) => frames.push(frame) });
    await waitFor(() => frames.some((frame) => frame.type === "exit"), "exit");
    expect((await render(replayData(frames), 80, 24)).text).toContain("final output");
    expect(frames.filter((frame) => frame.type === "exit")).toHaveLength(1);
  });

  it("clamps resize to the contract bounds and reflows the stored screen", async () => {
    const { manager, process, session } = setup();
    manager.resize("company-a", session.id, 99_999, 0);
    expect(process.resized).toEqual([[1000, 1]]);
    process.emit("wrapped\r\n");
    await waitFor(() => manager.get("company-a", session.id)?.cols === 1000, "resize");
  });
});

describe("TerminalScreen", () => {
  it("replays scrollable history and drops rows past the retained window", async () => {
    const screen = new TerminalScreen(20, 5, 10);
    for (let index = 0; index < 100; index += 1) await screen.write(`#${index}#\r\n`);
    const lines = (await render(screen.serialize(), 20, 5)).lines.join("\n");
    expect(lines).toContain("#99#");
    expect(lines).not.toContain("#0#");
    screen.dispose();
  });

  it("serializes state after every write has been parsed", async () => {
    const screen = new TerminalScreen(20, 5, 10);
    const pending = [screen.write("one\r\n"), screen.write("two\r\n")];
    await Promise.all(pending);
    expect(screen.serialize()).toContain("two");
    screen.dispose();
  });

  it("stops accepting writes once disposed", async () => {
    const screen = new TerminalScreen(20, 5, 10);
    screen.dispose();
    await expect(screen.write("ignored")).resolves.toBeUndefined();
    expect(screen.serialize()).toBe("");
  });
});
