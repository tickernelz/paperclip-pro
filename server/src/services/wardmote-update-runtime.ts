import type { Db } from "@tickernelz/wardmote-db";
import { conflict } from "../errors.js";
import { resolveWardmoteHomeDir, resolveWardmoteInstanceId, resolveWardmoteInstanceRoot } from "../home-paths.js";
import { logActivity } from "./activity-log.js";
import { getTaskDrainStatus, listActiveRunExecutionIds } from "./heartbeat.js";
import { instanceSettingsService } from "./instance-settings.js";
import { startTaskDrain, stopTaskDrain } from "./task-admission.js";
import { createSystemdUnitState, createSystemdUpdateLauncher, createUpdateInstaller, type UpdateInstaller } from "./wardmote-update-install.js";
import type { WardmoteUpdateService } from "./wardmote-updates.js";

export function createInstanceUpdateInstaller(db: Db, updates: WardmoteUpdateService): UpdateInstaller {
  const installer = createUpdateInstaller({
    status: () => updates.status(),
    instanceRoot: resolveWardmoteInstanceRoot(),
    runControl: {
      async liveRuns() {
        const drain = getTaskDrainStatus();
        const runIds = listActiveRunExecutionIds();
        return {
          draining: drain.draining,
          pendingWakes: drain.pendingWakes,
          count: runIds.length,
          runs: runIds.map((id) => ({ id, companyId: null, agentId: null, status: null, startedAt: null, issueId: null })),
        };
      },
      async startDrain(ttlMs) {
        if (getTaskDrainStatus().ownerId) throw conflict("An idle-sleep task drain is active");
        startTaskDrain({ ttlMs });
      },
      async stopDrain() {
        if (!getTaskDrainStatus().ownerId) stopTaskDrain();
      },
    },
    launch: createSystemdUpdateLauncher({
      homeDir: resolveWardmoteHomeDir(),
      instanceId: resolveWardmoteInstanceId(),
    }),
    unitState: createSystemdUnitState(),
    audit: async ({ action, job }) => {
      const companyIds = await instanceSettingsService(db).listCompanyIds();
      await Promise.all(companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: job.requestedBy?.actorType === "user" ? "user" : "system",
          actorId: job.requestedBy?.actorId ?? "wardmote-auto-update",
          action,
          entityType: "instance_update",
          entityId: job.id,
          details: {
            fromVersion: job.fromVersion,
            toVersion: job.toVersion,
            mode: job.mode,
            trigger: job.trigger,
            phase: job.phase,
            liveRuns: job.liveRuns,
            installedVersion: job.installedVersion,
            rolledBackTo: job.rolledBackTo,
            error: job.error,
          },
        }),
      ));
    },
  });
  installer.resume();
  return installer;
}
