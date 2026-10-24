import express from "express";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isCompanyOwnerAgent,
  type CreateTerminalSshHostRequest,
  type TerminalSshHost,
} from "@tickernelz/paperclip-pro-shared";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import type { LogActivityInput } from "../services/activity-log.js";
import { runnerApiRestriction } from "../services/native-runtime/runner-api-policy.js";
import { localTerminalFiles } from "../services/terminal/files.js";
import { TerminalSessionManager, type TerminalSessionManagerOptions } from "../services/terminal/manager.js";
import type { TerminalOriginPolicy } from "../services/terminal/origin.js";
import type { TerminalExit, TerminalProcess } from "../services/terminal/process.js";
import { savedSshHostId, type TerminalSshHostStore } from "../services/terminal/ssh-hosts.js";
import { systemSshArgs } from "../services/terminal/system-ssh.js";
import { terminalRoutes } from "./terminal.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const ENVIRONMENT_ID = "55555555-5555-4555-8555-555555555555";
const SAVED_HOST_ID = "77777777-7777-4777-8777-000000000001";

type Actor = Express.Request["actor"];

const activeMemberships = [
  { companyId: COMPANY_ID, membershipRole: "owner", status: "active" },
  { companyId: OTHER_COMPANY_ID, membershipRole: "owner", status: "active" },
];

const adminActor: Actor = {
  type: "board",
  userId: "admin-1",
  sessionId: "auth-session-1",
  source: "session",
  isInstanceAdmin: true,
  companyIds: [COMPANY_ID, OTHER_COMPANY_ID],
  memberships: activeMemberships,
};

const memberActor: Actor = {
  type: "board",
  userId: "member-1",
  source: "session",
  isInstanceAdmin: false,
  companyIds: [COMPANY_ID],
  memberships: [{ companyId: COMPANY_ID, membershipRole: "owner", status: "active" }],
};

const localActor: Actor = {
  type: "board",
  userId: "local-board",
  source: "local_implicit",
  isInstanceAdmin: true,
};

const agentKeyActor: Actor = {
  type: "agent",
  agentId: "33333333-3333-4333-8333-333333333333",
  companyId: COMPANY_ID,
  agentRole: "engineer",
  agentStatus: "active",
  source: "agent_key",
  keyId: "key-1",
};

const ownerAgentActor: Actor = {
  type: "agent",
  agentId: "44444444-4444-4444-8444-444444444444",
  companyId: COMPANY_ID,
  agentRole: "ceo",
  agentStatus: "active",
  source: "agent_key",
  keyId: "key-2",
};

const boardKeyActor: Actor = { ...adminActor, source: "board_key" };

const viewerActor: Actor = {
  ...memberActor,
  memberships: [{ companyId: COMPANY_ID, membershipRole: "viewer", status: "active" }],
};

const localTrustedPolicy: TerminalOriginPolicy = {
  deploymentMode: "local_trusted",
  allowedHostnames: [],
  bindHost: "127.0.0.1",
  listenPort: 3100,
  hostnameGuardEnabled: false,
  publicBaseUrls: [],
};

const authenticatedPolicy: TerminalOriginPolicy = { ...localTrustedPolicy, deploymentMode: "authenticated" };

class FakeProcess implements TerminalProcess {
  killed = false;
  private exitListeners: Array<(exit: TerminalExit) => void> = [];
  write() {}
  resize() {}
  kill() {
    this.killed = true;
    this.finish({ exitCode: null, signal: "SIGHUP" });
  }
  onData() {}
  onExit(listener: (exit: TerminalExit) => void) {
    this.exitListeners.push(listener);
  }
  finish(exit: TerminalExit) {
    for (const listener of this.exitListeners.splice(0)) listener(exit);
  }
}

