import { defaultSlackAppConfiguration } from "@tickernelz/paperclip-pro-shared";

export function slackBotNameForAgent(agentName: string): string {
  return defaultSlackAppConfiguration(agentName).botName;
}

export function defaultSlackAppName(agentName: string): string {
  return defaultSlackAppConfiguration(agentName).appName;
}
