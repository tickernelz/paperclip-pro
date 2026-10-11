import type { PluginEvent } from "@tickernelz/paperclip-pro-plugin-sdk";

export interface ActivityPublication {
  companyId: string;
  payload: Record<string, unknown>;
  pluginEvent: PluginEvent | null;
}
