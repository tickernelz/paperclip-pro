import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TerminalServerFrame } from "@tickernelz/paperclip-pro-shared";
import type { LogActivityInput } from "../services/activity-log.js";
import type { TerminalActor } from "../services/terminal/access.js";
import { localTerminalFiles } from "../services/terminal/files.js";
import { TerminalSessionManager } from "../services/terminal/manager.js";
import type { TerminalOriginPolicy } from "../services/terminal/origin.js";
import { spawnLocalTerminal } from "../services/terminal/process.js";
import { setupTerminalWebSocketServer } from "./terminal-ws.js";

interface ClientSocket {
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "open", listener: () => void): void;
  on(event: "close", listener: (code: number) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  send(data: string): void;
  close(): void;
}

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws") as {
  WebSocket: new (url: string, options?: { origin?: string; headers?: Record<string, string> }) => ClientSocket;
};

const COMPANY_ID = "company-a";
const USER_ID = "user-1";

const policy: TerminalOriginPolicy = {
  deploymentMode: "authenticated",
  allowedHostnames: [],
  bindHost: "127.0.0.1",
  listenPort: 0,
  hostnameGuardEnabled: true,
  publicBaseUrls: [],
};

const AUTH_SESSION_ID = "auth-session-1";

describe("terminal websocket", () => {
  let server: Server;
  let manager: TerminalSessionManager;
  let port: number;
  let workDir: string;
  let actors: Map<string, TerminalActor>;
  let activity: LogActivityInput[];
  let liveAuthSessions: Set<string>;
  let runRecheck: () => Promise<void>;

  beforeEach(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), "terminal-ws-"));
    manager = new TerminalSessionManager({ reapIntervalMs: 0 });
    actors = new Map([
      [
        USER_ID,
        {
          type: "board",
          source: "session",
          userId: USER_ID,
          isInstanceAdmin: true,
          companyIds: [COMPANY_ID],
          memberships: [{ companyId: COMPANY_ID, membershipRole: "owner", status: "active" }],
        },
      ],
    ]);
    activity = [];
    liveAuthSessions = new Set([AUTH_SESSION_ID]);
    server = createServer();
    setupTerminalWebSocketServer(server, {
      manager,
      authTimeoutMs: 500,
      originPolicy: policy,
      loadActor: async ({ userId, authSessionId }) => {
        if (!userId || !authSessionId || !liveAuthSessions.has(authSessionId)) return null;
        return actors.get(userId) ?? null;
      },
      recordActivity: async (input) => {
        activity.push(input);
      },
      scheduleRecheck: (run) => {
        runRecheck = run;
        return () => undefined;
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    policy.listenPort = port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    manager.shutdown();
    rmSync(workDir, { recursive: true, force: true });
  });

  function connect(origin: string | null = `http://127.0.0.1:${port}`) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/ws`, origin ? { origin } : {});
    const frames: TerminalServerFrame[] = [];
    const waiters: Array<() => void> = [];
    let closeCode: number | null = null;
    let failure: Error | null = null;
    const wake = () => {
      for (const waiter of waiters.splice(0)) waiter();
    };
    socket.on("message", (data) => {
      frames.push(JSON.parse(data.toString("utf8")) as TerminalServerFrame);
      wake();
    });
    socket.on("close", (code) => {
      closeCode = code;
      wake();
    });
    const opened = new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", (err) => {
        failure = err;
        wake();
        reject(err);
      });
    });
    async function waitFor(predicate: () => boolean, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out; frames=${JSON.stringify(frames).slice(0, 2000)}`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 100);
        });
      }
    }
    return { socket, frames, opened, waitFor, closeCode: () => closeCode, failure: () => failure };
  }

  function startShell() {
    return manager.register({
      companyId: COMPANY_ID,
      kind: "local",
      title: "sh",
      cwd: workDir,
      issueId: null,
      environmentId: null,
      cols: 80,
      rows: 24,
      createdByUserId: USER_ID,
      process: spawnLocalTerminal({ cwd: workDir, cols: 80, rows: 24, shell: "/bin/sh", args: [] }),
      files: localTerminalFiles(workDir),
    });
  }

  function mint(sessionId: string) {
    return manager.mintAttachToken(COMPANY_ID, sessionId, {
      userId: USER_ID,
      actorSource: "session",
      authSessionId: AUTH_SESSION_ID,
    })!.token;
  }

  async function attach(sessionId: string) {
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: "auth", token: mint(sessionId) }));
    await client.waitFor(() => client.frames.some((frame) => frame.type === "replay"));
    return client;
  }

  it("runs a real pty round trip with resize, replay on reattach and an attach activity entry", async () => {
    const session = startShell();
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: "auth", token: mint(session.id) }));
    client.socket.send(JSON.stringify({ type: "resize", cols: 90, rows: 33 }));
    await client.waitFor(() => client.frames.some((frame) => frame.type === "replay"));
    expect(client.frames[0]).toMatchObject({ type: "ready", session: { id: session.id } });
    expect(client.frames[1]?.type).toBe("replay");
    await client.waitFor(() => activity.length === 1);
    expect(activity[0]).toMatchObject({
      companyId: COMPANY_ID,
      actorType: "user",
      actorId: USER_ID,
      action: "terminal.session_attached",
      entityType: "terminal_session",
      entityId: session.id,
    });

    client.socket.send(JSON.stringify({ type: "input", data: "echo terminal-$((40+2)); stty size\r" }));
    const output = () =>
      client.frames
        .filter((frame): frame is Extract<TerminalServerFrame, { type: "output" }> => frame.type === "output")
        .map((frame) => frame.data)
        .join("");
    await client.waitFor(() => output().includes("terminal-42") && output().includes("33 90"));

    client.socket.send(JSON.stringify({ type: "ping" }));
    await client.waitFor(() => client.frames.some((frame) => frame.type === "pong"));
    client.socket.close();

    const second = await attach(session.id);
    const replay = second.frames.find((frame) => frame.type === "replay") as { data: string };
    expect(replay.data).toContain("terminal-42");

    second.socket.send(JSON.stringify({ type: "input", data: "exit 7\r" }));
    await second.waitFor(() => second.frames.some((frame) => frame.type === "exit"));
    expect(second.frames.find((frame) => frame.type === "exit")).toEqual({ type: "exit", exitCode: 7, signal: null });
    second.socket.close();
  });

  it("applies a resize sent before auth", async () => {
    const session = startShell();
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: "resize", cols: 91, rows: 31 }));
    client.socket.send(JSON.stringify({ type: "auth", token: mint(session.id) }));
    await client.waitFor(() => client.frames.some((frame) => frame.type === "ready"));
    expect(client.frames[0]).toMatchObject({ type: "ready", session: { cols: 91, rows: 31 } });
    client.socket.close();
  });

  it("rejects a reused token", async () => {
    const session = startShell();
    const token = mint(session.id);
    const first = connect();
    await first.opened;
    first.socket.send(JSON.stringify({ type: "auth", token }));
    await first.waitFor(() => first.frames.some((frame) => frame.type === "ready"));

    const reused = connect();
    await reused.opened;
    reused.socket.send(JSON.stringify({ type: "auth", token }));
    await reused.waitFor(() => reused.closeCode() !== null);
    expect(reused.frames).toEqual([{ type: "error", code: "auth_failed", message: "Terminal authentication failed" }]);
    expect(reused.closeCode()).toBe(1008);
    first.socket.close();
  });

  it("closes a socket that never authenticates", async () => {
    const client = connect();
    await client.opened;
    await client.waitFor(() => client.closeCode() !== null);
    expect(client.frames).toEqual([{ type: "error", code: "auth_timeout", message: "Terminal authentication timed out" }]);
    expect(client.closeCode()).toBe(1008);
  });

  it("closes with 1008 on any pre-auth frame other than auth or resize", async () => {
    const session = startShell();
    for (const frame of [{ type: "input", data: "id\r" }, { type: "ping" }, "not json"]) {
      const client = connect();
      await client.opened;
      client.socket.send(typeof frame === "string" ? frame : JSON.stringify(frame));
      await client.waitFor(() => client.closeCode() !== null);
      expect(client.closeCode()).toBe(1008);
      expect(client.frames[0]).toMatchObject({ type: "error", code: "bad_frame" });
    }
    expect(manager.get(COMPANY_ID, session.id)?.attachedClients).toBe(0);
  });

  it("closes with 1009 on an oversized pre-auth frame", async () => {
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: "auth", token: "x".repeat(17 * 1024) }));
    await client.waitFor(() => client.closeCode() !== null);
    expect(client.closeCode()).toBe(1009);
  });

  it("rejects a foreign or missing Origin before the upgrade", async () => {
    for (const origin of ["https://evil.example", null]) {
      const client = connect(origin);
      await expect(client.opened).rejects.toThrow(/403/);
    }
  });

  it("rejects a same-origin request whose Host is not an allowed hostname", async () => {
    const host = `rebind.evil.example:${port}`;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/ws`, { origin: `http://${host}`, headers: { host } });
    const error = await new Promise<Error>((resolve) => socket.on("error", resolve));
    expect(error.message).toMatch(/403/);
  });

  it("closes an attached socket when the user loses access on the periodic re-check", async () => {
    const session = startShell();
    const client = await attach(session.id);

    await runRecheck();
    client.socket.send(JSON.stringify({ type: "ping" }));
    await client.waitFor(() => client.frames.some((frame) => frame.type === "pong"));
    expect(client.closeCode()).toBeNull();

    actors.set(USER_ID, { ...actors.get(USER_ID)!, isInstanceAdmin: false });
    await runRecheck();
    await client.waitFor(() => client.closeCode() !== null);
    expect(client.closeCode()).toBe(1008);
    expect(client.frames.at(-1)).toEqual({ type: "error", code: "forbidden", message: "Instance admin access required" });
    expect(manager.get(COMPANY_ID, session.id)?.attachedClients).toBe(0);
  });

  it("refuses the attach immediately when access was lost after the token was minted", async () => {
    const session = startShell();
    const token = mint(session.id);
    actors.set(USER_ID, { ...actors.get(USER_ID)!, isInstanceAdmin: false });
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: "auth", token }));
    await client.waitFor(() => client.closeCode() !== null, 2_000);
    expect(client.closeCode()).toBe(1008);
    expect(client.frames).toEqual([{ type: "error", code: "forbidden", message: "Instance admin access required" }]);
    expect(manager.get(COMPANY_ID, session.id)?.attachedClients).toBe(0);
    expect(activity).toEqual([]);
  });

  it("refuses the attach when the login session behind the token is gone", async () => {
    const session = startShell();
    const token = mint(session.id);
    liveAuthSessions.clear();
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: "auth", token }));
    await client.waitFor(() => client.closeCode() !== null, 2_000);
    expect(client.closeCode()).toBe(1008);
    expect(client.frames[0]).toMatchObject({ type: "error", code: "forbidden" });
  });

  it("closes an attached socket when its login session is revoked", async () => {
    const session = startShell();
    const client = await attach(session.id);
    await runRecheck();
    expect(client.closeCode()).toBeNull();
    liveAuthSessions.delete(AUTH_SESSION_ID);
    await runRecheck();
    await client.waitFor(() => client.closeCode() !== null);
    expect(client.closeCode()).toBe(1008);
    expect(client.frames.at(-1)).toMatchObject({ type: "error", code: "forbidden" });
  });

  it("closes an attached socket when the membership is removed", async () => {
    const session = startShell();
    const client = await attach(session.id);
    actors.set(USER_ID, { ...actors.get(USER_ID)!, companyIds: [], memberships: [] });
    await runRecheck();
    await client.waitFor(() => client.closeCode() !== null);
    expect(client.closeCode()).toBe(1008);
    expect(client.frames.at(-1)).toMatchObject({ type: "error", code: "forbidden" });
  });

  it("leaves upgrades for other paths to later handlers", async () => {
    let seenByNext = false;
    server.on("upgrade", (req, socket) => {
      if ((req as { paperclipWebSocketHandled?: boolean }).paperclipWebSocketHandled) return;
      seenByNext = true;
      socket.destroy();
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/companies/x/events/ws`);
    await new Promise<void>((resolve) => {
      socket.on("error", () => resolve());
      socket.on("close", () => resolve());
    });
    expect(seenByNext).toBe(true);
  });
});