describe("terminal routes", () => {
  let workDir: string;
  let tempDir: string;
  let actor: Actor;
  let manager: TerminalSessionManager;
  let activity: LogActivityInput[];
  let processes: FakeProcess[];
  let failNextActivity: boolean;
  let configHosts: TerminalSshHost[];
  let savedHosts: TerminalSshHost[];
  let hostStarts: Array<{ host: TerminalSshHost; cols: number; rows: number }>;
  let hostCreators: Array<string | null>;

  function sshHostStore(): TerminalSshHostStore {
    return {
      list: async () => ({ hosts: [...configHosts, ...savedHosts], configPath: "/home/dev/.ssh/config", configError: null }),
      create: async (_companyId, input: CreateTerminalSshHostRequest, createdByUserId) => {
        if (savedHosts.some((host) => host.name === input.name)) return null;
        const created: TerminalSshHost = {
          id: savedSshHostId(`77777777-7777-4777-8777-${String(savedHosts.length + 1).padStart(12, "0")}`),
          source: "saved",
          name: input.name,
          destination: input.destination,
          port: input.port ?? null,
        };
        savedHosts.push(created);
        hostCreators.push(createdByUserId);
        return created;
      },
      remove: async (_companyId, hostId) => {
        const index = savedHosts.findIndex((host) => host.id === hostId);
        if (index < 0) return false;
        savedHosts.splice(index, 1);
        return true;
      },
      resolve: async (_companyId, hostId) =>
        [...configHosts, ...savedHosts].find((host) => host.id === hostId) ?? null,
    };
  }

  function createApp(policy: TerminalOriginPolicy = localTrustedPolicy) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    const start = (cwd: string) => {
      const process = new FakeProcess();
      processes.push(process);
      return { process, files: localTerminalFiles(cwd) };
    };
    app.use(
      "/api",
      terminalRoutes({} as Db, {
        originPolicy: policy,
        manager,
        resolveLocalCwd: async () => workDir,
        resolveSshTarget: async () => ({
          target: {
            host: "box.test",
            port: 22,
            username: "dev",
            privateKey: null,
            knownHosts: null,
            strictHostKeyChecking: true,
            remoteCwd: "/srv/work",
          },
          title: "dev@box.test",
        }),
        startLocal: ({ cwd }) => start(cwd),
        startSsh: async () => start(workDir),
        startHostSsh: (input) => {
          hostStarts.push(input);
          return start(workDir);
        },
        sshHosts: sshHostStore(),
        recordActivity: async (input) => {
          if (failNextActivity) {
            failNextActivity = false;
            throw new Error("activity store down");
          }
          activity.push(input);
        },
        uploadTempDir: tempDir,
      }),
    );
    app.use(errorHandler);
    return app;
  }

  function useManager(options: TerminalSessionManagerOptions) {
    manager.shutdown();
    manager = new TerminalSessionManager({ reapIntervalMs: 0, ...options });
  }

  const sessionsPath = (companyId = COMPANY_ID) => `/api/companies/${companyId}/terminal/sessions`;
  const sshHostsPath = (companyId = COMPANY_ID) => `/api/companies/${companyId}/terminal/ssh-hosts`;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), "terminal-route-cwd-"));
    tempDir = mkdtempSync(path.join(os.tmpdir(), "terminal-route-tmp-"));
    actor = adminActor;
    manager = new TerminalSessionManager({ reapIntervalMs: 0 });
    activity = [];
    processes = [];
    failNextActivity = false;
    configHosts = [
      { id: "config:web", source: "config", name: "web", destination: "deploy@10.0.0.5", port: 2222 },
    ];
    savedHosts = [];
    hostStarts = [];
    hostCreators = [];
  });

  afterEach(() => {
    manager.shutdown();
    rmSync(workDir, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lets an instance admin create, list and delete a local session with activity entries", async () => {
    const app = createApp();
    const created = await request(app).post(sessionsPath()).send({ kind: "local", cols: 100, rows: 30 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      companyId: COMPANY_ID,
      kind: "local",
      cwd: workDir,
      status: "running",
      cols: 100,
      rows: 30,
      createdByUserId: "admin-1",
    });

    const listed = await request(app).get(sessionsPath());
    expect(listed.status).toBe(200);
    expect(listed.body.map((session: { id: string }) => session.id)).toEqual([created.body.id]);

    const deleted = await request(app).delete(`${sessionsPath()}/${created.body.id}`);
    expect(deleted.status).toBe(204);
    expect(processes[0]?.killed).toBe(true);

    expect((await request(app).get(sessionsPath())).body).toEqual([]);
    expect(activity.map((entry) => entry.action)).toEqual(["terminal.session_created", "terminal.session_deleted"]);
    expect(activity[0]).toMatchObject({ companyId: COMPANY_ID, actorType: "user", actorId: "admin-1", entityType: "terminal_session" });
  });

  it("lets local_implicit create a local session", async () => {
    actor = localActor;
    const res = await request(createApp()).post(sessionsPath()).send({ kind: "local" });
    expect(res.status).toBe(201);
  });

  it("refuses local sessions to a non-admin company owner but lets them use ssh", async () => {
    const app = createApp();
    const adminLocal = await request(app).post(sessionsPath()).send({ kind: "local" });
    expect(adminLocal.status).toBe(201);

    actor = memberActor;
    const create = await request(app).post(sessionsPath()).send({ kind: "local" });
    expect(create.status).toBe(403);
    expect(create.body.error).toBe("Instance admin access required");
    const base = `${sessionsPath()}/${adminLocal.body.id}`;
    expect((await request(app).post(`${base}/token`)).status).toBe(403);
    expect((await request(app).delete(base)).status).toBe(403);
    expect((await request(app).get(`${base}/download`).query({ path: "x" })).status).toBe(403);
    expect((await request(app).post(`${base}/upload`).attach("file", Buffer.from("x"), "x.txt")).status).toBe(403);

    const ssh = await request(app).post(sessionsPath()).send({ kind: "ssh", environmentId: ENVIRONMENT_ID });
    expect(ssh.status).toBe(201);
    expect(ssh.body).toMatchObject({ kind: "ssh", cwd: "/srv/work", environmentId: ENVIRONMENT_ID });
    const sshToken = await request(app).post(`${sessionsPath()}/${ssh.body.id}/token`);
    expect(sshToken.status).toBe(201);

    const listed = await request(app).get(sessionsPath());
    expect(listed.status).toBe(200);
    expect(listed.body.map((session: { id: string }) => session.id)).toEqual([ssh.body.id]);

    actor = adminActor;
    const adminList = await request(app).get(sessionsPath());
    expect(adminList.body.map((session: { id: string }) => session.id)).toEqual([adminLocal.body.id, ssh.body.id]);
    expect(manager.get(COMPANY_ID, adminLocal.body.id)?.status).toBe("running");
  });

  it("refuses an agent API key with 403", async () => {
    actor = agentKeyActor;
    const app = createApp();
    expect((await request(app).post(sessionsPath()).send({ kind: "local" })).status).toBe(403);
    expect((await request(app).get(sessionsPath())).status).toBe(403);
    expect(processes).toHaveLength(0);
  });

  it("refuses a company-owner agent with 403", async () => {
    expect(isCompanyOwnerAgent(ownerAgentActor)).toBe(true);
    actor = ownerAgentActor;
    const app = createApp();
    expect((await request(app).post(sessionsPath()).send({ kind: "local" })).status).toBe(403);
    expect((await request(app).post(sessionsPath()).send({ kind: "ssh", environmentId: ENVIRONMENT_ID })).status).toBe(403);
    expect((await request(app).get(sessionsPath())).status).toBe(403);
    expect(processes).toHaveLength(0);
  });

  it("refuses a board API key and a viewer membership", async () => {
    actor = boardKeyActor;
    const app = createApp();
    expect((await request(app).get(sessionsPath())).status).toBe(403);
    actor = viewerActor;
    expect((await request(app).get(sessionsPath())).status).toBe(403);
    expect((await request(app).post(sessionsPath()).send({ kind: "ssh", environmentId: ENVIRONMENT_ID })).status).toBe(403);
  });

  it("returns 404 for a session id that belongs to another company", async () => {
    const app = createApp();
    const created = await request(app).post(sessionsPath(OTHER_COMPANY_ID)).send({ kind: "local" });
    expect(created.status).toBe(201);
    const base = `${sessionsPath()}/${created.body.id}`;
    expect((await request(app).delete(base)).status).toBe(404);
    expect((await request(app).post(`${base}/token`)).status).toBe(404);
    expect((await request(app).get(`${base}/download`).query({ path: "x" })).status).toBe(404);
    expect((await request(app).post(`${base}/upload`).attach("file", Buffer.from("x"), "x.txt")).status).toBe(404);
    expect(manager.list(OTHER_COMPANY_ID)).toHaveLength(1);
  });

  it("mints a single-use token for the websocket path carrying the actor", async () => {
    const app = createApp();
    const created = await request(app).post(sessionsPath()).send({ kind: "local" });
    const minted = await request(app).post(`${sessionsPath()}/${created.body.id}/token`);
    expect(minted.status).toBe(201);
    expect(minted.body).toMatchObject({ sessionId: created.body.id, websocketPath: "/api/terminal/ws" });
    expect(manager.consumeAttachToken(minted.body.token)).toMatchObject({
      companyId: COMPANY_ID,
      sessionId: created.body.id,
      kind: "local",
      userId: "admin-1",
      actorSource: "session",
      authSessionId: "auth-session-1",
    });
    expect(manager.consumeAttachToken(minted.body.token)).toBeNull();
  });

  it("requires a same-origin request for every mutation, even for local_implicit", async () => {
    actor = localActor;
    const app = createApp();
    const evil = "https://evil.example";
    expect((await request(app).post(sessionsPath()).set("Origin", evil).send({ kind: "local" })).status).toBe(403);
    expect(processes).toHaveLength(0);

    const created = await request(app).post(sessionsPath()).send({ kind: "local" });
    const base = `${sessionsPath()}/${created.body.id}`;
    const upload = await request(app).post(`${base}/upload`).set("Origin", evil).attach("file", Buffer.from("x"), "x.txt");
    expect(upload.status).toBe(403);
    expect(existsSync(path.join(workDir, "x.txt"))).toBe(false);
    expect((await request(app).post(`${base}/token`).set("Origin", evil)).status).toBe(403);
    expect((await request(app).delete(base).set("Origin", evil)).status).toBe(403);
    expect((await request(app).post(`${base}/token`).set("Origin", "null")).status).toBe(403);
  });

  it("rejects a missing or untrusted Origin in authenticated mode and accepts a configured https origin", async () => {
    const app = createApp({ ...authenticatedPolicy, allowedHostnames: ["terminal.test"] });
    const post = (origin?: string) => {
      const req = request(app).post(sessionsPath()).set("Host", "terminal.test");
      return (origin ? req.set("Origin", origin) : req).send({ kind: "local" });
    };
    expect((await post()).status).toBe(403);
    expect((await post("http://terminal.test")).status).toBe(403);
    expect((await post("https://terminal.test:8443")).status).toBe(403);
    expect((await post("https://terminal.test")).status).toBe(201);
  });

  it("uploads into the session cwd, rejects ../ traversal and never overwrites", async () => {
    const app = createApp();
    const created = await request(app).post(sessionsPath()).send({ kind: "local" });
    const base = `${sessionsPath()}/${created.body.id}`;

    const ok = await request(app).post(`${base}/upload`).attach("file", Buffer.from("hello upload"), "notes.txt");
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ path: path.join(workDir, "notes.txt"), bytes: 12 });
    expect(readFileSync(path.join(workDir, "notes.txt"), "utf8")).toBe("hello upload");

    const again = await request(app).post(`${base}/upload`).attach("file", Buffer.from("replaced"), "notes.txt");
    expect(again.status).toBe(409);
    expect(readFileSync(path.join(workDir, "notes.txt"), "utf8")).toBe("hello upload");

    symlinkSync(path.join(tempDir, "target.txt"), path.join(workDir, "dangling.txt"));
    const throughLink = await request(app).post(`${base}/upload`).attach("file", Buffer.from("via link"), "dangling.txt");
    expect(throughLink.status).toBe(409);
    expect(existsSync(path.join(tempDir, "target.txt"))).toBe(false);

    const boundary = "terminal-test-boundary";
    const rawBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="../evil.txt"',
      "Content-Type: text/plain",
      "",
      "evil",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const traversal = await request(app)
      .post(`${base}/upload`)
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .send(rawBody);
    expect(traversal.status).toBe(400);
    expect(existsSync(path.join(path.dirname(workDir), "evil.txt"))).toBe(false);
    expect(existsSync(path.join(workDir, "evil.txt"))).toBe(false);

    const extraField = await request(app).post(`${base}/upload`).field("other", "x").attach("file", Buffer.from("y"), "y.txt");
    expect(extraField.status).toBe(400);
    expect(existsSync(path.join(workDir, "y.txt"))).toBe(false);
    expect(activity.filter((entry) => entry.action === "terminal.file_uploaded")).toHaveLength(1);
  });

  it("saves a pasted image privately on the session host and refuses non-images", async () => {
    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = tempDir;
    try {
      const app = createApp();
      const created = await request(app).post(sessionsPath()).send({ kind: "local" });
      const base = `${sessionsPath()}/${created.body.id}`;
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);

      const ok = await request(app).post(`${base}/paste-image`).attach("file", png, { filename: "x", contentType: "image/png" });
      expect(ok.status).toBe(201);
      const directory = path.join(tempDir, `paperclip-pasted-${process.getuid?.() ?? "user"}`);
      expect(path.dirname(ok.body.path)).toBe(directory);
      expect(path.basename(ok.body.path)).toMatch(/^pasted-image-\d+-[0-9a-f]{8}\.png$/);
      expect(readFileSync(ok.body.path)).toEqual(png);
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(ok.body.path).mode & 0o777).toBe(0o600);

      const html = await request(app)
        .post(`${base}/paste-image`)
        .attach("file", Buffer.from("<b>x</b>"), { filename: "x.png", contentType: "text/html" });
      expect(html.status).toBe(400);
      expect(readdirSync(directory)).toHaveLength(1);
      expect(activity.filter((entry) => entry.action === "terminal.image_pasted")).toHaveLength(1);
    } finally {
      if (previousTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmp;
    }
  });

  it("downloads files inside the cwd and refuses paths outside it", async () => {
    const app = createApp();
    const created = await request(app).post(sessionsPath()).send({ kind: "local" });
    const base = `${sessionsPath()}/${created.body.id}`;
    writeFileSync(path.join(workDir, "report.txt"), "report body");

    const relative = await request(app).get(`${base}/download`).query({ path: "report.txt" }).responseType("blob");
    expect(relative.status).toBe(200);
    expect(relative.headers["content-disposition"]).toContain("report.txt");
    expect(Buffer.from(relative.body as Buffer).toString("utf8")).toBe("report body");

    expect((await request(app).get(`${base}/download`).query({ path: path.join(workDir, "report.txt") })).status).toBe(200);
    expect((await request(app).get(`${base}/download`).query({ path: "../../etc/passwd" })).status).toBe(400);
    expect((await request(app).get(`${base}/download`).query({ path: "/etc/passwd" })).status).toBe(400);
    const secret = path.join(tempDir, "secret.txt");
    writeFileSync(secret, "outside");
    symlinkSync(secret, path.join(workDir, "link.txt"));
    expect((await request(app).get(`${base}/download`).query({ path: "link.txt" })).status).toBe(400);
    expect((await request(app).get(`${base}/download`)).status).toBe(400);
    expect(activity.filter((entry) => entry.action === "terminal.file_downloaded")).toHaveLength(2);
  });

  it("caps live sessions per user and per company, ignoring exited sessions", async () => {
    useManager({ maxSessionsPerUser: 2, maxSessionsPerCompany: 3 });
    const app = createApp();
    expect((await request(app).post(sessionsPath()).send({ kind: "local" })).status).toBe(201);
    expect((await request(app).post(sessionsPath()).send({ kind: "local" })).status).toBe(201);
    const userCap = await request(app).post(sessionsPath()).send({ kind: "local" });
    expect(userCap.status).toBe(409);
    expect(userCap.body.error).toContain("You already have 2 open terminal sessions");

    processes[0]!.finish({ exitCode: 0, signal: null });
    expect(manager.list(COMPANY_ID).map((session) => session.status)).toEqual(["exited", "running"]);
    expect((await request(app).post(sessionsPath()).send({ kind: "local" })).status).toBe(201);

    actor = { ...adminActor, userId: "admin-2" };
    expect((await request(app).post(sessionsPath()).send({ kind: "local" })).status).toBe(201);
    actor = { ...adminActor, userId: "admin-3" };
    const companyCap = await request(app).post(sessionsPath()).send({ kind: "local" });
    expect(companyCap.status).toBe(409);
    expect(companyCap.body.error).toContain("This company already has 3 open terminal sessions");
    expect((await request(app).post(sessionsPath(OTHER_COMPANY_ID)).send({ kind: "local" })).status).toBe(201);
  });

  it("destroys the session when the create activity write fails", async () => {
    const app = createApp();
    failNextActivity = true;
    const res = await request(app).post(sessionsPath()).send({ kind: "local" });
    expect(res.status).toBe(500);
    expect(processes[0]?.killed).toBe(true);
    expect(manager.list(COMPANY_ID)).toEqual([]);
  });

  it("keeps every terminal path out of the runner call_api surface", () => {
    const sessions = "/api/companies/{companyId}/terminal/sessions";
    expect(runnerApiRestriction("POST", `${sessions}/{sessionId}/token`)).not.toBeNull();
    expect(runnerApiRestriction("GET", sessions)).not.toBeNull();
    expect(runnerApiRestriction("GET", `${sessions}/{sessionId}/download`)).not.toBeNull();
  });

  it("rejects an ssh request without environmentId", async () => {
    const res = await request(createApp()).post(sessionsPath()).send({ kind: "ssh" });
    expect(res.status).toBe(400);
  });

  it("lists, saves and deletes host-side ssh hosts with activity entries", async () => {
    const app = createApp();
    const listed = await request(app).get(sshHostsPath());
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ hosts: configHosts, configPath: "/home/dev/.ssh/config", configError: null });

    const saved = await request(app).post(sshHostsPath()).send({ name: "prod", destination: "root@prod.test", port: 2200 });
    expect(saved.status).toBe(201);
    expect(saved.body).toEqual({
      id: savedSshHostId(SAVED_HOST_ID),
      source: "saved",
      name: "prod",
      destination: "root@prod.test",
      port: 2200,
    });
    expect(hostCreators).toEqual(["admin-1"]);

    const duplicate = await request(app).post(sshHostsPath()).send({ name: "prod", destination: "root@other.test" });
    expect(duplicate.status).toBe(409);

    const listedAfter = await request(app).get(sshHostsPath());
    expect(listedAfter.body.hosts.map((host: TerminalSshHost) => host.id)).toEqual([
      "config:web",
      savedSshHostId(SAVED_HOST_ID),
    ]);

    expect((await request(app).delete(`${sshHostsPath()}/config:web`)).status).toBe(400);
    expect((await request(app).delete(`${sshHostsPath()}/saved:missing`)).status).toBe(404);
    expect((await request(app).delete(`${sshHostsPath()}/${savedSshHostId(SAVED_HOST_ID)}`)).status).toBe(204);
    expect((await request(app).delete(`${sshHostsPath()}/${savedSshHostId(SAVED_HOST_ID)}`)).status).toBe(404);
    expect(savedHosts).toEqual([]);
    expect(activity.map((entry) => entry.action)).toEqual(["terminal.ssh_host_saved", "terminal.ssh_host_deleted"]);
    expect(activity[0]).toMatchObject({
      companyId: COMPANY_ID,
      actorType: "user",
      actorId: "admin-1",
      action: "terminal.ssh_host_saved",
      entityType: "terminal_ssh_host",
      entityId: savedSshHostId(SAVED_HOST_ID),
    });
  });

  it("refuses ssh host routes and host-side sessions to a non-admin company owner", async () => {
    actor = memberActor;
    const app = createApp();
    expect((await request(app).get(sshHostsPath())).status).toBe(403);
    expect((await request(app).post(sshHostsPath()).send({ name: "prod", destination: "root@prod.test" })).status).toBe(403);
    expect((await request(app).delete(`${sshHostsPath()}/config:web`)).status).toBe(403);
    const session = await request(app).post(sessionsPath()).send({ kind: "local", sshHostId: "config:web" });
    expect(session.status).toBe(403);
    expect(hostStarts).toHaveLength(0);
    expect(savedHosts).toEqual([]);
  });

  it("requires same-origin requests to save and delete ssh hosts", async () => {
    const app = createApp();
    const evil = "https://evil.example";
    const saved = await request(app)
      .post(sshHostsPath())
      .set("Origin", evil)
      .send({ name: "prod", destination: "root@prod.test" });
    expect(saved.status).toBe(403);
    const deleted = await request(app).delete(`${sshHostsPath()}/${savedSshHostId(SAVED_HOST_ID)}`).set("Origin", evil);
    expect(deleted.status).toBe(403);
    expect(savedHosts).toEqual([]);
  });

  it("opens host-side sessions with the argv of each ssh host source", async () => {
    const app = createApp();
    const configSession = await request(app)
      .post(sessionsPath())
      .send({ kind: "local", sshHostId: "config:web", cols: 90, rows: 20 });
    expect(configSession.status).toBe(201);
    expect(configSession.body).toMatchObject({
      kind: "local",
      title: "web",
      sshHost: "web",
      cwd: null,
      issueId: null,
      environmentId: null,
      cols: 90,
      rows: 20,
    });
    expect(systemSshArgs(hostStarts[0]!.host)).toEqual(["--", "web"]);
    expect(hostStarts[0]).toMatchObject({ cols: 90, rows: 20 });

    const withPort = await request(app).post(sshHostsPath()).send({ name: "db", destination: "deploy@db.test", port: 2222 });
    const withPortSession = await request(app)
      .post(sessionsPath())
      .send({ kind: "local", sshHostId: withPort.body.id, title: "Db box" });
    expect(withPortSession.status).toBe(201);
    expect(withPortSession.body).toMatchObject({ title: "Db box", sshHost: "db", cwd: null });
    expect(systemSshArgs(hostStarts[1]!.host)).toEqual(["-p", "2222", "--", "deploy@db.test"]);

    const plain = await request(app).post(sshHostsPath()).send({ name: "plain", destination: "plain.test" });
    const plainSession = await request(app).post(sessionsPath()).send({ kind: "local", sshHostId: plain.body.id });
    expect(plainSession.status).toBe(201);
    expect(systemSshArgs(hostStarts[2]!.host)).toEqual(["--", "plain.test"]);
    expect(plainSession.body).toMatchObject({ title: "plain", sshHost: "plain" });
  });

  it("returns 404 when the requested ssh host id is unknown", async () => {
    const res = await request(createApp()).post(sessionsPath()).send({ kind: "local", sshHostId: "config:missing" });
    expect(res.status).toBe(404);
    expect(hostStarts).toHaveLength(0);
    expect(manager.list(COMPANY_ID)).toEqual([]);
  });
});
