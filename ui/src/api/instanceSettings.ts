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
  SpeechToTextModelList,
  SpeechToTextProvider,
  SpeechToTextSettings,
  SpeechToTextTestResult,
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
  listSpeechToTextModels: (request: { provider: SpeechToTextProvider; baseUrl: string; apiKeyEnvVar: string }) =>
    api.post<SpeechToTextModelList>("/instance/settings/general/speech-to-text/models", request),
  testSpeechToText: (settings: SpeechToTextSettings, file: File) => {
    const form = new FormData();
    form.append("settings", JSON.stringify(settings));
    form.append("file", file);
    return api.postForm<SpeechToTextTestResult>("/instance/settings/general/speech-to-text/test", form);
  },
  runAttachmentRetention: () =>
    api.post<AttachmentRetentionReport>("/instance/attachment-retention/run", {}),
};
