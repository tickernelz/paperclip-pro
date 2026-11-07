import { describe, expect, it, vi } from "vitest";
import type { OmpInstallProbe } from "@tickernelz/paperclip-pro-adapter-omp-local/readiness";
import { onboardingOmpGateFailure } from "./onboarding-omp-gate.js";

function probeOf(state: OmpInstallProbe["state"], version: string | null): OmpInstallProbe {
  return { state, version, path: version ? "/usr/bin/omp" : null, copies: [], minVersion: "18.1.16" };
}

const local = { adapterType: "omp_local", adapterConfig: {} };

describe("onboardingOmpGateFailure", () => {
  it("refuses an old local OMP with the update command", async () => {
    const failure = await onboardingOmpGateFailure(local, {}, async () => probeOf("too_old", "18.1.15"));
    expect(failure).toBe("OMP 18.1.15 is older than 18.1.16. Update it with: omp update");
  });

  it("refuses a missing local OMP and passes a current one", async () => {
    expect(await onboardingOmpGateFailure(local, {}, async () => probeOf("missing", null))).toMatch(/^OMP was not found/);
    expect(await onboardingOmpGateFailure(local, {}, async () => probeOf("ready", "18.1.16"))).toBeNull();
  });

  it("probes the configured command", async () => {
    const probe = vi.fn(async () => probeOf("ready", "18.2.0"));
    await onboardingOmpGateFailure({ adapterType: "omp_local", adapterConfig: { command: "/opt/omp/bin/omp" } }, {}, probe);
    expect(probe).toHaveBeenCalledWith("/opt/omp/bin/omp");
  });

  it("does not gate the Docker image, a remote environment, or another adapter", async () => {
    const probe = vi.fn(async () => probeOf("missing", null));
    expect(await onboardingOmpGateFailure(local, { PAPERCLIP_OMP_BUNDLED_VERSION: "18.18.0" }, probe)).toBeNull();
    expect(await onboardingOmpGateFailure({ ...local, defaultEnvironmentId: "env-1" }, {}, probe)).toBeNull();
    expect(await onboardingOmpGateFailure({ adapterType: "process", adapterConfig: {} }, {}, probe)).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});
