import type { InstanceUpdateStatus, UpdateInstallMode, UpdateJob } from "@tickernelz/wardmote-shared";
import type { LiveRunsSnapshot } from "@tickernelz/wardmote-shared/instance-drain";
import { api } from "./client";

export const instanceUpdatesApi = {
  getStatus: () => api.get<InstanceUpdateStatus>("/instance/updates"),
  getInstall: () => api.get<{ job: UpdateJob | null }>("/instance/updates/install", { cache: "no-store" }),
  liveRuns: () => api.get<LiveRunsSnapshot>("/instance/live-runs", { cache: "no-store" }),
  startInstall: (version: string, mode: UpdateInstallMode) =>
    api.post<{ job: UpdateJob }>("/instance/updates/install", { version, mode }),
  forceInstall: () => api.post<{ job: UpdateJob }>("/instance/updates/install/force", {}),
  cancelInstall: () => api.delete<{ job: UpdateJob }>("/instance/updates/install"),
};
