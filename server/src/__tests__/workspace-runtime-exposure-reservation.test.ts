import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  executionWorkspaces,
  projectWorkspaces,
  projects,
  workspaceRuntimeServices,
  type Db,
} from "@tickernelz/wardmote-db";
import { eq } from "drizzle-orm";
import {
  deriveViteHmrPort,
  RUNTIME_EXPOSURE_APP_PORT_MAX,
  RUNTIME_EXPOSURE_APP_PORT_MIN,
  RUNTIME_EXPOSURE_HMR_PORT_OFFSET,
} from "@tickernelz/wardmote-shared";

import type { BrokerClient, BrokerListenerRequest } from "../services/runtime-exposure/broker-client.js";
import { readListenerBindFacts } from "../services/runtime-exposure/loopback-listener.js";
import {
  reconcilePersistedRuntimeServicesOnStartup,
  resetRuntimeServicesForTests,
  setWorkspaceRuntimeExposureDepsForTests,
  startRuntimeServicesForWorkspaceControl,
} from "../services/workspace-runtime.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

/**
 * The first app port this suite may select. A real instance can hold a pair
 * in the low lane, at `RUNTIME_EXPOSURE_APP_PORT_MIN`, under an open lease
 * with no listener bound — the exact incident this file reproduces. The scan
 * must start clear of that lane, so this suite never seizes a pair a live
 * instance still owns.
 */
const RUNTIME_EXPOSURE_SUITE_APP_PORT_START = RUNTIME_EXPOSURE_APP_PORT_MIN + 500;

/**
 * The pair lane B holds under an open lease, and the next pair a correct
 * allocator must relocate to. `beforeEach` discovers both on the real host, so
 * a fixed constant here can never lose a race with a short-lived socket
 * elsewhere on the runner.
 */
let LEASED_APP_PORT: number;
let LEASED_HMR_PORT: number;
let NEXT_APP_PORT: number;
let NEXT_HMR_PORT: number;

const REAL_WARDMOTE_HOME = process.env.WARDMOTE_TEST_HOST_HOME?.trim()
  || process.env.WARDMOTE_HOME?.trim()
  || path.join(os.homedir(), ".wardmote");

async function readLocallyLeasedPorts(): Promise<Set<number>> {
  const leased = new Set<number>();
  const instancesDir = path.join(REAL_WARDMOTE_HOME, "instances");
  let instanceEntries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    instanceEntries = await fs.readdir(instancesDir, { withFileTypes: true });
  } catch {
    return leased;
  }
  for (const instanceEntry of instanceEntries) {
    if (!instanceEntry.isDirectory()) continue;
    const registryDir = path.join(instancesDir, instanceEntry.name, "runtime-services");
    let recordEntries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      recordEntries = await fs.readdir(registryDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const recordEntry of recordEntries) {
      if (!recordEntry.isFile() || !recordEntry.name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(
          await fs.readFile(path.join(registryDir, recordEntry.name), "utf8"),
        ) as { port?: unknown };
        if (typeof raw.port !== "number") continue;
        leased.add(raw.port);
        // The registry records only the app port a managed process bound. Its
        // Vite HMR companion is the same fixed offset away and is leased too.
        leased.add(raw.port + RUNTIME_EXPOSURE_HMR_PORT_OFFSET);
      } catch {
        continue;
      }
    }
  }
  return leased;
}

/**
 * A real loopback bind probe, matching production's `isLoopbackPortAvailable`
 * and the identical helper in `workspace-runtime-exposure.test.ts`, plus the
 * `locallyLeasedPorts` check above that a listener probe alone cannot make.
 */
