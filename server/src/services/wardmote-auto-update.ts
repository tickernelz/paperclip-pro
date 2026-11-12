import fs from "node:fs";
import path from "node:path";
import type { InstanceUpdateStatus, UpdateJob } from "@tickernelz/wardmote-shared";
import { isUpdateJobActive } from "@tickernelz/wardmote-shared";
import type { UpdateInstaller } from "./wardmote-update-install.js";

export const AUTO_UPDATE_TICK_MS = 15 * 60 * 1000;
const AUTO_UPDATE_FIRST_TICK_MS = 5 * 60 * 1000;
const FAILED_VERSIONS_FILE = "update-auto-failed.json";

export type AutoUpdateDecision =
  | { install: true; version: string }
  | { install: false; reason: "disabled" | "no_update" | "not_installable" | "busy" | "runs_active" | "failed_before" };

export function decideAutoUpdate(input: {
  enabled: boolean;
  status: InstanceUpdateStatus;
  job: UpdateJob | null;
  activeRuns: number;
  queuedRuns: number;
  failedVersions: readonly string[];
}): AutoUpdateDecision {
  if (!input.enabled) return { install: false, reason: "disabled" };
  if (!input.status.updateAvailable || !input.status.latestVersion) return { install: false, reason: "no_update" };
  if (!input.status.install.canInstall) return { install: false, reason: "not_installable" };
  if (isUpdateJobActive(input.job)) return { install: false, reason: "busy" };
  if (input.failedVersions.includes(input.status.latestVersion)) return { install: false, reason: "failed_before" };
  if (input.activeRuns > 0 || input.queuedRuns > 0) return { install: false, reason: "runs_active" };
  return { install: true, version: input.status.latestVersion };
}

export function createAutoUpdater(deps: {
  enabled: () => Promise<boolean>;
  status: () => InstanceUpdateStatus;
  refresh: () => Promise<void>;
  installer: Pick<UpdateInstaller, "current" | "start">;
  activeRuns: () => number;
  queuedRuns: () => Promise<number>;
  instanceRoot: string;
  onDecision?: (decision: AutoUpdateDecision) => void;
}) {
  const failedPath = path.join(deps.instanceRoot, FAILED_VERSIONS_FILE);

  function failedVersions(): string[] {
    let stored: string[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(failedPath, "utf8")) as unknown;
      if (Array.isArray(raw)) stored = raw.filter((value): value is string => typeof value === "string");
    } catch {}
    const job = deps.installer.current();
    if (job?.trigger === "auto" && job.phase === "failed" && job.startedAt && !stored.includes(job.toVersion)) {
      stored = [...stored, job.toVersion].slice(-20);
      try {
        fs.writeFileSync(failedPath, JSON.stringify(stored) + "\n", { mode: 0o600 });
      } catch {}
    }
    return stored;
  }

  async function tick(): Promise<AutoUpdateDecision> {
    if (!(await deps.enabled())) return { install: false, reason: "disabled" };
    await deps.refresh();
    const decision = decideAutoUpdate({
      enabled: true,
      status: deps.status(),
      job: deps.installer.current(),
      activeRuns: deps.activeRuns(),
      queuedRuns: await deps.queuedRuns(),
      failedVersions: failedVersions(),
    });
    deps.onDecision?.(decision);
    if (decision.install) {
      await deps.installer.start({ version: decision.version, mode: "wait", trigger: "auto", requestedBy: null });
    }
    return decision;
  }

  function start(): () => void {
    const run = () => void tick().catch(() => undefined);
    const first = setTimeout(run, AUTO_UPDATE_FIRST_TICK_MS);
    const timer = setInterval(run, AUTO_UPDATE_TICK_MS);
    first.unref?.();
    timer.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }

  return { tick, start, failedVersions };
}
