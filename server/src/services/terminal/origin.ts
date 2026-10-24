import type { DeploymentMode } from "@tickernelz/paperclip-pro-shared";
import { resolvePrivateHostnameAllowSet } from "../../middleware/private-hostname-guard.js";

export interface TerminalOriginPolicy {
  deploymentMode: DeploymentMode;
  allowedHostnames: string[];
  bindHost: string;
  listenPort: number;
  hostnameGuardEnabled: boolean;
  publicBaseUrls: Array<string | null | undefined>;
}

const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0", "::", ""]);

export function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHostname(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
}

function hostnameFromHost(host: string): string | null {
  try {
    return normalizeHostname(new URL(`http://${host}`).hostname);
  } catch {
    return null;
  }
}

function originHost(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

export function trustedTerminalOrigins(policy: TerminalOriginPolicy): Set<string> {
  const trusted = new Set<string>();
  for (const hostname of policy.allowedHostnames.map(normalizeHostname).filter(Boolean)) {
    const origin = parseOrigin(`https://${originHost(hostname)}`);
    if (origin) trusted.add(origin);
  }
  for (const url of [...policy.publicBaseUrls, process.env.PAPERCLIP_PUBLIC_URL?.trim()]) {
    const origin = parseOrigin(url);
    if (origin) trusted.add(origin);
  }
  if (Number.isInteger(policy.listenPort) && policy.listenPort > 0) {
    const bindHost = normalizeHostname(policy.bindHost);
    const localHosts = LOOPBACK_BIND_HOSTS.has(bindHost) ? ["127.0.0.1", "localhost", "::1"] : [bindHost];
    for (const host of localHosts) {
      const origin = parseOrigin(`http://${originHost(host)}:${policy.listenPort}`);
      if (origin) trusted.add(origin);
    }
  }
  return trusted;
}

export function terminalHostAllowed(host: string | undefined, policy: TerminalOriginPolicy): boolean {
  if (!policy.hostnameGuardEnabled) return true;
  const hostname = host ? hostnameFromHost(host) : null;
  if (!hostname) return false;
  return resolvePrivateHostnameAllowSet({ allowedHostnames: policy.allowedHostnames, bindHost: policy.bindHost }).has(
    hostname,
  );
}

export function terminalOriginAllowed(
  input: { origin?: string; referer?: string; host?: string; hostname?: string },
  policy: TerminalOriginPolicy,
): boolean {
  if (!terminalHostAllowed(input.hostname ?? input.host, policy)) return false;
  const presented = input.origin ?? input.referer;
  if (presented === undefined || presented === "") return policy.deploymentMode === "local_trusted";
  const origin = parseOrigin(presented);
  return origin !== null && trustedTerminalOrigins(policy).has(origin);
}