async function isLoopbackPortFree(port: number, locallyLeasedPorts: Set<number>): Promise<boolean> {
  if (locallyLeasedPorts.has(port)) return false;

  const facts = await readListenerBindFacts(port);
  if (facts?.present) return false;

  return await new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * The first app port at or above `startAt` whose HMR companion is also free on
 * the real host right now, mirroring the allocator's own scan.
 */
async function findFreeExposureAppPort(startAt: number, locallyLeasedPorts: Set<number>): Promise<number> {
  for (let appPort = startAt; appPort <= RUNTIME_EXPOSURE_APP_PORT_MAX; appPort += 1) {
    if (
      await isLoopbackPortFree(appPort, locallyLeasedPorts)
      && await isLoopbackPortFree(deriveViteHmrPort(appPort), locallyLeasedPorts)
    ) {
      return appPort;
    }
  }
  throw new Error("no free app/HMR port pair available in the dedicated runtime exposure range");
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();

/**
 * A synthetic host on which only the two dedicated pairs above are usable.
 *
 * Crucially, the leased pair reads FREE — no listener, because lane B is
 * stopped. That is the exact condition under which the old allocator handed it
 * away, so a fixture that reported it busy would not reproduce the bug at all.
 */
async function isPortAvailableOnSyntheticHost(port: number): Promise<boolean> {
  return port === LEASED_APP_PORT || port === LEASED_HMR_PORT
    || port === NEXT_APP_PORT || port === NEXT_HMR_PORT;
}

function createFakeBroker() {
  const calls: string[] = [];
  const reservedByHandle = new Map<string, BrokerListenerRequest[]>();
  const exposedByRuntimeId = new Map<string, BrokerListenerRequest[]>();
  /** Mappings attributed to a runtime this server did not reserve. */
  const foreignListeners: Array<{ runtimeId: string; port: number; purpose: "app" | "vite_hmr" }> = [];

  const broker: BrokerClient = {
    async reserve(runtimeId, requested) {
      calls.push(`reserve:${requested.map((listener) => listener.port).join(",")}`);
      const handle = `handle-${runtimeId}`;
      reservedByHandle.set(handle, requested);
      return { handle, reservedPorts: requested.map((listener) => listener.port) };
    },
    async expose(runtimeId, handle) {
      calls.push("expose");
      const requested = reservedByHandle.get(handle) ?? [];
      exposedByRuntimeId.set(runtimeId, requested);
      return { handle, publicPorts: requested.map((listener) => listener.port) };
    },
    async remove(runtimeId, handle) {
      calls.push(`remove:${runtimeId}`);
      const listeners = exposedByRuntimeId.get(runtimeId) ?? reservedByHandle.get(handle) ?? [];
      exposedByRuntimeId.delete(runtimeId);
      reservedByHandle.delete(handle);
      return { removedPorts: listeners.map((listener) => listener.port) };
    },
    async list() {
      return [
        ...foreignListeners,
        ...[...exposedByRuntimeId.entries()].flatMap(([runtimeId, listeners]) =>
          listeners.map((listener) => ({ runtimeId, port: listener.port, purpose: listener.purpose })),
        ),
      ];
    },
  };

  return { broker, calls, foreignListeners };
}

function installDeps(broker: BrokerClient, overrides?: {
  isPortAvailable?: (port: number) => Promise<boolean>;
}) {
  setWorkspaceRuntimeExposureDepsForTests({
    broker,
    isPortAvailable: overrides?.isPortAvailable ?? isPortAvailableOnSyntheticHost,
    isBrokerAvailable: async () => true,
    resolveHostname: async () => "runner.tail123.ts.net",
    probeHealth: async () => true,
    now: () => new Date().toISOString(),
    // Loopback-bind diagnosis is covered by `workspace-runtime-exposure.test.ts`
    // against real guests; stubbing it here keeps these cases about ownership.
    diagnoseListenerBinds: async () => null,
  });
}

const DECLARED_EXPOSE = {
  type: "tailscale_https",
  hostname: "auto",
  publicPort: "same",
  includeWardmoteViteHmr: true,
  failurePolicy: "fail_closed",
} as const;

/**
 * A backend that binds its allocated app port and the HMR companion on
 * loopback, matching the real managed lane. Readiness then has a real listener
 * to probe, so the lifecycle runs to `ready` exactly as in production.
 */
// Use the test runner's executable. A login shell can resolve bare `node` to
// another installation. Keep startup facts in the service log so a readiness
// failure identifies which executable started and which ports it bound.
const guestNode = `'${process.execPath.replace(/'/g, "'\\''")}'`;
const GUEST_COMMAND =
  `${guestNode} -e "const http=require('node:http');const p=Number(process.env.PORT);`
  + "console.log('guest-start',process.execPath,p);"
  + "for(const q of [p,p+10000])http.createServer((_,r)=>{r.statusCode=200;r.end('ok')}).listen(q,'127.0.0.1',()=>console.log('guest-listening',q));"
  + "setInterval(()=>{},1000)\"";

(embeddedPostgresSupport.supported ? describe : describe.skip)(
  "PAP-17419 leased exposure pair reservation",
  () => {
    let db: Db;
    let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
    let previousHttpsMode: string | undefined;
    let previousWardmoteHome: string | undefined;
    let previousInstanceId: string | undefined;
    /**
     * An EMPTY workspace root, never the repo checkout.
     *
     * Pointing `cwd` at the real repo makes the start path do git and
     * dependency-provisioning work on a large tree, which is slow enough to
     * blow the test timeout and has nothing to do with what is under test.
     */
    let workspaceRoot: string;
    let wardmoteHome: string;

    beforeAll(async () => {
      tempDb = await startEmbeddedPostgresTestDatabase("pap17419-reservation-");
      db = createDb(tempDb.connectionString);
      previousHttpsMode = process.env.WARDMOTE_MANAGED_RUNTIME_HTTPS;
      process.env.WARDMOTE_MANAGED_RUNTIME_HTTPS = "auto";
    }, 60_000);

    beforeEach(async () => {
      // Discover two verified-free pairs on the real host right before each
      // case runs, so the window between the probe and the guest bind stays
      // as short as possible.
      const locallyLeasedPorts = await readLocallyLeasedPorts();
      LEASED_APP_PORT = await findFreeExposureAppPort(RUNTIME_EXPOSURE_SUITE_APP_PORT_START, locallyLeasedPorts);
      LEASED_HMR_PORT = deriveViteHmrPort(LEASED_APP_PORT);
      NEXT_APP_PORT = await findFreeExposureAppPort(LEASED_APP_PORT + 1, locallyLeasedPorts);
      NEXT_HMR_PORT = deriveViteHmrPort(NEXT_APP_PORT);

      workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pap17419-workspace-"));
      wardmoteHome = await fs.mkdtemp(path.join(os.tmpdir(), "pap17419-home-"));
      previousWardmoteHome = process.env.WARDMOTE_HOME;
      previousInstanceId = process.env.WARDMOTE_INSTANCE_ID;
      process.env.WARDMOTE_HOME = wardmoteHome;
      process.env.WARDMOTE_INSTANCE_ID = `pap17419-${randomUUID()}`;
    });

    afterAll(async () => {
      if (previousHttpsMode === undefined) delete process.env.WARDMOTE_MANAGED_RUNTIME_HTTPS;
      else process.env.WARDMOTE_MANAGED_RUNTIME_HTTPS = previousHttpsMode;
      await tempDb?.cleanup();
    });

    afterEach(async () => {
      // Terminate first, while the suite's fake broker is still installed.
      await resetRuntimeServicesForTests({ terminateProcesses: true });
      if (previousWardmoteHome === undefined) delete process.env.WARDMOTE_HOME;
      else process.env.WARDMOTE_HOME = previousWardmoteHome;
      if (previousInstanceId === undefined) delete process.env.WARDMOTE_INSTANCE_ID;
      else process.env.WARDMOTE_INSTANCE_ID = previousInstanceId;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(wardmoteHome, { recursive: true, force: true });
      await db.delete(workspaceRuntimeServices);
      await db.delete(executionWorkspaces);
      await db.delete(projectWorkspaces);
      await db.delete(projects);
      // Drift reporting writes activity rows, which hold a company FK.
      await db.delete(activityLog);
      await db.delete(companies);
    });

    /**
     * Seed the incident's two workspaces: lane B with an open lease and a
     * stopped, torn-down runtime row on the leased pair, and the unrelated
     * workspace that will ask for a pair next.
     */
    async function seedIncident(options?: { leaseStatus?: string; leasedRowStatus?: string }) {
      const companyId = randomUUID();
      const projectId = randomUUID();
      const projectWorkspaceId = randomUUID();
      const leasedWorkspaceId = randomUUID();
      const otherWorkspaceId = randomUUID();
      const leasedRuntimeId = randomUUID();

      await db.insert(companies).values({
        id: companyId,
        name: "Wardmote",
        issuePrefix: `Q${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(projects).values({ id: projectId, companyId, name: "Wardmote App", status: "in_progress" });
      await db.insert(projectWorkspaces).values({
        id: projectWorkspaceId,
        companyId,
        projectId,
        name: "Primary",
        cwd: workspaceRoot,
        isPrimary: true,
      });
      for (const [id, name] of [[leasedWorkspaceId, "lane-b"], [otherWorkspaceId, "posthog-mcp"]] as const) {
        await db.insert(executionWorkspaces).values({
          id,
          companyId,
          projectId,
          projectWorkspaceId,
          mode: "isolated_workspace",
          strategyType: "git_worktree",
          name,
          // Lane B's lease is open unless a case closes it.
          status: id === leasedWorkspaceId ? (options?.leaseStatus ?? "active") : "active",
          closedAt: id === leasedWorkspaceId && options?.leaseStatus === "archived" ? new Date() : null,
          cwd: workspaceRoot,
          baseRef: "HEAD",
          branchName: name,
          providerType: "git_worktree",
        });
      }

      // Lane B as the incident left it: stopped, torn down, `removed` — and an
      // EMPTY listeners array, which is what `deprovisionExposure` writes. The
      // `port` column is the only surviving record of the leased pair.
      await db.insert(workspaceRuntimeServices).values({
        id: leasedRuntimeId,
        companyId,
        projectId,
        projectWorkspaceId,
        executionWorkspaceId: leasedWorkspaceId,
        scopeType: "execution_workspace",
        scopeId: leasedWorkspaceId,
        serviceName: "preview",
        status: options?.leasedRowStatus ?? "stopped",
        lifecycle: "shared",
        command: GUEST_COMMAND,
        cwd: workspaceRoot,
        port: LEASED_APP_PORT,
        provider: "local_process",
        exposure: {
          provider: "tailscale_https",
          state: "removed",
          publicUrl: null,
          hostname: null,
          listeners: [],
          brokerRef: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        },
        stoppedAt: new Date(),
      });

      return { companyId, projectId, projectWorkspaceId, leasedWorkspaceId, otherWorkspaceId, leasedRuntimeId };
    }

    function startInput(seed: Awaited<ReturnType<typeof seedIncident>>, executionWorkspaceId: string) {
      return {
        invocationId: "pap-17419-reservation",
        actor: { id: null, name: "Wardmote", companyId: seed.companyId },
        issue: null,
        db,
        workspace: {
          baseCwd: workspaceRoot,
          source: "project_primary" as const,
          projectId: seed.projectId,
          workspaceId: seed.projectWorkspaceId,
          repoUrl: null,
          repoRef: null,
          strategy: "project_primary" as const,
          cwd: workspaceRoot,
          branchName: "test",
          worktreePath: null,
          warnings: [],
          created: false,
        },
        executionWorkspaceId,
        config: {
          workspaceRuntime: {
            services: [{
              name: "preview",
              command: GUEST_COMMAND,
              port: { type: "auto", envKey: "PORT" },
              readiness: { type: "http", urlTemplate: "http://127.0.0.1:{{port}}", timeoutSec: 10, intervalMs: 50 },
              expose: DECLARED_EXPOSE,
            }],
          },
        },
        adapterEnv: {},
      };
    }

    it("regression 1: does not hand a stopped-but-leased pair to another workspace", async () => {
      const seed = await seedIncident();
      const { broker, calls } = createFakeBroker();
      installDeps(broker);

      const [runtime] = await startRuntimeServicesForWorkspaceControl(
        startInput(seed, seed.otherWorkspaceId),
      );

      // The incident outcome would be LEASED_APP_PORT here.
      expect(runtime.port).toBe(NEXT_APP_PORT);
      expect(runtime.port).not.toBe(LEASED_APP_PORT);
      expect(runtime.url).toBe(`https://runner.tail123.ts.net:${NEXT_APP_PORT}`);
      // The broker was never even asked to reserve the leased pair.
      expect(calls.filter((call) => call.includes(String(LEASED_APP_PORT)))).toEqual([]);
      expect(calls[0]).toBe(`reserve:${NEXT_APP_PORT},${NEXT_HMR_PORT}`);
    }, 30_000);

    it("regression 1: fails closed rather than reusing the leased pair when it is the only one left", async () => {
      const seed = await seedIncident();
      const { broker, calls } = createFakeBroker();
      // A host on which the leased pair is the only free pair in the range.
      installDeps(broker, {
        isPortAvailable: async (port) => port === LEASED_APP_PORT || port === LEASED_HMR_PORT,
      });

      await expect(startRuntimeServicesForWorkspaceControl(
        startInput(seed, seed.otherWorkspaceId),
      )).rejects.toThrow(/no free app\/HMR port pair available/);

      expect(calls).toEqual([]);
    }, 30_000);

    it("regression 1: lets the leaseholder's own workspace take its pair back", async () => {
      const seed = await seedIncident();
      const { broker } = createFakeBroker();
      installDeps(broker);

      const [runtime] = await startRuntimeServicesForWorkspaceControl(
        startInput(seed, seed.leasedWorkspaceId),
      );

      // Same workspace, so the preserved-port preference still applies.
      expect(runtime.port).toBe(LEASED_APP_PORT);
    }, 30_000);

    it("regression 3: denies a pair whose Serve mapping belongs to another runtime", async () => {
      const seed = await seedIncident();
      const { broker, foreignListeners } = createFakeBroker();
      // The pair the allocator would otherwise relocate to is already published
      // by a runtime this server has no row for — the unattributable case.
      foreignListeners.push({ runtimeId: "runtime-not-ours", port: NEXT_APP_PORT, purpose: "app" });
      installDeps(broker);

      await expect(startRuntimeServicesForWorkspaceControl(
        startInput(seed, seed.otherWorkspaceId),
      )).rejects.toThrow(/no free app\/HMR port pair available|HTTPS exposure allocation denied/);
    }, 30_000);

    it("regression 5: release makes the pair reusable by a different workspace", async () => {
      const seed = await seedIncident({ leaseStatus: "archived" });
      const { broker } = createFakeBroker();
      installDeps(broker);

      const [runtime] = await startRuntimeServicesForWorkspaceControl(
        startInput(seed, seed.otherWorkspaceId),
      );

      // Lane B's lease is released, so its pair is genuinely free again and the
      // ascending scan hands out the lowest one.
      expect(runtime.port).toBe(LEASED_APP_PORT);
    }, 30_000);

    it("regression 3: reconciliation surfaces a removed row whose pair is mapped elsewhere, and adopts nothing", async () => {
      const seed = await seedIncident();
      const { broker, foreignListeners, calls } = createFakeBroker();
      // Lane B reads `stopped`/`removed`, but the host still publishes its pair
      // for someone else. Exactly the falsely-attributed state from PAP-17251.
      foreignListeners.push({ runtimeId: "runtime-not-ours", port: LEASED_APP_PORT, purpose: "app" });
      installDeps(broker);

      const result = await reconcilePersistedRuntimeServicesOnStartup(db);

      expect(result.exposureReservationDrift).toHaveLength(1);
      expect(result.exposureReservationDrift[0]).toMatchObject({
        runtimeServiceId: seed.leasedRuntimeId,
        port: LEASED_APP_PORT,
        reason: "serve_mapping",
        owner: { executionWorkspaceId: seed.leasedWorkspaceId },
        conflictingOwner: { runtimeServiceId: "runtime-not-ours" },
      });
      // The occupying mapping is left strictly alone: no removal, no adoption.
      expect(calls.filter((call) => call.startsWith("remove"))).toEqual([]);

      const [row] = await db
        .select()
        .from(workspaceRuntimeServices)
        .where(eq(workspaceRuntimeServices.id, seed.leasedRuntimeId));
      expect(row!.status).toBe("stopped");
      expect(row!.port).toBe(LEASED_APP_PORT);
    }, 30_000);

    it("regression 4: concurrent starts in different workspaces never share a pair", async () => {
      const seed = await seedIncident({ leaseStatus: "archived" });
      const { broker } = createFakeBroker();
      installDeps(broker);

      const [first, second] = await Promise.all([
        startRuntimeServicesForWorkspaceControl(startInput(seed, seed.otherWorkspaceId)),
        startRuntimeServicesForWorkspaceControl(startInput(seed, seed.leasedWorkspaceId)),
      ]);

      const ports = [first[0]?.port, second[0]?.port].sort();
      expect(ports).toEqual([LEASED_APP_PORT, NEXT_APP_PORT]);
    }, 30_000);
  },
);
