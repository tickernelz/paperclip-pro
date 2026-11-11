import type { Environment } from "@tickernelz/wardmote-shared";

/**
 * The managed-sandbox-only policy hides the local environment and runs every
 * agent in the managed sandbox, but no managed sandbox environment is
 * available. The Test resolution throws this error so the Test surfaces a
 * fail-closed message, the same way a real run fails closed. The Test must not
 * fall back to a local host probe, because a host probe would report a result
 * for a target the real run never uses.
 */
export class ManagedSandboxUnavailableForTestError extends Error {
  constructor() {
    super(
      "This instance runs agents only in its managed sandbox environment, but no " +
        "managed sandbox environment is available to test in. Check that the managed " +
        "sandbox provider is active, then retry the test.",
    );
    this.name = "ManagedSandboxUnavailableForTestError";
  }
}

export function resolveAdapterTestEnvironmentId(input: {
  agentDefaultEnvironmentId: string | null | undefined;
  instanceDefaultEnvironmentId: string | null | undefined;
  localDefaultEnvironmentId: string | null | undefined;
  managedSandboxOnly?: boolean;
  managedSandboxEnvironmentId?: string | null | undefined;
  visibleEnvironmentIds?: readonly string[] | null | undefined;
}): string | null {
  const resolved =
    input.agentDefaultEnvironmentId ||
    input.instanceDefaultEnvironmentId ||
    input.localDefaultEnvironmentId ||
    null;
  if (input.managedSandboxOnly !== true) {
    return resolved;
  }
  const localDefaultId = input.localDefaultEnvironmentId || null;
  const resolvedNamesVisibleEnvironment =
    input.visibleEnvironmentIds == null ||
    resolved === null ||
    input.visibleEnvironmentIds.includes(resolved);
  const landsOnLocal =
    resolved === null || resolved === localDefaultId || !resolvedNamesVisibleEnvironment;
  if (!landsOnLocal) {
    return resolved;
  }
  if (!input.managedSandboxEnvironmentId) {
    throw new ManagedSandboxUnavailableForTestError();
  }
  return input.managedSandboxEnvironmentId;
}

export function resolveManagedSandboxEnvironmentId(
  environments: readonly Environment[] | null | undefined,
): string | null {
  if (!environments) return null;
  const managed = environments.find(
    (environment) =>
      environment.driver !== "local" &&
      environment.status === "active" &&
      environment.metadata?.managedByWardmote === true,
  );
  return managed?.id ?? null;
}

/**
 * Find the instance local-default environment id in an environment list. The
 * server auto-creates one `local` driver environment and stamps it with
 * `metadata.defaultForInstance: true` (see `ensureLocalEnvironment`). The Test
 * resolution uses this id as the final tier, so it probes the same environment
 * a real run resolves to when neither an agent default nor an instance default
 * is set. The function returns `null` when the list holds no such environment.
 */
export function resolveLocalDefaultEnvironmentId(
  environments: readonly Environment[] | null | undefined,
): string | null {
  if (!environments) return null;
  const local = environments.find(
    (environment) =>
      environment.driver === "local" && environment.metadata?.defaultForInstance === true,
  );
  return local?.id ?? null;
}
