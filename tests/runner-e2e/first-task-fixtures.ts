import { normalizePaperclipOperationalSkillPreference } from "../../packages/adapter-utils/src/server-utils.js";
import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "../../packages/shared/src/constants.js";
import type { RunnerApi } from "./api.js";
import type { LiveFixtureValues } from "./live-fixtures.js";
import type { CredentialName, MatrixExecution } from "./types.js";

export async function provisionFirstTaskFixtures(input: {
  api: Pick<RunnerApi, "get" | "postSensitive">;
  execution: MatrixExecution;
  nonce: string;
  company: LiveFixtureValues["company"];
  credentials: Partial<Record<CredentialName, string>>;
}): Promise<LiveFixtureValues> {
  const { api, execution, nonce, company, credentials } = input;
  if (
    !["first-task", "completion-updates", "confirmation-replies"].includes(execution.suite.id) || execution.task.flow !== "first_task" ||
    execution.environment.id !== "local" ||
    ![
      "legacy-codex",
      "legacy-claude",
      "runner-codex",
      "runner-acpx-claude",
    ].includes(execution.profile.id)
  ) {
    throw new Error(
      "First-task fixtures require a supported local onboarding profile",
    );
  }
  const credential = execution.profile.credential;
  const value = credentials[credential];
  if (!value) throw new Error(`Missing credential ${credential}`);
  const environments = await api.get<Array<LiveFixtureValues["environment"]>>(
    `/api/companies/${company.id}/environments?driver=local`,
  );
  const environment = environments.find((e) => e.driver === "local");
  if (!environment)
    throw new Error("Onboarding fixture local environment missing");
  const secret = await api.postSensitive<{ id: string }>(
    `/api/companies/${company.id}/secrets`,
    {
      name: `First task ${credential}`,
      key: credential,
      value,
    },
  );
  return {
    company,
    environment,
    secretRefs: {
      [credential]: {
        type: "secret_ref",
        secretId: secret.id,
        version: "latest",
      },
    },
    agent: { id: "", name: `Garden lead ${nonce}`, companyId: company.id },
    teardown: async () => {}, // Existing launcher removes the complete isolated instance.
  };
}

export function firstTaskHireRequest(
  execution: MatrixExecution,
  fixtures: LiveFixtureValues,
) {
  const credential = execution.profile.credential;
  const env = { [credential]: fixtures.secretRefs[credential] };
  const codex = credential === "OPENAI_API_KEY";
  return {
    name: fixtures.agent.name,
    role: "general",
    adapterType: codex ? "codex_local" : "claude_local",
    adapterConfig: codex
      ? { timeoutSec: 0, graceSec: 15, env, search: false, fastMode: false, dangerouslyBypassApprovalsAndSandbox: true }
      : { timeoutSec: 0, graceSec: 15, env, maxTurnsPerRun: 1000, dangerouslySkipPermissions: true },
    onboardingFirstAgent: true,
    runtimeConfig: {
      heartbeat: {
        enabled: false,
        intervalSec: 300,
        wakeOnDemand: true,
        skipTimerWhenNoActionableWork: true,
        cooldownSec: 10,
        maxConcurrentRuns: AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
      },
    },
  };
}

/** Reuse the qualified runtime configuration only, never the QA persona from
 * buildAgent. */
export function firstTaskNativeRuntimePatch(
  execution: MatrixExecution,
  fixtures: LiveFixtureValues,
  agent: Record<string, any>,
) {
  if (!["runner-codex", "runner-acpx-claude"].includes(execution.profile.id))
    throw new Error("Unsupported native first-task profile");
  const built = execution.profile.buildAgent({
    environmentId: fixtures.environment.id,
    environmentFixtureId: "local",
    workspacePath: agent.adapterConfig?.cwd ?? "",
    secretRefs: fixtures.secretRefs,
    executionId: execution.id,
  });
  const config = {
    ...agent.adapterConfig,
    ...(built.adapterConfig as Record<string, unknown>),
  };
  if (agent.adapterConfig?.model == null) delete config.model;
  else config.model = agent.adapterConfig.model;
  return {
    adapterType: "paperclip_runner",
    adapterConfig: normalizePaperclipOperationalSkillPreference(
      "paperclip_runner",
      config,
    ),
  };
}
