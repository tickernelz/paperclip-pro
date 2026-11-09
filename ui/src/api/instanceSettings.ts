import type {
  AttachmentRetentionReport,
  AttachmentRetentionSettings,
  AttachmentRetentionStatus,
  EffectiveLocalRunLimits,
  InstanceExperimentalSettings,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@tickernelz/wardmote-shared";
import { api } from "./client";

export const instanceSettingsApi = {
  get: () =>
    api.get<InstanceSettings>("/instance/settings"),
  update: (patch: PatchInstanceSettings) =>
    api.patch<InstanceSettings>("/instance/settings", patch),
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getLocalRunLimits: () =>
    api.get<EffectiveLocalRunLimits>("/instance/settings/local-run-limits"),
  getExperimental: () =>
    api.get<InstanceExperimentalSettings>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettings>("/instance/settings/experimental", patch),
  getAttachmentRetention: () =>
    api.get<AttachmentRetentionStatus>("/instance/attachment-retention", { cache: "no-store" }),
  previewAttachmentRetention: (settings?: AttachmentRetentionSettings) =>
    api.post<AttachmentRetentionReport>("/instance/attachment-retention/preview", settings ? { settings } : {}),
  runAttachmentRetention: () =>
    api.post<AttachmentRetentionReport>("/instance/attachment-retention/run", {}),
};
