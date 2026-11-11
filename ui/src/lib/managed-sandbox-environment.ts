import type { Environment } from "@tickernelz/wardmote-shared";

export function isPlatformManagedEnvironment(
  environment: Pick<Environment, "metadata"> | null | undefined,
): boolean {
  return environment?.metadata?.managedByWardmote === true;
}

export function environmentDisplayLabel(
  environment: Pick<Environment, "name" | "driver" | "metadata">,
): string {
  if (isPlatformManagedEnvironment(environment)) return environment.name;
  return `${environment.name} · ${environment.driver}`;
}

/**
 * Client-side mirror of the server's managed-sandbox-only read filter: the
 * local environment never renders when `enableManagedSandboxOnly` is on.
 * The server already omits local rows from the environments API under the
 * same flag, so this is defense in depth for cached or stale lists.
 */
export function filterManagedSandboxSelectableEnvironments<
  T extends Pick<Environment, "driver">,
>(environments: readonly T[], managedSandboxOnly: boolean): T[] {
  return managedSandboxOnly
    ? environments.filter((environment) => environment.driver !== "local")
    : [...environments];
}
