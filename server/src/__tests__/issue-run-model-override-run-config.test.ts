import { describe, expect, it } from "vitest";
import { buildIssueRunAdapterConfig } from "../services/issue-run-model-override.js";

describe("per-task model override in the run execution config", () => {
  const agentConfig = {
    command: "omp",
    model: "vendor/agent-default",
    thinking: "low",
  };

  it("keeps the agent's own values when the task carries no override", () => {
    const built = buildIssueRunAdapterConfig(agentConfig, null);
    expect(built.config.model).toBe("vendor/agent-default");
    expect(built.config.thinking).toBe("low");
    expect(built.modelOverride).toEqual({ model: null, thinking: null });
  });

  it("overrides the agent's model and thinking for this run only", () => {
    const built = buildIssueRunAdapterConfig(agentConfig, {
      adapterConfig: { model: "vendor/task-model", thinking: "high" },
    });
    expect(built.config.model).toBe("vendor/task-model");
    expect(built.config.thinking).toBe("high");
    expect(built.config.command).toBe("omp");
    expect(agentConfig.model).toBe("vendor/agent-default");
  });

  it("falls back per key so a model-only override keeps the agent's thinking", () => {
    const built = buildIssueRunAdapterConfig(agentConfig, {
      adapterConfig: { model: "vendor/task-model" },
    });
    expect(built.config.thinking).toBe("low");
    expect(built.modelOverride).toEqual({
      model: "vendor/task-model",
      thinking: null,
    });
  });

  it("keeps a task's own thinking when it picks a model that also has a fallback effort", () => {
    const built = buildIssueRunAdapterConfig(
      {
        model: "vendor/agent-default",
        thinking: "low",
        fallbackModels: ["vendor/task-model", "vendor/other"],
        modelEfforts: { "vendor/task-model": "max", "vendor/other": "minimal" },
      },
      { adapterConfig: { model: "vendor/task-model", thinking: "medium" } },
    );
    expect(built.config.thinking).toBe("medium");
    expect(built.config.modelEfforts).toEqual({ "vendor/other": "minimal" });
  });

  it("keeps the fallback effort when the task picks the model without a thinking level", () => {
    const built = buildIssueRunAdapterConfig(
      {
        model: "vendor/agent-default",
        thinking: "low",
        fallbackModels: ["vendor/task-model"],
        modelEfforts: { "vendor/task-model": "max" },
      },
      { adapterConfig: { model: "vendor/task-model" } },
    );
    expect(built.config.modelEfforts).toEqual({ "vendor/task-model": "max" });
  });

  it("reports only the model override in the run context snapshot", () => {
    const built = buildIssueRunAdapterConfig(agentConfig, {
      adapterConfig: {
        thinking: "high",
        workspaceStrategy: { type: "git_worktree" },
      },
    });
    expect(built.modelOverride).toEqual({ model: null, thinking: "high" });
    expect(built.config.workspaceStrategy).toEqual({ type: "git_worktree" });
  });
});
