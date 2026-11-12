import type { InstanceUpdateStatus } from "@tickernelz/wardmote-shared";
import { api } from "./client";

export const instanceUpdatesApi = {
  getStatus: () => api.get<InstanceUpdateStatus>("/instance/updates"),
};
