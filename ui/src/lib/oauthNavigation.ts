import type { ToolOAuthStartResult } from "@tickernelz/wardmote-shared";
import { resolveAuthorizationTarget } from "./authorizationUrl";

export type PreparedOAuthNavigation = {
  url: string;
  host: string;
};

export function prepareOAuthNavigation(
  start: Pick<ToolOAuthStartResult, "authorizationUrl">,
): PreparedOAuthNavigation {
  const target = resolveAuthorizationTarget(start.authorizationUrl);
  if (!target.ok) throw new Error(target.message);
  return { url: target.url, host: target.host };
}
