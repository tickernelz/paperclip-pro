export type CloudInstanceEnv = Record<string, string | undefined>;

function normalizeOptionalEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * The canonical Paperclip Cloud instance predicate.
 *
 * The tenant token is the signal injected on live cloud stacks. The managed
 * config document is the legacy/bootstrap signal used by managed feature and
 * plugin floors. Their union is intentionally monotonic: either prior signal
 * keeps every restrictive cloud floor enabled.
 */
export function isCloudManagedInstance(
  env: CloudInstanceEnv = process.env,
): boolean {
  return (
    normalizeOptionalEnvValue(env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN) !== null ||
    env.PAPERCLIP_MANAGED_CONFIG !== undefined
  );
}
