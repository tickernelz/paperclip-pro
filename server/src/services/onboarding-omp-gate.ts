import {
  bundledOmpVersion,
  ompGateFailure,
  probeOmpInstall,
  type OmpInstallProbe,
} from "@tickernelz/wardmote-adapter-omp-local/readiness";

const GATE_PROBE_TIMEOUT_MS = 5_000;

export interface OnboardingOmpGateInput {
  adapterType: unknown;
  adapterConfig: unknown;
  defaultEnvironmentId?: unknown;
}

export async function onboardingOmpGateFailure(
  input: OnboardingOmpGateInput,
  env: NodeJS.ProcessEnv = process.env,
  probe: (command: string | null) => Promise<OmpInstallProbe> = (command) => probeOmpInstall({ command, env, timeoutMs: GATE_PROBE_TIMEOUT_MS }),
): Promise<string | null> {
  if (input.adapterType !== "omp_local") return null;
  if (typeof input.defaultEnvironmentId === "string" && input.defaultEnvironmentId) return null;
  if (bundledOmpVersion(env)) return null;
  const config = typeof input.adapterConfig === "object" && input.adapterConfig !== null
    ? input.adapterConfig as Record<string, unknown>
    : {};
  const command = typeof config.command === "string" && config.command.trim() ? config.command.trim() : null;
  return ompGateFailure(await probe(command));
}
