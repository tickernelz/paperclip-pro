import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { agents } from "@tickernelz/wardmote-db";
import { sessionCodec as codexSessionCodec } from "../services/ai-providers/codex/session-codec.js";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import {
  applyPersistedExecutionWorkspaceConfig,
  assertGitWorktreeBaseWorkspaceReady,
  buildExplicitResumeSessionOverride,
  buildEffectiveRunSessionConfigMetadata,
  buildEffectiveRunWorkspaceConfigMetadata,
  buildWorkspaceConfigFreshnessOperation,
  deriveTaskKeyWithHeartbeatFallback,
  canonicalIssueTaskKey,
  formatRuntimeWorkspaceWarningLog,
  mergeExecutionWorkspaceMetadataForPersistence,
  mergeCoalescedContextSnapshot,
  preflightLowTrustWorkspaceIsolation,
  prioritizeProjectWorkspaceCandidatesForRun,
  parseSessionCompactionPolicy,
  provisionExecutionWorkspaceForFreshnessDecision,
  reconcileReusedExecutionWorkspaceProjectWorkspaceId,
  resolveNativeRecoveryExecutionWorkspaceBinding,
  resolveExecutionWorkspaceBranchOwnership,
  resolveExecutionWorkspaceConfigFreshness,
  resolveExecutionWorkspaceReuseRequestForIssue,
  resolveExecutionWorkspaceReuseProvisioningPolicy,
  resolveNextSessionState,
  resolveTaskSessionConfigFreshness,
  isWorkspaceSyncConflictFailure,
  resolveWorkspaceAfterLowTrustPreflight,
  resolveRuntimeSessionParamsForWorkspace,
  shouldDeferFollowupWakeForSameIssue,
  stripHostWorkspaceProvisionForLowTrustSandbox,
  stripWorkspaceRuntimeFromExecutionRunConfig,
  shouldResetTaskSessionForModelChange,
  stripConfiguredModelFromSessionParams,
  stripWardmoteSessionMetadataFromSessionParams,
  normalizeSessionParams,
  isTaskSessionCredentialCompatible,
  shouldResetTaskSessionForWake,
  scrubGitCredentialText,
  buildAnchorFallbackWorkspaceNotes,
  type ResolvedWorkspaceForRun,
} from "../services/heartbeat.ts";
import type { TrustPresetResolution } from "../services/trust-preset-resolver.ts";

const execFile = promisify(execFileCallback);

function buildResolvedWorkspace(overrides: Partial<ResolvedWorkspaceForRun> = {}): ResolvedWorkspaceForRun {
  return {
    cwd: "/tmp/project",
    source: "project_primary",
    projectId: "project-1",
    workspaceId: "workspace-1",
    repoUrl: null,
    repoRef: null,
    workspaceHints: [],
    warnings: [],
    baseCwdFallback: false,
    materializationFailures: [],
    ...overrides,
  };
}

async function runGit(cwd: string, args: string[]) {
  await execFile("git", args, { cwd });
}

async function createGitCheckout(options: { withRemote: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-push-preflight-"));
  await runGit(root, ["init"]);
  if (options.withRemote) {
    await runGit(root, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
  }
  return root;
}

function buildAgent(adapterType: string, runtimeConfig: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    name: "Agent",
    role: "engineer",
    title: null,
    icon: null,
    status: "running",
    reportsTo: null,
    capabilities: null,
    adapterType,
    adapterConfig: {},
    runtimeConfig,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as typeof agents.$inferSelect;
}

function lowTrustResolution(): TrustPresetResolution {
  return {
    kind: "low_trust_review",
    preset: "low_trust_review",
    boundary: {
      mode: "low_trust_review",
      companyId: "company-1",
      rootIssueId: "issue-1",
    },
    sourcePresets: { agent: "low_trust_review" },
  };
}

function standardTrustResolution(): TrustPresetResolution {
  return {
    kind: "standard",
    preset: "standard",
    boundary: null,
    sourcePresets: {},
  };
}

function buildIssueAncestryDb(rows: Array<{ id: string; companyId: string; parentId: string | null }>) {
  const queue = [...rows];
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const row = queue.shift();
          return Promise.resolve(row ? [row] : []);
        },
      }),
    }),
  };
}

describe("assertGitWorktreeBaseWorkspaceReady", () => {
  it.each(["all_external", "mixed", "malformed"])("keeps materialization aggregation fail-closed: %s", async (kind) => {
    const first = { schemaVersion: 1, provider: "git", operation: "clone", reason: "authentication_failed" } as const;
    const second = kind === "all_external" ? { ...first, reason: "dns_failure" as const } :
      kind === "malformed" ? { ...first, reason: "unknown" } : undefined;
    const failures = [first, second].map((connectionFailure, index) => ({
      projectWorkspaceId: `workspace-${index}`, repoUrl: "https://example.test/team/repo.git",
      error: "Managed checkout failed", ...(connectionFailure ? { connectionFailure } : {}),
    }));
    const error = await assertGitWorktreeBaseWorkspaceReady({
      requestedExecutionWorkspaceMode: "isolated_workspace",
      config: { workspaceStrategy: { type: "git_worktree" } },
      issue: { id: "issue-1", identifier: "TEST-1", projectId: "project-1", projectWorkspaceId: "workspace-0" },
      base: { baseCwd: "/tmp/unused-fallback", source: "project_primary", projectId: "project-1", workspaceId: "workspace-0", repoUrl: "https://example.test/team/repo.git", repoRef: null },
      anchor: { baseCwdFallback: true, materializationFailures: failures as never },
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "workspace_validation_failed",
      resultJson: { workspaceValidation: { reason: "git_worktree_base_materialization_failed", materializationFailures: failures } },
    });
    expect((error as { resultJson: Record<string, unknown> }).resultJson.connectionFailure)
      .toEqual(kind === "all_external" ? first : undefined);
  });

  it("rejects projectless isolated git worktrees that resolved to agent_home", async () => {
    const fallbackCwd = resolveDefaultAgentWorkspaceDir("agent-1");

    await expect(assertGitWorktreeBaseWorkspaceReady({
      requestedExecutionWorkspaceMode: "isolated_workspace",
      config: { workspaceStrategy: { type: "git_worktree" } },
      issue: {
        id: "issue-1",
        identifier: "PAP-1",
        projectId: null,
        projectWorkspaceId: null,
        executionWorkspaceId: null,
        executionWorkspacePreference: "isolated_workspace",
      },
      base: {
        baseCwd: fallbackCwd,
        source: "agent_home",
        projectId: null,
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
      },
    })).rejects.toMatchObject({
      code: "workspace_validation_failed",
      message: expect.stringContaining("needs a project / project workspace or a reusable execution workspace"),
      resultJson: {
        workspaceValidation: expect.objectContaining({
          reason: "git_worktree_base_agent_home",
          issueId: "issue-1",
          resolvedWorkspaceSource: "agent_home",
          requestedExecutionWorkspaceMode: "isolated_workspace",
          workspaceStrategyType: "git_worktree",
        }),
      },
    });
  });

  it("rejects operator-branch git worktrees that resolved to agent_home", async () => {
    const fallbackCwd = resolveDefaultAgentWorkspaceDir("agent-1");

    await expect(assertGitWorktreeBaseWorkspaceReady({
      requestedExecutionWorkspaceMode: "operator_branch",
      config: { workspaceStrategy: { type: "git_worktree" } },
      issue: {
        id: "issue-1",
        identifier: "PAP-1",
        projectId: null,
        projectWorkspaceId: null,
      },
      base: {
        baseCwd: fallbackCwd,
        source: "agent_home",
        projectId: null,
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
      },
    })).rejects.toMatchObject({
      code: "workspace_validation_failed",
      resultJson: {
        workspaceValidation: expect.objectContaining({
          reason: "git_worktree_base_agent_home",
          requestedExecutionWorkspaceMode: "operator_branch",
        }),
      },
    });
  });

  it("rejects isolated git worktrees when the resolved base is not a git checkout", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-non-git-workspace-"));
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "isolated_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: "https://github.com/example/repo.git",
          repoRef: "origin/master",
        },
      })).rejects.toMatchObject({
        code: "workspace_validation_failed",
        message: expect.stringContaining("is not a git checkout"),
        resultJson: {
          workspaceValidation: expect.objectContaining({
            reason: "git_worktree_base_not_git_checkout",
            issueId: "issue-1",
            resolvedWorkspaceSource: "project_primary",
            resolvedWorkspaceCwd: cwd,
          }),
        },
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  function configuredLocalPathInput(cwd: string): Parameters<typeof assertGitWorktreeBaseWorkspaceReady>[0] {
    return {
      requestedExecutionWorkspaceMode: "isolated_workspace",
      config: { workspaceStrategy: { type: "git_worktree" } },
      issue: { id: "issue-1", identifier: null, projectId: "project-1", projectWorkspaceId: "workspace-1" },
      base: { baseCwd: cwd, source: "project_primary", projectId: "project-1", workspaceId: "workspace-1", repoUrl: null, repoRef: null },
      anchor: { localPathOnlyWorkspace: true, baseCwdFallback: false, materializationFailures: [] },
    };
  }

  it("marks a proven non-Git local path as an owner configuration conflict without changing the failure", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-local-path-policy-"));
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady(configuredLocalPathInput(cwd))).rejects.toMatchObject({
        code: "workspace_validation_failed",
        message: expect.stringContaining("is not a git checkout"),
        resultJson: { workspaceValidation: {
          reason: "git_worktree_base_not_git_checkout",
          configurationReason: "local_path_requires_git_checkout",
        } },
      });
    } finally { await fs.rm(cwd, { recursive: true, force: true }); }
  });

  it.each(["legacy", "repository", "fallback", "materialization", "session", "unbound"])(
    "does not mark ambiguous non-Git workspace evidence as a configuration-only failure: %s", async (kind) => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-ambiguous-workspace-"));
      try {
        const input = configuredLocalPathInput(cwd);
        if (kind === "legacy") input.anchor!.localPathOnlyWorkspace = undefined;
        if (kind === "repository") input.base.repoUrl = "https://example.com/repository.git";
        if (kind === "fallback") input.anchor!.baseCwdFallback = true;
        if (kind === "materialization") input.anchor!.materializationFailures = [{ projectWorkspaceId: "another-workspace", repoUrl: null, error: "checkout failed" }];
        if (kind === "session") input.base.source = "task_session";
        if (kind === "unbound") input.base.workspaceId = null;
        const error = await assertGitWorktreeBaseWorkspaceReady(input).catch((error) => error);
        expect(error.code).toBe("workspace_validation_failed");
        expect(error.resultJson.workspaceValidation.configurationReason).toBeUndefined();
      } finally { await fs.rm(cwd, { recursive: true, force: true }); }
    },
  );

  it.each(["missing_git", "permission", "git_error", "killed", "missing_directory"])(
    "does not classify a Git or filesystem failure as an owner-only configuration mismatch: %s", async (kind) => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-git-probe-failure-"));
      const bin = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-git-probe-bin-"));
      try {
        if (kind !== "missing_git" && kind !== "missing_directory") {
          const command = kind === "killed"
            ? "kill -TERM $$"
            : kind === "permission"
              ? "printf '%s\\n' 'fatal: cannot open .git: Permission denied' >&2; exit 128"
              : "printf '%s\\n' 'fatal: bad object HEAD' >&2; exit 128";
          await fs.writeFile(path.join(bin, "git"), `#!/bin/sh\n${command}\n`, { mode: 0o755 });
        }
        if (kind !== "missing_directory") vi.stubEnv("PATH", bin);
        const input = configuredLocalPathInput(kind === "missing_directory" ? path.join(cwd, "absent") : cwd);
        const error = await assertGitWorktreeBaseWorkspaceReady(input).catch((error) => error);
        expect(error.code).toBe("workspace_validation_failed");
        expect(error.resultJson.workspaceValidation.configurationReason).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
        await fs.rm(cwd, { recursive: true, force: true });
        await fs.rm(bin, { recursive: true, force: true });
      }
    },
  );

  it("still accepts a configured local path that is a Git checkout", async () => {
    const cwd = await createGitCheckout({ withRemote: false });
    try { await expect(assertGitWorktreeBaseWorkspaceReady(configuredLocalPathInput(cwd))).resolves.toBeUndefined(); }
    finally { await fs.rm(cwd, { recursive: true, force: true }); }
  });

  it.each(["empty_metadata", "missing_head", "damaged_head", "dangling_metadata", "ancestor_metadata", "bare_metadata"])(
    "keeps real broken repository metadata reportable even when Git says not a repository: %s", async (kind) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-broken-local-repo-"));
      try {
        let cwd = root;
        if (kind === "missing_head" || kind === "damaged_head") {
          await execFile("git", ["init", root]);
          if (kind === "missing_head") await fs.rm(path.join(root, ".git", "HEAD"));
          else await fs.writeFile(path.join(root, ".git", "HEAD"), "damaged HEAD\n");
        } else if (kind === "dangling_metadata") {
          await fs.symlink(path.join(root, "missing-git-dir"), path.join(root, ".git"));
        } else if (kind === "bare_metadata") {
          await fs.mkdir(path.join(root, "objects"));
        } else {
          await fs.mkdir(path.join(root, ".git"));
          if (kind === "ancestor_metadata") {
            cwd = path.join(root, "documents");
            await fs.mkdir(cwd);
          }
        }
        const gitFailure = await execFile("git", ["rev-parse", "--show-toplevel"], {
          cwd, env: { ...process.env, LC_ALL: "C" },
        }).catch((error) => error);
        expect(gitFailure.code).toBe(128);
        expect(gitFailure.stderr).toMatch(/^fatal: not a git repository/);
        const failure = await assertGitWorktreeBaseWorkspaceReady(configuredLocalPathInput(cwd)).catch((error) => error);
        expect(failure.code).toBe("workspace_validation_failed");
        expect(failure.resultJson.workspaceValidation.configurationReason).toBeUndefined();
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    },
  );

  it("rejects isolated git worktrees when the project workspace could not be materialized, even if the fallback cwd is a git checkout", async () => {
    // The fallback agent-home dir being a git repo must not let the run proceed: it would be an
    // unrelated repository, and the not-a-git-checkout probe would mask the real clone failure.
    const cwd = await createGitCheckout({ withRemote: false });
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "isolated_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: "https://github.com/example/private-repo.git",
          repoRef: "origin/master",
        },
        anchor: {
          baseCwdFallback: true,
          materializationFailures: [{
            projectWorkspaceId: "workspace-1",
            repoUrl: "https://github.com/example/private-repo.git",
            error: 'Failed to prepare managed checkout for "https://github.com/example/private-repo.git": fatal: could not read Username',
          }],
        },
      })).rejects.toMatchObject({
        code: "workspace_validation_failed",
        message: expect.stringContaining("could not be prepared: Failed to prepare managed checkout"),
        resultJson: {
          workspaceValidation: expect.objectContaining({
            reason: "git_worktree_base_materialization_failed",
            issueId: "issue-1",
            baseCwdFallback: true,
            materializationFailures: [expect.objectContaining({
              projectWorkspaceId: "workspace-1",
              error: expect.stringContaining("could not read Username"),
            })],
          }),
        },
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the not-a-git-checkout reason for a fallback with no failed materialization attempt", async () => {
    // A configured path that is simply unavailable is not a clone failure; the message must
    // not steer the operator toward repairing clone access.
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-unavailable-path-fallback-"));
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "isolated_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: null,
          repoRef: null,
        },
        anchor: { baseCwdFallback: true },
      })).rejects.toMatchObject({
        code: "workspace_validation_failed",
        message: expect.stringContaining("is not a git checkout"),
        resultJson: {
          workspaceValidation: expect.objectContaining({
            reason: "git_worktree_base_not_git_checkout",
          }),
        },
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("refuses a git-checkout fallback cwd that is not the project workspace, without claiming a clone failed", async () => {
    const cwd = await createGitCheckout({ withRemote: false });
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "isolated_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: null,
          repoRef: null,
        },
        anchor: { baseCwdFallback: true, materializationFailures: [] },
      })).rejects.toMatchObject({
        code: "workspace_validation_failed",
        message: expect.stringContaining("configured project workspace path is not available"),
        resultJson: {
          workspaceValidation: expect.objectContaining({
            reason: "git_worktree_base_fallback_not_project_workspace",
            baseCwdFallback: true,
            materializationFailures: [],
          }),
        },
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows isolated git worktrees when the anchor reports no fallback", async () => {
    const cwd = await createGitCheckout({ withRemote: false });
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "isolated_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: "https://github.com/example/repo.git",
          repoRef: "origin/master",
        },
        anchor: { baseCwdFallback: false, materializationFailures: [] },
      })).resolves.toBeUndefined();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows isolated git worktrees when the resolved base is a git checkout", async () => {
    const cwd = await createGitCheckout({ withRemote: false });
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "isolated_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: "https://github.com/example/repo.git",
          repoRef: "origin/master",
        },
      })).resolves.toBeUndefined();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not require git for shared project-primary workspaces", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-shared-workspace-"));
    try {
      await expect(assertGitWorktreeBaseWorkspaceReady({
        requestedExecutionWorkspaceMode: "shared_workspace",
        config: { workspaceStrategy: { type: "git_worktree" } },
        issue: {
          id: "issue-1",
          identifier: "PAP-1",
          projectId: "project-1",
          projectWorkspaceId: "workspace-1",
        },
        base: {
          baseCwd: cwd,
          source: "project_primary",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: null,
          repoRef: null,
        },
      })).resolves.toBeUndefined();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows isolated workspace with no explicit strategy type even when base is agent_home", async () => {
    // No workspaceStrategy.type → realizeExecutionWorkspace defaults to project_primary (not git_worktree),
    // so the guard must not fire. This prevents false workspace_validation_failed for configs that omit type.
    const fallbackCwd = resolveDefaultAgentWorkspaceDir("agent-1");
    await expect(assertGitWorktreeBaseWorkspaceReady({
      requestedExecutionWorkspaceMode: "isolated_workspace",
      config: {},
      issue: {
        id: "issue-1",
        identifier: "PAP-1",
        projectId: null,
        projectWorkspaceId: null,
      },
      base: {
        baseCwd: fallbackCwd,
        source: "agent_home",
        projectId: null,
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
      },
    })).resolves.toBeUndefined();
  });

  it("allows operator-branch workspace with no explicit strategy type even when base is agent_home", async () => {
    const fallbackCwd = resolveDefaultAgentWorkspaceDir("agent-1");
    await expect(assertGitWorktreeBaseWorkspaceReady({
      requestedExecutionWorkspaceMode: "operator_branch",
      config: {},
      issue: {
        id: "issue-1",
        identifier: "PAP-1",
        projectId: null,
        projectWorkspaceId: null,
      },
      base: {
        baseCwd: fallbackCwd,
        source: "agent_home",
        projectId: null,
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
      },
    })).resolves.toBeUndefined();
  });
});

describe("scrubGitCredentialText", () => {
  it("masks URL userinfo including tokens", () => {
    expect(scrubGitCredentialText(
      'fatal: unable to access "https://x-access-token:ghp_abc123@github.com/example/repo.git"',
    )).toBe('fatal: unable to access "https://***@github.com/example/repo.git"');
  });

  it("masks bare-username userinfo and multiple occurrences", () => {
    expect(scrubGitCredentialText(
      "clone https://alice@github.com/a.git then http://token@internal.example/b.git",
    )).toBe("clone https://***@github.com/a.git then http://***@internal.example/b.git");
  });

  it("masks userinfo on non-HTTP schemes, leaving scp-style remotes alone", () => {
    expect(scrubGitCredentialText(
      "fatal: cannot clone ssh://deploy:hunter2@internal.example/repo.git or git+ssh://bob@host/x.git",
    )).toBe("fatal: cannot clone ssh://***@internal.example/repo.git or git+ssh://***@host/x.git");
    expect(scrubGitCredentialText("fetch from git@github.com:example/repo.git failed")).toBe(
      "fetch from git@github.com:example/repo.git failed",
    );
  });

  it("masks entire URL query strings regardless of parameter names", () => {
    expect(scrubGitCredentialText(
      "fatal: unable to access 'https://github.com/example/repo.git?access_token=ghs_secret&ref=main'",
    )).toBe("fatal: unable to access 'https://github.com/example/repo.git?***'");
    expect(scrubGitCredentialText(
      "clone https://gitlab.example/repo.git?anything=glpat-123 failed",
    )).toBe("clone https://gitlab.example/repo.git?*** failed");
  });

  it("leaves credential-free text unchanged", () => {
    const text = 'Failed to clone "https://github.com/example/repo.git": exit code 128';
    expect(scrubGitCredentialText(text)).toBe(text);
    const plain = "git clone failed with exit code=128 at key step ref=main";
    expect(scrubGitCredentialText(plain)).toBe(plain);
  });
});

describe("buildAnchorFallbackWorkspaceNotes", () => {
  it("reports materialization failures ahead of the generic no-cwd note", () => {
    expect(buildAnchorFallbackWorkspaceNotes({
      fallbackCwd: "/wardmote/workspaces/agent-1",
      preferredWorkspaceWarning: null,
      materializationFailures: [{
        projectWorkspaceId: "workspace-1",
        repoUrl: "https://github.com/example/private.git",
        error: "fatal: could not read Username",
      }],
      missingProjectCwds: [],
      hasConfiguredProjectCwd: false,
    })).toEqual([
      'Failed to prepare the project workspace checkout: fatal: could not read Username. Using fallback workspace "/wardmote/workspaces/agent-1" for this run.',
    ]);
  });

  it("counts additional failed candidates", () => {
    const failure = {
      projectWorkspaceId: "workspace-1",
      repoUrl: null,
      error: "clone timed out",
    };
    expect(buildAnchorFallbackWorkspaceNotes({
      fallbackCwd: "/fallback",
      preferredWorkspaceWarning: null,
      materializationFailures: [failure, { ...failure, projectWorkspaceId: "workspace-2" }],
      missingProjectCwds: [],
      hasConfiguredProjectCwd: false,
    })).toEqual([
      'Failed to prepare the project workspace checkout (clone timed out), and 1 other candidate workspace(s) also failed. Using fallback workspace "/fallback" for this run.',
    ]);
  });

  it("preserves the existing missing-path and no-cwd notes when nothing failed to materialize", () => {
    expect(buildAnchorFallbackWorkspaceNotes({
      fallbackCwd: "/fallback",
      preferredWorkspaceWarning: "Selected project workspace \"workspace-9\" is not available on this project.",
      materializationFailures: [],
      missingProjectCwds: ["/missing/path"],
      hasConfiguredProjectCwd: true,
    })).toEqual([
      'Selected project workspace "workspace-9" is not available on this project.',
      'Project workspace path "/missing/path" is not available yet. Using fallback workspace "/fallback" for this run.',
    ]);
    expect(buildAnchorFallbackWorkspaceNotes({
      fallbackCwd: "/fallback",
      preferredWorkspaceWarning: null,
      materializationFailures: [],
      missingProjectCwds: [],
      hasConfiguredProjectCwd: false,
    })).toEqual([
      'Project workspace has no local cwd configured. Using fallback workspace "/fallback" for this run.',
    ]);
  });

  it("emits both failure and missing-path notes when a project has both kinds of candidates", () => {
    expect(buildAnchorFallbackWorkspaceNotes({
      fallbackCwd: "/fallback",
      preferredWorkspaceWarning: null,
      materializationFailures: [{
        projectWorkspaceId: "workspace-1",
        repoUrl: "https://github.com/example/private.git",
        error: "authentication failed",
      }],
      missingProjectCwds: ["/missing/path"],
      hasConfiguredProjectCwd: true,
    })).toEqual([
      'Failed to prepare the project workspace checkout: authentication failed. Using fallback workspace "/fallback" for this run.',
      'Project workspace path "/missing/path" is not available yet. Using fallback workspace "/fallback" for this run.',
    ]);
  });
});

describe("stripHostWorkspaceProvisionForLowTrustSandbox", () => {
  it("removes only the host-side provision command for sandbox-backed low-trust runs", () => {
    const config = {
      workspaceStrategy: {
        type: "git_worktree",
        branchTemplate: "{{issue.identifier}}-{{slug}}",
        provisionCommand: "bash ./scripts/provision-worktree.sh",
        teardownCommand: "bash ./scripts/teardown-worktree.sh",
      },
      workspaceRuntime: {
        services: [{ name: "web" }],
      },
    };

    const result = stripHostWorkspaceProvisionForLowTrustSandbox({
      config,
      trustPreset: lowTrustResolution(),
      selectedEnvironmentDriver: "sandbox",
    });

    expect(result).not.toBe(config);
    expect(result.workspaceStrategy).toEqual({
      type: "git_worktree",
      branchTemplate: "{{issue.identifier}}-{{slug}}",
      teardownCommand: "bash ./scripts/teardown-worktree.sh",
    });
    expect(result.workspaceRuntime).toBe(config.workspaceRuntime);
    expect(config.workspaceStrategy.provisionCommand).toBe("bash ./scripts/provision-worktree.sh");
  });

  it("preserves provision commands for standard-trust runs", () => {
    const config = {
      workspaceStrategy: {
        type: "git_worktree",
        provisionCommand: "bash ./scripts/provision-worktree.sh",
      },
    };

    expect(stripHostWorkspaceProvisionForLowTrustSandbox({
      config,
      trustPreset: standardTrustResolution(),
      selectedEnvironmentDriver: "sandbox",
    })).toBe(config);
  });

  it("preserves provision commands when a low-trust run is not sandbox-backed", () => {
    const config = {
      workspaceStrategy: {
        type: "git_worktree",
        provisionCommand: "bash ./scripts/provision-worktree.sh",
      },
    };

    expect(stripHostWorkspaceProvisionForLowTrustSandbox({
      config,
      trustPreset: lowTrustResolution(),
      selectedEnvironmentDriver: "local",
    })).toBe(config);
  });
});

describe("preflightLowTrustWorkspaceIsolation", () => {
  it("fails non-sandbox low-trust runs before the caller reaches host workspace side effects", async () => {
    let hostWorkspaceSideEffectReached = false;

    await expect((async () => {
      await preflightLowTrustWorkspaceIsolation({
        trustPreset: lowTrustResolution(),
        isolatedWorkspacesEnabled: true,
        effectiveExecutionWorkspaceMode: "isolated_workspace",
        issue: {
          companyId: "company-1",
          id: "issue-1",
          projectId: "project-1",
        },
        resolveSelectedEnvironmentDriver: async () => "local",
      });
      hostWorkspaceSideEffectReached = true;
    })()).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "low_trust_requires_sandbox_environment",
      }),
    });

    expect(hostWorkspaceSideEffectReached).toBe(false);
  });

  it("returns the sandbox driver for sandbox-backed low-trust runs", async () => {
    await expect(preflightLowTrustWorkspaceIsolation({
      trustPreset: lowTrustResolution(),
      isolatedWorkspacesEnabled: true,
      effectiveExecutionWorkspaceMode: "isolated_workspace",
      issue: {
        companyId: "company-1",
        id: "issue-1",
        projectId: "project-1",
      },
      resolveSelectedEnvironmentDriver: async () => "sandbox",
    })).resolves.toBe("sandbox");
  });

  it("allows child issues inside a rootIssueId low-trust boundary during workspace preflight", async () => {
    await expect(preflightLowTrustWorkspaceIsolation({
      db: buildIssueAncestryDb([
        { id: "issue-child", companyId: "company-1", parentId: "issue-1" },
        { id: "issue-1", companyId: "company-1", parentId: null },
      ]) as any,
      trustPreset: lowTrustResolution(),
      isolatedWorkspacesEnabled: true,
      effectiveExecutionWorkspaceMode: "isolated_workspace",
      issue: {
        companyId: "company-1",
        id: "issue-child",
        projectId: null,
      },
      resolveSelectedEnvironmentDriver: async () => "sandbox",
    })).resolves.toBe("sandbox");
  });
});

describe("resolveWorkspaceAfterLowTrustPreflight", () => {
  it("fails non-sandbox low-trust runs before resolving workspaces", async () => {
    let workspaceResolverReached = false;

    await expect(resolveWorkspaceAfterLowTrustPreflight({
      trustPreset: lowTrustResolution(),
      isolatedWorkspacesEnabled: true,
      effectiveExecutionWorkspaceMode: "isolated_workspace",
      issue: {
        companyId: "company-1",
        id: "issue-1",
        projectId: "project-1",
      },
      resolveSelectedEnvironmentDriver: async () => "local",
      resolveWorkspace: async () => {
        workspaceResolverReached = true;
        return buildResolvedWorkspace();
      },
    })).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "low_trust_requires_sandbox_environment",
      }),
    });

    expect(workspaceResolverReached).toBe(false);
  });

  it("preserves standard-trust workspace resolution", async () => {
    const workspace = buildResolvedWorkspace({ cwd: "/tmp/standard-workspace" });

    await expect(resolveWorkspaceAfterLowTrustPreflight({
      trustPreset: standardTrustResolution(),
      isolatedWorkspacesEnabled: false,
      effectiveExecutionWorkspaceMode: "shared_workspace",
      issue: {
        companyId: "company-1",
        id: "issue-1",
        projectId: "project-1",
      },
      resolveSelectedEnvironmentDriver: async () => {
        throw new Error("standard trust should not inspect the environment driver");
      },
      resolveWorkspace: async () => workspace,
    })).resolves.toEqual({
      selectedEnvironmentDriver: null,
      workspace,
    });
  });
});

describe("resolveRuntimeSessionParamsForWorkspace", () => {
  it("keeps a legacy projectless Codex session in the default agent workspace", () => {
    const agentId = "agent-projectless-legacy";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);
    const previousSessionParams = {
      sessionId: "legacy-session-1",
      cwd: fallbackCwd,
    };

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams,
      resolvedWorkspace: buildResolvedWorkspace({
        cwd: fallbackCwd,
        source: "agent_home",
        projectId: null,
        workspaceId: null,
      }),
    });

    expect(result).toEqual({
      sessionParams: previousSessionParams,
      warning: null,
    });
  });

  it("migrates fallback workspace sessions to project workspace when project cwd becomes available", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: {
        sessionId: "session-1",
        cwd: fallbackCwd,
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
    });

    expect(result.sessionParams).toMatchObject({
      sessionId: "session-1",
      cwd: "/tmp/new-project-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toContain("Attempting to resume session");
  });

  it("does not migrate when previous session cwd is not the fallback workspace", () => {
    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId: "agent-123",
      previousSessionParams: {
        sessionId: "session-1",
        cwd: "/tmp/some-other-cwd",
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
    });

    expect(result.sessionParams).toEqual({
      sessionId: "session-1",
      cwd: "/tmp/some-other-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toBeNull();
  });

  it("does not migrate when resolved workspace id differs from previous session workspace id", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: {
        sessionId: "session-1",
        cwd: fallbackCwd,
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({
        cwd: "/tmp/new-project-cwd",
        workspaceId: "workspace-2",
      }),
    });

    expect(result.sessionParams).toEqual({
      sessionId: "session-1",
      cwd: fallbackCwd,
      workspaceId: "workspace-1",
    });
    expect(result.warning).toBeNull();
  });
});

describe("applyPersistedExecutionWorkspaceConfig", () => {
  it("does not add workspace runtime when only the project workspace had manual runtime config", () => {
    const result = applyPersistedExecutionWorkspaceConfig({
      config: {},
      workspaceConfig: null,
      mode: "isolated_workspace",
    });

    expect("workspaceRuntime" in result).toBe(false);
  });

  it("applies explicit persisted execution workspace runtime config when present", () => {
    const result = applyPersistedExecutionWorkspaceConfig({
      config: {},
      workspaceConfig: {
        provisionCommand: null,
        teardownCommand: null,
        cleanupCommand: null,
        desiredState: null,
        workspaceRuntime: {
          services: [{ name: "workspace-web" }],
        },
      },
      mode: "isolated_workspace",
    });

    expect(result.workspaceRuntime).toEqual({
      services: [{ name: "workspace-web" }],
    });
  });
});

describe("mergeExecutionWorkspaceMetadataForPersistence", () => {
  it("persists branch ownership independently of fresh worktree creation", () => {
    const executionWorkspace = {
      created: true,
      branchCreatedByRuntime: false,
    };

    const metadata = mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: null,
      source: "task_session",
      createdByRuntime: resolveExecutionWorkspaceBranchOwnership(executionWorkspace),
      strategyType: "git_worktree",
      configSnapshot: null,
      shouldReuseExisting: false,
      baseRef: "origin/main",
      baseRefSha: null,
    });

    expect(metadata.createdByRuntime).toBe(false);
    expect(metadata.gitBranchOwnershipVersion).toBe(1);
  });

  it("does not downgrade recorded runtime ownership after worktree reuse", () => {
    const executionWorkspace = {
      created: false,
      branchCreatedByRuntime: true,
    };

    const metadata = mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: { createdByRuntime: true },
      source: "task_session",
      createdByRuntime: resolveExecutionWorkspaceBranchOwnership(executionWorkspace),
      strategyType: "git_worktree",
      configSnapshot: null,
      shouldReuseExisting: false,
      baseRef: "origin/main",
      baseRefSha: null,
    });

    expect(metadata.createdByRuntime).toBe(true);
    expect(metadata.gitBranchOwnershipVersion).toBe(1);
  });

  it("merges config snapshot for newly realized workspaces", () => {
    expect(mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: null,
      source: "task_session",
      createdByRuntime: true,
      strategyType: "project_primary",
      configSnapshot: {
        environmentId: "env-new",
        provisionCommand: "bash ./scripts/provision.sh",
      },
      shouldReuseExisting: false,
      baseRef: null,
      baseRefSha: null,
    })).toEqual({
      source: "task_session",
      createdByRuntime: true,
      config: {
        environmentId: "env-new",
        provisionCommand: "bash ./scripts/provision.sh",
        runtimeProvisionCommand: null,
        teardownCommand: null,
        cleanupCommand: null,
        desiredState: null,
        serviceStates: null,
        workspaceRuntime: null,
      },
    });
  });

  it("preserves persisted config snapshot when reusing an existing workspace", () => {
    expect(mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: {
        config: {
          environmentId: "env-old",
          provisionCommand: "bash ./scripts/existing-provision.sh",
        },
      },
      source: "task_session",
      createdByRuntime: false,
      strategyType: "project_primary",
      configSnapshot: {
        environmentId: "env-new",
        provisionCommand: "bash ./scripts/new-provision.sh",
      },
      shouldReuseExisting: true,
      baseRef: null,
      baseRefSha: null,
    })).toEqual({
      config: {
        environmentId: "env-old",
        provisionCommand: "bash ./scripts/existing-provision.sh",
      },
      source: "task_session",
      createdByRuntime: false,
    });
  });

  it("records the resolved base ref SHA for newly realized workspaces", () => {
    expect(mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: null,
      source: "task_session",
      createdByRuntime: true,
      strategyType: "project_primary",
      configSnapshot: null,
      shouldReuseExisting: false,
      baseRef: "origin/main",
      baseRefSha: "abc1234567890",
    })).toEqual({
      source: "task_session",
      createdByRuntime: true,
      baseRefSnapshot: {
        baseRef: "origin/main",
        resolvedSha: "abc1234567890",
      },
    });
  });
});

type WorkspaceConfigMetadata = ReturnType<typeof buildEffectiveRunWorkspaceConfigMetadata>;

function buildWorkspaceConfigMetadata(
  overrides: Partial<Parameters<typeof buildEffectiveRunWorkspaceConfigMetadata>[0]> = {},
) {
  return buildEffectiveRunWorkspaceConfigMetadata({
    mode: "isolated_workspace",
    projectId: "project-1",
    projectWorkspaceId: "workspace-1",
    strategyType: "git_worktree",
    workspaceStrategy: {
      type: "git_worktree",
      baseRef: "origin/main",
      branchTemplate: "{{issue.identifier}}-{{slug}}",
      worktreeParentDir: ".wardmote/worktrees",
    },
    repoUrl: "https://github.com/example/repo.git",
    repoRef: "origin/main",
    configSnapshot: {
      provisionCommand: "pnpm install",
      teardownCommand: "pnpm stop",
      cleanupCommand: "pnpm clean",
      desiredState: "running",
      serviceStates: { "0": "running" },
      workspaceRuntime: {
        services: [{ name: "web", command: "pnpm dev", port: 3100 }],
      },
    },
    environment: {
      selectedEnvironmentId: "environment-1",
      driver: "local",
      config: { provider: "local" },
    },
    realization: {
      environmentDriver: "local",
      environmentProvider: "local",
    },
    evaluatedAt: "2026-06-26T00:00:00.000Z",
    ...overrides,
  });
}

function persistedWorkspaceConfigFingerprint(metadata: WorkspaceConfigMetadata) {
  return {
    configFingerprint: {
      version: metadata.version,
      workspaceHash: metadata.fingerprint,
      categories: metadata.categories,
      categoryFingerprints: metadata.categoryFingerprints,
      lastEvaluatedAt: metadata.evaluatedAt,
    },
  };
}

describe("effective run execution workspace config freshness", () => {
  it("reuses an existing workspace when the stored workspace fingerprint is unchanged", () => {
    const metadata = buildWorkspaceConfigMetadata();

    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(metadata),
      nextMetadata: metadata,
    });

    expect(decision).toMatchObject({
      action: "reuse",
      shouldReuseExisting: true,
      shouldRefreshConfigSnapshot: false,
      changedCategories: [],
      storedFingerprintPresent: true,
    });
  });

  it("refreshes metadata and config for runtime-service-only drift without replacing the workspace", () => {
    const base = buildWorkspaceConfigMetadata();
    const next = buildWorkspaceConfigMetadata({
      configSnapshot: {
        provisionCommand: "pnpm install",
        teardownCommand: "pnpm stop",
        cleanupCommand: "pnpm clean",
        desiredState: "running",
        serviceStates: { "0": "running" },
        workspaceRuntime: {
          services: [{ name: "web", command: "pnpm dev -- --host 0.0.0.0", port: 3200 }],
        },
      },
    });

    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(base),
      nextMetadata: next,
    });

    expect(decision).toMatchObject({
      action: "refresh",
      shouldReuseExisting: true,
      shouldRefreshConfigSnapshot: true,
      changedCategories: ["runtimeServices"],
    });

    const metadata = mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: {
        config: {
          workspaceRuntime: { services: [{ name: "web", command: "pnpm dev", port: 3100 }] },
        },
        ...persistedWorkspaceConfigFingerprint(base),
      },
      source: "task_session",
      createdByRuntime: false,
      strategyType: "project_primary",
      configSnapshot: {
        workspaceRuntime: {
          services: [{ name: "web", command: "pnpm dev -- --host 0.0.0.0", port: 3200 }],
        },
        desiredState: "running",
        serviceStates: { "0": "running" },
      },
      shouldReuseExisting: true,
      shouldRefreshConfigSnapshot: true,
      workspaceConfigMetadata: next,
      baseRef: "origin/main",
      baseRefSha: "abc123",
    });

    expect(metadata?.config).toMatchObject({
      workspaceRuntime: {
        services: [{ name: "web", command: "pnpm dev -- --host 0.0.0.0", port: 3200 }],
      },
    });
    expect(metadata?.configFingerprint).toMatchObject({
      workspaceHash: next.fingerprint,
      categories: next.categories,
    });
  });

  it.each([
    {
      name: "mode",
      category: "mode",
      next: buildWorkspaceConfigMetadata({ mode: "shared_workspace" }),
    },
    {
      name: "workspace strategy",
      category: "strategy",
      next: buildWorkspaceConfigMetadata({
        workspaceStrategy: {
          type: "git_worktree",
          baseRef: "origin/main",
          branchTemplate: "custom-{{issue.identifier}}",
          worktreeParentDir: ".wardmote/worktrees",
        },
      }),
    },
    {
      name: "project workspace",
      category: "projectWorkspace",
      next: buildWorkspaceConfigMetadata({ projectWorkspaceId: "workspace-2" }),
    },
    {
      name: "base ref",
      category: "repo",
      next: buildWorkspaceConfigMetadata({
        repoRef: "origin/release",
        workspaceStrategy: {
          type: "git_worktree",
          baseRef: "origin/release",
          branchTemplate: "{{issue.identifier}}-{{slug}}",
          worktreeParentDir: ".wardmote/worktrees",
        },
      }),
    },
    {
      name: "environment realization",
      category: "environment",
      next: buildWorkspaceConfigMetadata({
        environment: {
          selectedEnvironmentId: "environment-2",
          driver: "sandbox",
          config: { provider: "daytona" },
        },
        realization: {
          environmentDriver: "sandbox",
          environmentProvider: "daytona",
        },
      }),
    },
  ] as const)("replaces the workspace when $name changes", ({ category, next }) => {
    const base = buildWorkspaceConfigMetadata();

    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(base),
      nextMetadata: next,
    });

    expect(decision.action).toBe("replace");
    expect(decision.shouldReuseExisting).toBe(false);
    expect(decision.changedCategories).toContain(category);
  });

  it("keeps replacement-class drift visible when explicit reuse restores the old workspace", () => {
    const base = buildWorkspaceConfigMetadata();
    const next = buildWorkspaceConfigMetadata({
      repoRef: "origin/release",
      workspaceStrategy: {
        type: "git_worktree",
        baseRef: "origin/release",
        branchTemplate: "{{issue.identifier}}-{{slug}}",
        worktreeParentDir: ".wardmote/worktrees",
      },
      configSnapshot: {
        provisionCommand: "pnpm install --frozen-lockfile",
      },
    });

    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(base),
      nextMetadata: next,
    });
    const policy = resolveExecutionWorkspaceReuseProvisioningPolicy({
      requestedShouldReuseExisting: true,
      workspaceConfigFreshness: decision,
    });

    expect(decision.action).toBe("replace");
    expect(policy).toEqual({
      shouldRestoreExistingWorkspace: true,
      shouldRefreshWorkspaceConfigSnapshot: false,
      shouldPersistLatestWorkspaceConfigMetadata: false,
    });

    const metadata = mergeExecutionWorkspaceMetadataForPersistence({
      existingMetadata: {
        config: {
          provisionCommand: "pnpm install",
        },
        ...persistedWorkspaceConfigFingerprint(base),
      },
      source: "task_session",
      createdByRuntime: false,
      strategyType: "project_primary",
      configSnapshot: {
        provisionCommand: "pnpm install --frozen-lockfile",
      },
      shouldReuseExisting: policy.shouldRestoreExistingWorkspace,
      shouldRefreshConfigSnapshot: policy.shouldRefreshWorkspaceConfigSnapshot,
      workspaceConfigMetadata: policy.shouldPersistLatestWorkspaceConfigMetadata ? next : null,
      baseRef: "origin/release",
      baseRefSha: "release-sha",
    });

    expect(metadata?.config).toEqual({
      provisionCommand: "pnpm install",
    });
    expect(metadata?.configFingerprint).toMatchObject({
      workspaceHash: base.fingerprint,
      categories: base.categories,
    });
    expect(metadata?.configFingerprint).not.toMatchObject({
      workspaceHash: next.fingerprint,
    });
  });

  it("fails loudly when explicit reuse restore errors", async () => {
    const base = buildWorkspaceConfigMetadata();
    const next = buildWorkspaceConfigMetadata({
      repoRef: "origin/release",
      workspaceStrategy: {
        type: "git_worktree",
        baseRef: "origin/release",
        branchTemplate: "{{issue.identifier}}-{{slug}}",
        worktreeParentDir: ".wardmote/worktrees",
      },
    });
    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(base),
      nextMetadata: next,
    });
    const realizeWorkspace = vi.fn(async () => ({ id: "fallback-workspace", warnings: [] }));

    await expect(provisionExecutionWorkspaceForFreshnessDecision({
      requestedShouldReuseExisting: true,
      existingExecutionWorkspaceId: "workspace-old",
      issueRef: { id: "issue-1", identifier: "PAP-42" },
      runId: "run-1",
      workspaceConfigFreshness: decision,
      restoreExistingWorkspace: async () => {
        throw new Error("restore command failed");
      },
      realizeWorkspace,
    })).rejects.toThrow(/restore command failed/);
    expect(realizeWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    { name: "missing", status: null },
    { name: "archived", status: "archived" },
  ])("fails loudly when the inherited workspace row is $name", async ({ status }) => {
    const reuseRequest = resolveExecutionWorkspaceReuseRequestForIssue({
      issueExecutionWorkspaceId: "workspace-old",
      issueExecutionWorkspacePreference: "reuse_existing",
      existingExecutionWorkspaceStatus: status,
    });

    expect(reuseRequest).toEqual({
      requestedExecutionWorkspaceId: "workspace-old",
      requestedShouldReuseExisting: true,
      existingExecutionWorkspaceAvailable: false,
    });

    const metadata = buildWorkspaceConfigMetadata();
    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: reuseRequest.requestedShouldReuseExisting &&
        reuseRequest.existingExecutionWorkspaceAvailable,
      existingWorkspaceMetadata: null,
      nextMetadata: metadata,
    });
    const realizeWorkspace = vi.fn(async () => ({ id: "fallback-workspace", warnings: [] }));

    await expect(provisionExecutionWorkspaceForFreshnessDecision({
      requestedShouldReuseExisting: reuseRequest.requestedShouldReuseExisting,
      existingExecutionWorkspaceId: reuseRequest.requestedExecutionWorkspaceId,
      issueRef: { id: "issue-1", identifier: "PAP-42" },
      runId: "run-1",
      workspaceConfigFreshness: decision,
      restoreExistingWorkspace: reuseRequest.existingExecutionWorkspaceAvailable
        ? async () => ({ id: "workspace-old", warnings: [] })
        : null,
      realizeWorkspace,
    })).rejects.toThrow(/could not be restored/);
    expect(realizeWorkspace).not.toHaveBeenCalled();
  });

  it("does not mistake a projectless native run-id binding for a missing persisted workspace", () => {
    expect(resolveNativeRecoveryExecutionWorkspaceBinding({
      bindingId: "run-projectless",
      persistedWorkspaceFound: false,
    })).toBeNull();
    expect(resolveNativeRecoveryExecutionWorkspaceBinding({
      bindingId: "workspace-persisted",
      persistedWorkspaceFound: true,
    })).toBe("workspace-persisted");
  });

  it.each([
    { name: "a different branch", branchName: "PAP-9001-derived-child-branch" },
    { name: "no recorded branch", branchName: null },
  ])(
    "realizes the pinned existing branch instead of reusing an inherited workspace on $name",
    async ({ branchName }) => {
      const reuseRequest = resolveExecutionWorkspaceReuseRequestForIssue({
        issueExecutionWorkspaceId: "workspace-old",
        issueExecutionWorkspacePreference: "reuse_existing",
        existingExecutionWorkspaceStatus: "active",
        requestedExistingBranch: "PAP-14380-salvage-pap-9514",
        existingExecutionWorkspaceBranchName: branchName,
      });

      expect(reuseRequest).toEqual({
        requestedExecutionWorkspaceId: "workspace-old",
        requestedShouldReuseExisting: false,
        existingExecutionWorkspaceAvailable: false,
      });

      const metadata = buildWorkspaceConfigMetadata();
      const decision = resolveExecutionWorkspaceConfigFreshness({
        hasExistingWorkspace: false,
        existingWorkspaceMetadata: null,
        nextMetadata: metadata,
      });
      const realizeWorkspace = vi.fn(async () => ({ id: "pinned-branch-workspace", warnings: [] }));
      const restoreExistingWorkspace = vi.fn(async () => ({ id: "workspace-old", warnings: [] }));

      const result = await provisionExecutionWorkspaceForFreshnessDecision({
        requestedShouldReuseExisting: reuseRequest.requestedShouldReuseExisting,
        existingExecutionWorkspaceId: reuseRequest.requestedExecutionWorkspaceId,
        issueRef: { id: "issue-1", identifier: "PAP-42" },
        runId: "run-1",
        workspaceConfigFreshness: decision,
        restoreExistingWorkspace,
        realizeWorkspace,
      });

      expect(result.executionWorkspace).toEqual({ id: "pinned-branch-workspace", warnings: [] });
      expect(result.reusedExecutionWorkspace).toBeNull();
      expect(restoreExistingWorkspace).not.toHaveBeenCalled();
    },
  );

  it("keeps reusing an inherited workspace whose branch matches the pinned existing branch", () => {
    expect(resolveExecutionWorkspaceReuseRequestForIssue({
      issueExecutionWorkspaceId: "workspace-old",
      issueExecutionWorkspacePreference: "reuse_existing",
      existingExecutionWorkspaceStatus: "active",
      requestedExistingBranch: "PAP-14380-salvage-pap-9514",
      existingExecutionWorkspaceBranchName: "PAP-14380-salvage-pap-9514",
    })).toEqual({
      requestedExecutionWorkspaceId: "workspace-old",
      requestedShouldReuseExisting: true,
      existingExecutionWorkspaceAvailable: true,
    });
  });

  it("fails loudly when explicit reuse restore returns no workspace", async () => {
    const metadata = buildWorkspaceConfigMetadata();
    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(metadata),
      nextMetadata: metadata,
    });
    const realizeWorkspace = vi.fn(async () => ({ id: "fallback-workspace", warnings: [] }));

    await expect(provisionExecutionWorkspaceForFreshnessDecision({
      requestedShouldReuseExisting: true,
      existingExecutionWorkspaceId: "workspace-old",
      issueRef: { id: "issue-1", identifier: "PAP-42" },
      runId: "run-1",
      workspaceConfigFreshness: decision,
      restoreExistingWorkspace: async () => null,
      realizeWorkspace,
    })).rejects.toThrow(/could not be restored/);
    expect(realizeWorkspace).not.toHaveBeenCalled();
  });

  it("formats a safe workspace operation payload for config drift decisions", () => {
    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(buildWorkspaceConfigMetadata()),
      nextMetadata: buildWorkspaceConfigMetadata({
        configSnapshot: {
          workspaceRuntime: {
            services: [{ name: "web", command: "pnpm dev -- --host 0.0.0.0", port: 3200 }],
          },
        },
      }),
    });

    const operation = buildWorkspaceConfigFreshnessOperation({
      decision,
      hasExistingWorkspace: true,
      reuseRequested: true,
      workspaceReused: true,
      configSnapshotRefreshed: true,
      previousWorkspaceId: "workspace-old",
      activeWorkspaceId: "workspace-old",
    });

    expect(operation).toMatchObject({
      metadata: {
        kind: "config_freshness",
        action: "refresh",
        changedCategories: ["lifecycleCommands", "runtimeServices"],
        changedCategoryLabels: ["workspace lifecycle commands", "runtime services"],
        reuseRequested: true,
        workspaceReused: true,
        configSnapshotRefreshed: true,
        previousWorkspaceId: "workspace-old",
        activeWorkspaceId: "workspace-old",
      },
      system: expect.stringContaining("refreshed execution workspace config"),
    });
    const serialized = JSON.stringify(operation);
    expect(serialized).toContain("runtime services");
    expect(serialized).not.toContain("pnpm dev");
    expect(serialized).not.toContain("0.0.0.0");
  });

  it("does not record a freshness operation when an unchanged workspace is simply reused", () => {
    const metadata = buildWorkspaceConfigMetadata();
    const decision = resolveExecutionWorkspaceConfigFreshness({
      hasExistingWorkspace: true,
      existingWorkspaceMetadata: persistedWorkspaceConfigFingerprint(metadata),
      nextMetadata: metadata,
    });

    expect(buildWorkspaceConfigFreshnessOperation({
      decision,
      hasExistingWorkspace: true,
      reuseRequested: true,
      workspaceReused: true,
      configSnapshotRefreshed: false,
      previousWorkspaceId: "workspace-1",
      activeWorkspaceId: "workspace-1",
    })).toBeNull();
  });
});

describe("stripWorkspaceRuntimeFromExecutionRunConfig", () => {
  it("removes workspace runtime before heartbeat execution", () => {
    const input = {
      cwd: "/tmp/project",
      workspaceStrategy: {
        type: "git_worktree",
      },
      workspaceRuntime: {
        services: [{ name: "web" }],
      },
    };

    const result = stripWorkspaceRuntimeFromExecutionRunConfig(input);

    expect(result).toEqual({
      cwd: "/tmp/project",
      workspaceStrategy: {
        type: "git_worktree",
      },
    });
    expect(input.workspaceRuntime).toEqual({
      services: [{ name: "web" }],
    });
  });
});

describe("shouldResetTaskSessionForWake", () => {
  it("resets session context on assignment wake", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_assigned" })).toBe(true);
  });

  it("preserves session context on execution review handoff wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "execution_review_requested" })).toBe(false);
  });

  it("resets session context on execution approval wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "execution_approval_requested" })).toBe(true);
  });

  it("preserves session context on execution changes-requested handoff wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "execution_changes_requested" })).toBe(false);
  });

  it("preserves session context on timer heartbeats", () => {
    expect(shouldResetTaskSessionForWake({ wakeSource: "timer" })).toBe(false);
  });

  it("preserves session context on manual on-demand invokes by default", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
      }),
    ).toBe(false);
  });

  it("resets session context when a fresh session is explicitly requested", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
        forceFreshSession: true,
      }),
    ).toBe(true);
  });

  it("resets session context for accepted planning confirmations that refresh workspace selection", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_commented",
        interactionKind: "request_confirmation",
        interactionStatus: "accepted",
        forceFreshSession: true,
        workspaceRefreshReason: "accepted_plan_confirmation",
      }),
    ).toBe(true);
  });

  it("does not reset session context on mention wake comment", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_comment_mentioned",
        wakeCommentId: "comment-1",
      }),
    ).toBe(false);
  });

  it("does not reset session context when commentId is present", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_commented",
        commentId: "comment-2",
      }),
    ).toBe(false);
  });

  it("does not reset for comment wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_commented" })).toBe(false);
  });

  it("does not reset when wake reason is missing", () => {
    expect(shouldResetTaskSessionForWake({})).toBe(false);
  });

  it("does not reset session context on callback on-demand invokes", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "callback",
      }),
    ).toBe(false);
  });
});

describe("shouldDeferFollowupWakeForSameIssue", () => {
  it("defers a same-agent follow-up for mention-style comment wakes while a run is active", () => {
    expect(
      shouldDeferFollowupWakeForSameIssue({
        activeRunStatus: "running",
        isSameExecutionAgent: true,
        wakeCommentId: "comment-1",
        forceFreshSession: false,
      }),
    ).toBe(true);
  });

  it("defers a same-agent follow-up when a fresh session is explicitly requested", () => {
    expect(
      shouldDeferFollowupWakeForSameIssue({
        activeRunStatus: "running",
        isSameExecutionAgent: true,
        wakeCommentId: null,
        forceFreshSession: true,
      }),
    ).toBe(true);
  });

  it("does not defer when the existing run is only queued", () => {
    expect(
      shouldDeferFollowupWakeForSameIssue({
        activeRunStatus: "queued",
        isSameExecutionAgent: true,
        wakeCommentId: null,
        forceFreshSession: true,
      }),
    ).toBe(false);
  });

  it("does not defer normal same-agent wakes without a comment or fresh-session request", () => {
    expect(
      shouldDeferFollowupWakeForSameIssue({
        activeRunStatus: "running",
        isSameExecutionAgent: true,
        wakeCommentId: null,
        forceFreshSession: false,
      }),
    ).toBe(false);
  });
});

describe("shouldResetTaskSessionForModelChange", () => {
  it("resets when configured model differs from persisted session model", () => {
    expect(
      shouldResetTaskSessionForModelChange({
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: {
          sessionId: "thread-1",
          __wardmoteConfiguredModel: "opencode/mimo-v2-pro-free",
        },
      }),
    ).toBe(true);
  });

  it("does not reset when models match", () => {
    expect(
      shouldResetTaskSessionForModelChange({
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: {
          sessionId: "thread-1",
        __wardmoteConfiguredModel: "gpt-5.4-mini",
        },
      }),
    ).toBe(false);
  });

  it("does not reset when persisted session model is missing", () => {
    expect(
      shouldResetTaskSessionForModelChange({
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: {
          sessionId: "thread-1",
        },
      }),
    ).toBe(false);
  });

  it("does not reset when configured model is missing", () => {
    expect(
      shouldResetTaskSessionForModelChange({
        configuredModel: null,
        taskSessionParams: {
          sessionId: "thread-1",
          __wardmoteConfiguredModel: "gpt-5.4-mini",
        },
      }),
    ).toBe(false);
  });

  it("does not reset when task session params are missing", () => {
    expect(
      shouldResetTaskSessionForModelChange({
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: null,
      }),
    ).toBe(false);
  });
});

type SessionConfigMetadata = Awaited<ReturnType<typeof buildEffectiveRunSessionConfigMetadata>>;

async function buildSessionConfigMetadata(
  overrides: Partial<Parameters<typeof buildEffectiveRunSessionConfigMetadata>[0]> = {},
) {
  return buildEffectiveRunSessionConfigMetadata({
    adapterType: "codex_local",
    effectiveAdapterConfig: {
      command: "codex",
      model: "gpt-5.4-mini",
      env: {
        OPENAI_API_KEY: "resolved-secret-value",
        PLAIN_FLAG: "plain-value",
      },
    },
    agentRuntimeConfig: {
      heartbeat: {
        maxConcurrentRuns: 1,
      },
    },
    issueOverrides: null,
    workspaceConfig: {
      requestedMode: "agent_default",
      effectiveMode: "agent_default",
      projectConfigRevisionAt: "2026-06-01T00:00:00.000Z",
    },
    environment: {
      selectionSource: "default",
      selectedEnvironmentId: "environment-1",
      selectedEnvironment: {
        id: "environment-1",
        driver: "local",
        configRevisionAt: "2026-06-01T00:00:00.000Z",
      },
    },
    environmentEnv: {
      ENVIRONMENT_FLAG: "enabled",
    },
    projectEnv: {
      PROJECT_FLAG: "enabled",
    },
    routineEnv: null,
    secretManifest: [
      {
        configPath: "env.OPENAI_API_KEY",
        envKey: "OPENAI_API_KEY",
        secretId: "secret-1",
        bindingId: "binding-1",
        secretKey: "openai-api-key",
        version: 7,
        provider: "local_encrypted",
        outcome: "success",
      },
    ],
    runtimeSkills: [
      {
        key: "wardmote",
        runtimeName: "wardmote",
        source: "/tmp/wardmote/runtime-skills/wardmote",
        versionId: null,
        currentVersionId: "skill-version-1",
        sourceStatus: "available",
        missingDetail: null,
      },
    ],
    agentConfigRevision: {
      id: "agent-config-revision-1",
      changedKeys: ["adapterConfig"],
      configRevisionAt: "2026-06-01T00:00:00.000Z",
    },
    ...overrides,
  });
}

function sessionParamsWithConfigMetadata(
  metadata: SessionConfigMetadata,
  configuredModel = "gpt-5.4-mini",
) {
  return {
    sessionId: "thread-1",
    __wardmoteConfiguredModel: configuredModel,
    __wardmoteConfigFingerprint: metadata.fingerprint,
    __wardmoteConfigFingerprintVersion: metadata.version,
    __wardmoteConfigCategories: metadata.categories,
    __wardmoteConfigCategoryFingerprints: metadata.categoryFingerprints,
    __wardmoteAdapterConfigKeyFingerprints: metadata.adapterConfigKeyFingerprints,
    __wardmoteConfigResumeNeutralCategoryFingerprints: metadata.resumeNeutralCategoryFingerprints,
  };
}

describe("effective run session config freshness", () => {
  it("resets legacy sessions after connection instructions change or disappear", async () => {
    const first = await buildSessionConfigMetadata({ effectiveAdapterConfig: { wardmoteConnectionInstructions: { text: "Use the handbook.", digest: "before" } } });
    for (const instructions of [null, { text: "Use the updated handbook.", digest: "after" }]) {
      const next = await buildSessionConfigMetadata({ effectiveAdapterConfig: { wardmoteConnectionInstructions: instructions } });
      expect(resolveTaskSessionConfigFreshness({ hasTaskSession: true, configuredModel: "gpt-5.4-mini", taskSessionParams: sessionParamsWithConfigMetadata(first), configMetadata: next }).reset).toBe(true);
    }
  });

  it("reuses a task session when only skill delivery details change", async () => {
    const skill = (overrides: Record<string, unknown> = {}) => ({
      key: "wardmote",
      runtimeName: "wardmote",
      source: "/tmp/wardmote/runtime-skills/wardmote",
      versionId: null,
      currentVersionId: "skill-version-1",
      sourceStatus: "available",
      missingDetail: null,
      ...overrides,
    });
    const first = await buildSessionConfigMetadata({ adapterType: "omp_local", runtimeSkills: [skill()] });

    for (const delivery of [
      skill({ source: "/tmp/wardmote/runtime-context-assets/bundles/other-digest" }),
      skill({ sourceStatus: "missing", missingDetail: "The selected skill version produced no files." }),
    ]) {
      const next = await buildSessionConfigMetadata({ adapterType: "omp_local", runtimeSkills: [delivery] });
      expect(resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        adapterType: "omp_local",
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: sessionParamsWithConfigMetadata(first),
        configMetadata: next,
      }).reset).toBe(false);
    }

    const claudeFirst = await buildSessionConfigMetadata({ adapterType: "claude_local", runtimeSkills: [skill()] });
    const claudeUpgraded = await buildSessionConfigMetadata({
      adapterType: "claude_local",
      runtimeSkills: [skill({ currentVersionId: "skill-version-2" })],
    });
    expect(resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      adapterType: "claude_local",
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: sessionParamsWithConfigMetadata(claudeFirst),
      configMetadata: claudeUpgraded,
    }).reset).toBe(true);
  });

  it("reuses managed AI sessions across temporary credential homes while preserving configuration boundaries", async () => {
    const config = (home: string) => ({
      model: "gpt-5.4-mini",
      approvalPolicy: "never",
      managedAiConnection: { identity: "account-1:credential-generation-1" },
      env: {
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_DATA_HOME: path.join(home, "data"),
        CODEX_HOME: path.join(home, "provider"),
        GROK_HOME: path.join(home, "provider"),
        CLAUDE_CONFIG_DIR: path.join(home, "provider"),
        CUSTOM_SETTING: "original",
      },
    });
    const first = await buildSessionConfigMetadata({ effectiveAdapterConfig: config("/tmp/ai-first"), managedAiHome: "/tmp/ai-first" });
    const nextConfig = config("/tmp/ai-next");
    const next = await buildSessionConfigMetadata({ effectiveAdapterConfig: nextConfig, managedAiHome: "/tmp/ai-next" });
    expect(next.fingerprint).toBe(first.fingerprint);
    expect(nextConfig.env.HOME).toBe("/tmp/ai-next");
    expect(resolveTaskSessionConfigFreshness({
      hasTaskSession: true, configuredModel: "gpt-5.4-mini",
      taskSessionParams: sessionParamsWithConfigMetadata(first), configMetadata: next,
    }).reset).toBe(false);
    for (const changed of [
      { ...nextConfig, model: "different-model" },
      { ...nextConfig, approvalPolicy: "on-request" },
      { ...nextConfig, managedAiConnection: { identity: "account-2:credential-generation-1" } },
      { ...nextConfig, managedAiConnection: { identity: "account-1:credential-generation-2" } },
      { ...nextConfig, env: { ...nextConfig.env, CUSTOM_SETTING: "changed" } },
      { ...nextConfig, env: { ...nextConfig.env, CODEX_HOME: "/custom/provider" } },
    ]) {
      const metadata = await buildSessionConfigMetadata({ effectiveAdapterConfig: changed, managedAiHome: "/tmp/ai-next" });
      expect(metadata.fingerprint).not.toBe(first.fingerprint);
    }
    const unmanagedFirst = await buildSessionConfigMetadata({ effectiveAdapterConfig: config("/custom/first") });
    const unmanagedNext = await buildSessionConfigMetadata({ effectiveAdapterConfig: config("/custom/next") });
    expect(unmanagedFirst.fingerprint).not.toBe(unmanagedNext.fingerprint);
  });

  it("resets when effective adapter config changes after model/profile/env resolution", async () => {
    const base = await buildSessionConfigMetadata();
    const next = await buildSessionConfigMetadata({
      effectiveAdapterConfig: {
        command: "codex",
        model: "gpt-5.4-mini",
        approvalPolicy: "never",
      },
    });

    const decision = resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: sessionParamsWithConfigMetadata(base),
      configMetadata: next,
    });

    expect(decision).toMatchObject({
      reset: true,
      changedCategories: ["adapterConfig"],
    });
    expect(decision.reasons.join("\n")).toContain("adapter config");
  });

  it("does not reset for issue comment timestamps but still resets for workspace settings", async () => {
    const base = await buildSessionConfigMetadata({
      workspaceConfig: {
        requestedMode: "agent_default",
        effectiveMode: "agent_default",
        issueConfigRevisionAt: "2026-06-01T00:00:00.000Z",
        issueSettings: null,
      },
    });
    const commentOnly = await buildSessionConfigMetadata({
      workspaceConfig: {
        requestedMode: "agent_default",
        effectiveMode: "agent_default",
        issueConfigRevisionAt: "2026-06-01T00:05:00.000Z",
        issueSettings: null,
      },
    });
    const workspaceChanged = await buildSessionConfigMetadata({
      workspaceConfig: {
        requestedMode: "isolated_workspace",
        effectiveMode: "isolated_workspace",
        issueConfigRevisionAt: "2026-06-01T00:05:00.000Z",
        issueSettings: { mode: "isolated_workspace" },
      },
    });

    expect(
      resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: sessionParamsWithConfigMetadata(base),
        configMetadata: commentOnly,
      }),
    ).toMatchObject({
      reset: false,
      changedCategories: [],
      reasons: [],
    });
    expect(
      resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: sessionParamsWithConfigMetadata(base),
        configMetadata: workspaceChanged,
      }),
    ).toMatchObject({
      reset: true,
      changedCategories: ["workspaceConfig"],
    });
  });

  it("does not reset when a reusable execution workspace becomes realized", async () => {
    const base = await buildSessionConfigMetadata({
      workspaceConfig: {
        requestedMode: "shared_workspace",
        effectiveMode: "shared_workspace",
        reusableExecutionWorkspaceConfig: null,
        existingExecutionWorkspace: null,
      },
    });
    const realized = await buildSessionConfigMetadata({
      workspaceConfig: {
        requestedMode: "shared_workspace",
        effectiveMode: "shared_workspace",
        reusableExecutionWorkspaceConfig: {
          strategyType: "project_primary",
          workspaceGeneration: 1,
        },
        existingExecutionWorkspace: {
          id: "workspace-realized-after-first-turn",
          mode: "shared_workspace",
          strategyType: "project_primary",
        },
      },
    });

    expect(
      resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: sessionParamsWithConfigMetadata(base),
        configMetadata: realized,
      }),
    ).toMatchObject({
      reset: false,
      changedCategories: [],
      reasons: [],
    });
  });

  it("keeps model-only compatibility as an additional reset reason", async () => {
    const base = await buildSessionConfigMetadata();

    const decision = resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: sessionParamsWithConfigMetadata(base, "opencode/mimo-v2-pro-free"),
      configMetadata: base,
    });

    expect(decision.reset).toBe(true);
    expect(decision.reasons).toEqual([
      'configured model changed from "opencode/mimo-v2-pro-free" to "gpt-5.4-mini"',
    ]);
  });

  describe("model switching inside a resumed session", () => {
    const ompConfig = (overrides: Record<string, unknown> = {}) => ({
      command: "omp",
      model: "sub2api-claude/claude-opus-5-5",
      thinking: "high",
      ...overrides,
    });

    async function freshness(input: {
      adapterType: string;
      first: Record<string, unknown>;
      next: Record<string, unknown>;
      issueOverrides?: unknown;
    }) {
      const base = await buildSessionConfigMetadata({
        adapterType: input.adapterType,
        effectiveAdapterConfig: input.first,
      });
      const next = await buildSessionConfigMetadata({
        adapterType: input.adapterType,
        effectiveAdapterConfig: input.next,
        issueOverrides: input.issueOverrides ?? null,
      });
      return resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        adapterType: input.adapterType,
        configuredModel: String(input.next.model),
        taskSessionParams: sessionParamsWithConfigMetadata(base, String(input.first.model)),
        configMetadata: next,
      });
    }

    it("resumes an omp_local session when the configured model changes", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig(),
        next: ompConfig({ model: "nutaraline/muse-spark-1.3" }),
      });

      expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: [] });
    });

    it("resumes an omp_local session when the thinking level changes", async () => {
      for (const next of [
        ompConfig({ thinking: "low" }),
        ompConfig({ thinkingEffort: "medium" }),
        ompConfig({ effort: "xhigh" }),
      ]) {
        const decision = await freshness({ adapterType: "omp_local", first: ompConfig(), next });
        expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: [] });
      }
    });

    it("resumes an omp_local session when a named Model or Thinking choice rewrites its role models and default level", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig({ ompSettings: { "retry.maxRetries": 3 } }),
        next: ompConfig({
          model: "nutaraline/muse-spark-1.3",
          smolModel: "nutaraline/muse-mini",
          slowModel: "nutaraline/muse-spark-1.3",
          planModel: "nutaraline/muse-spark-1.3",
          stylePreset: "balanced",
          fallbackMode: "automatic",
          ompSettings: { "retry.maxRetries": 3, defaultThinkingLevel: "high" },
        }),
      });

      expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: [] });
    });

    it("still resets an omp_local session when a pinned OMP setting outside model and thinking changes", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig({ ompSettings: { "retry.maxRetries": 3 } }),
        next: ompConfig({ ompSettings: { "retry.maxRetries": 5 } }),
      });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["adapterConfig"]);
    });

    it("resumes an omp_local session when a per-task model override changes", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig(),
        next: ompConfig({ model: "nutaraline/muse-spark-1.3", thinking: "low" }),
        issueOverrides: { adapterConfig: { model: "nutaraline/muse-spark-1.3", thinking: "low" } },
      });

      expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: [] });
    });

    it("resumes an omp_local session when only run-scoped connector delivery changes", async () => {
      const connectorEntry = (source: string) => ({
        key: "connector-openwa",
        runtimeName: "openwa",
        source,
        sourceStatus: "available",
      });
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig({
          wardmoteRuntimeSkills: [connectorEntry("/assets/bundles/aaa")],
          wardmoteConnectorSkillDigest: "digest-a",
          wardmoteSkillSync: { desiredSkillEntries: [{ key: "connector-openwa", versionId: null }] },
        }),
        next: ompConfig({
          wardmoteRuntimeSkills: [connectorEntry("/assets/bundles/bbb")],
          wardmoteConnectorSkillDigest: "digest-b",
          wardmoteSkillSync: { desiredSkillEntries: [] },
        }),
      });

      expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: [] });
    });

    it("still resets an omp_local session when a session-defining adapter setting changes", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig({ noPty: false }),
        next: ompConfig({ noPty: true }),
      });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["adapterConfig"]);
    });

    async function instructionsEdit(input: {
      adapterType: string;
      first?: Record<string, unknown>;
      next?: Record<string, unknown>;
    }) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-model-switch-"));
      const instructionsPath = path.join(root, "AGENTS.md");
      const instructionsConfig = (overrides: Record<string, unknown> = {}) => ompConfig({
        instructionsBundleMode: "managed",
        instructionsRootPath: root,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: instructionsPath,
        ...overrides,
      });
      await fs.writeFile(instructionsPath, "Version one instructions.\n", "utf8");
      const base = await buildSessionConfigMetadata({
        adapterType: input.adapterType,
        effectiveAdapterConfig: instructionsConfig(input.first),
      });
      await fs.writeFile(instructionsPath, "Version two instructions.\n", "utf8");
      const next = await buildSessionConfigMetadata({
        adapterType: input.adapterType,
        effectiveAdapterConfig: instructionsConfig(input.next),
      });
      return resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        adapterType: input.adapterType,
        configuredModel: "sub2api-claude/claude-opus-5-5",
        taskSessionParams: sessionParamsWithConfigMetadata(base, "sub2api-claude/claude-opus-5-5"),
        configMetadata: next,
      });
    }

    async function runtimeSkillsEdit(input: {
      adapterType: string;
      first?: Record<string, unknown>;
      next?: Record<string, unknown>;
    }) {
      const skill = (currentVersionId: string) => ({
        key: "wardmote",
        runtimeName: "wardmote",
        source: "/tmp/wardmote/runtime-skills/wardmote",
        versionId: null,
        currentVersionId,
        sourceStatus: "available",
        missingDetail: null,
      });
      const base = await buildSessionConfigMetadata({
        adapterType: input.adapterType,
        effectiveAdapterConfig: ompConfig(input.first),
        runtimeSkills: [skill("skill-version-1")],
      });
      const next = await buildSessionConfigMetadata({
        adapterType: input.adapterType,
        effectiveAdapterConfig: ompConfig(input.next),
        runtimeSkills: [skill("skill-version-2"), { ...skill("skill-version-1"), key: "reviewer", runtimeName: "reviewer" }],
      });
      return resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        adapterType: input.adapterType,
        configuredModel: "sub2api-claude/claude-opus-5-5",
        taskSessionParams: sessionParamsWithConfigMetadata(base, "sub2api-claude/claude-opus-5-5"),
        configMetadata: next,
      });
    }

    it("resumes an omp_local session on an ordinary wake when only its instructions change", async () => {
      const decision = await instructionsEdit({ adapterType: "omp_local" });

      expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: ["instructions"] });
    });

    it("resumes an omp_local session on an ordinary wake when only its runtime skills change", async () => {
      const decision = await runtimeSkillsEdit({ adapterType: "omp_local" });

      expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: ["runtimeSkills"] });
    });

    it("still resets an omp_local session when a session-defining setting changes alongside its instructions", async () => {
      const decision = await instructionsEdit({
        adapterType: "omp_local",
        next: { noPty: true },
      });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["adapterConfig", "instructions"]);
      expect(decision.reasons).toEqual([
        "effective run configuration changed: adapter config, instructions (noPty)",
      ]);
    });

    it("still resets an omp_local session when a session-defining setting changes alongside its runtime skills", async () => {
      const decision = await runtimeSkillsEdit({
        adapterType: "omp_local",
        next: { noPty: true },
      });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["adapterConfig", "runtimeSkills"]);
    });

    it("keeps resetting claude_local sessions when only instructions change", async () => {
      const decision = await instructionsEdit({ adapterType: "claude_local" });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["instructions"]);
    });

    describe("a new agent config revision", () => {
      type MetadataInput = Partial<Parameters<typeof buildEffectiveRunSessionConfigMetadata>[0]>;
      const revision = (id: string, changedKeys: string[], configRevisionAt: string) => ({
        id,
        changedKeys,
        configRevisionAt,
      });
      const skill = (key: string, currentVersionId: string) => ({
        key,
        runtimeName: key,
        source: `/tmp/wardmote/runtime-skills/${key}`,
        versionId: null,
        currentVersionId,
        sourceStatus: "available",
        missingDetail: null,
      });

      async function revisionEdit(input: {
        adapterType: string;
        first?: MetadataInput;
        next?: MetadataInput;
        legacySession?: boolean;
      }) {
        const base = await buildSessionConfigMetadata({
          adapterType: input.adapterType,
          effectiveAdapterConfig: ompConfig(),
          agentConfigRevision: revision("revision-1", ["adapterConfig"], "2026-10-16T00:00:00.000Z"),
          ...input.first,
        });
        const next = await buildSessionConfigMetadata({
          adapterType: input.adapterType,
          effectiveAdapterConfig: ompConfig(),
          agentConfigRevision: revision("revision-2", ["adapterConfig"], "2026-10-17T00:00:00.000Z"),
          ...input.next,
        });
        const taskSessionParams: Record<string, unknown> = sessionParamsWithConfigMetadata(
          base,
          "sub2api-claude/claude-opus-5-5",
        );
        if (input.legacySession) delete taskSessionParams.__wardmoteConfigResumeNeutralCategoryFingerprints;
        return resolveTaskSessionConfigFreshness({
          hasTaskSession: true,
          adapterType: input.adapterType,
          configuredModel: "sub2api-claude/claude-opus-5-5",
          taskSessionParams,
          configMetadata: next,
        });
      }

      it("resumes an omp_local session when a skill sync writes a new config revision", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          first: {
            effectiveAdapterConfig: ompConfig({ wardmoteSkillSync: { desiredSkills: ["wardmote"] } }),
            runtimeSkills: [skill("wardmote", "skill-version-1")],
          },
          next: {
            effectiveAdapterConfig: ompConfig({ wardmoteSkillSync: { desiredSkills: ["wardmote", "reviewer"] } }),
            runtimeSkills: [skill("wardmote", "skill-version-1"), skill("reviewer", "skill-version-1")],
          },
        });

        expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: ["adapter", "runtimeSkills"] });
      });

      it("resumes an omp_local session when a new config revision changes only heartbeat scheduling", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          first: { agentRuntimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } } },
          next: {
            agentRuntimeConfig: { heartbeat: { enabled: true, intervalSec: 3600, maxConcurrentRuns: 2 } },
            agentConfigRevision: revision("revision-2", ["runtimeConfig"], "2026-10-17T00:00:00.000Z"),
          },
        });

        expect(decision).toMatchObject({ reset: false, reasons: [], changedCategories: ["adapter", "agentRuntimeConfig"] });
      });

      it("still resets an omp_local session when a new config revision changes a session-defining setting", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          next: { effectiveAdapterConfig: ompConfig({ noPty: true }) },
        });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter", "adapterConfig"]);
        expect(decision.reasons).toEqual([
          "effective run configuration changed: adapter, adapter config (noPty)",
        ]);
      });

      it("still resets an omp_local session when a new config revision changes the AI connection binding", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          first: { agentRuntimeConfig: { heartbeat: { enabled: true }, aiConnection: { mode: "router", connectionId: "pool-1" } } },
          next: {
            agentRuntimeConfig: { heartbeat: { enabled: true }, aiConnection: { mode: "router", connectionId: "pool-2" } },
            agentConfigRevision: revision("revision-2", ["runtimeConfig"], "2026-10-17T00:00:00.000Z"),
          },
        });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter", "agentRuntimeConfig"]);
      });

      it("still resets an omp_local session when a new config revision changes a runtime setting other than heartbeat", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          first: { agentRuntimeConfig: { heartbeat: { enabled: true } } },
          next: {
            agentRuntimeConfig: { heartbeat: { enabled: true }, debug: { providerTrace: "raw" } },
            agentConfigRevision: revision("revision-2", ["runtimeConfig"], "2026-10-17T00:00:00.000Z"),
          },
        });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter", "agentRuntimeConfig"]);
      });

      it("still resets an omp_local session when a new config revision changes its secrets", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          next: {
            secretManifest: [
              {
                configPath: "env.OPENAI_API_KEY",
                envKey: "OPENAI_API_KEY",
                secretId: "secret-1",
                bindingId: "binding-1",
                secretKey: "openai-api-key",
                version: 8,
                provider: "local_encrypted",
                outcome: "success",
              },
            ],
          },
        });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter", "secrets"]);
      });

      it("still resets an omp_local session when a new config revision changes its environment", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          next: {
            environment: {
              selectionSource: "default",
              selectedEnvironmentId: "environment-2",
              selectedEnvironment: { id: "environment-2", driver: "local", configRevisionAt: "2026-10-17T00:00:00.000Z" },
            },
            environmentEnv: { ENVIRONMENT_FLAG: "disabled" },
          },
        });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter", "environment", "envBindings"]);
      });

      it("still resets an omp_local session when its agent identity key changes", async () => {
        const decision = await revisionEdit({
          adapterType: "omp_local",
          first: { agentIdentityKeyId: "identity-key-1" },
          next: { agentIdentityKeyId: "identity-key-2" },
        });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter"]);
      });

      it("resets an omp_local session stored before revision-neutral fingerprints existed", async () => {
        const decision = await revisionEdit({ adapterType: "omp_local", legacySession: true });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter"]);
      });

      it("keeps resetting claude_local sessions when only the config revision changes", async () => {
        const decision = await revisionEdit({ adapterType: "claude_local" });

        expect(decision.reset).toBe(true);
        expect(decision.changedCategories).toEqual(["adapter"]);
      });
    });

    it("names the adapter config key that changed", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig(),
        next: ompConfig({ noPty: true }),
      });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["adapterConfig"]);
      expect(decision.reasons).toEqual([
        "effective run configuration changed: adapter config (noPty)",
      ]);
    });

    it("names only the keys that changed when several are present", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig(),
        next: ompConfig({ noPty: true, noRules: true }),
      });

      expect(decision.reset).toBe(true);
      expect(decision.reasons).toEqual([
        "effective run configuration changed: adapter config (noPty, noRules)",
      ]);
    });

    it("keeps the category-only reason for sessions stored before the per-key digests existed", async () => {
      const base = await buildSessionConfigMetadata({
        adapterType: "omp_local",
        effectiveAdapterConfig: ompConfig(),
      });
      const next = await buildSessionConfigMetadata({
        adapterType: "omp_local",
        effectiveAdapterConfig: ompConfig({ noPty: true }),
      });
      const legacyParams = { ...sessionParamsWithConfigMetadata(base) };
      delete legacyParams.__wardmoteAdapterConfigKeyFingerprints;

      const decision = resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        adapterType: "omp_local",
        configuredModel: "sub2api-claude/claude-opus-5-5",
        taskSessionParams: legacyParams,
        configMetadata: next,
      });

      expect(decision.reset).toBe(true);
      expect(decision.reasons).toEqual([
        "effective run configuration changed: adapter config",
      ]);
    });

    it("still resets an omp_local session when another adapter setting changes", async () => {
      const decision = await freshness({
        adapterType: "omp_local",
        first: ompConfig(),
        next: ompConfig({ model: "nutaraline/muse-spark-1.3", noPty: true }),
      });

      expect(decision.reset).toBe(true);
      expect(decision.changedCategories).toEqual(["adapterConfig"]);
    });

    it("keeps resetting claude_local sessions when the configured model changes", async () => {
      const decision = await freshness({
        adapterType: "claude_local",
        first: { command: "claude", model: "claude-opus-5-5" },
        next: { command: "claude", model: "claude-sonnet-5" },
      });

      expect(decision.reset).toBe(true);
      expect(decision.reasons).toContain(
        'configured model changed from "claude-opus-5-5" to "claude-sonnet-5"',
      );
    });
  });

  it("freshens legacy task sessions that lack versioned config metadata", async () => {
    const metadata = await buildSessionConfigMetadata();

    const decision = resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: {
        sessionId: "thread-1",
        __wardmoteConfiguredModel: "gpt-5.4-mini",
      },
      configMetadata: metadata,
    });

    expect(decision.reset).toBe(true);
    expect(decision.changedCategories).toEqual(metadata.categories);
    expect(decision.reasons).toEqual(["effective run configuration fingerprint metadata is missing"]);
  });

  it("uses persisted fingerprint metadata even when an adapter codec omits it from resume params", async () => {
    const metadata = await buildSessionConfigMetadata();
    const persistedParams = sessionParamsWithConfigMetadata(metadata);

    const decision = resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: persistedParams,
      configMetadata: metadata,
    });

    expect(decision.reset).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it("preserves legacy metadata gaps only for active accepted-plan continuation sessions", async () => {
    const metadata = await buildSessionConfigMetadata();

    const decision = resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: {
        sessionId: "thread-1",
        __wardmoteConfiguredModel: "gpt-5.4-mini",
      },
      configMetadata: metadata,
      preserveLegacySessionWithoutConfigMetadata: true,
    });

    expect(decision.reset).toBe(false);
    expect(decision.changedCategories).toEqual([]);
    expect(decision.reasons).toEqual([]);
  });

  it("names safe categories for issue override, env, secret, and runtime skill drift", async () => {
    const base = await buildSessionConfigMetadata();
    const cases: Array<{
      name: string;
      category: string;
      metadata: SessionConfigMetadata;
    }> = [
      {
        name: "issue overrides",
        category: "issueOverrides",
        metadata: await buildSessionConfigMetadata({
          issueOverrides: {
            adapterConfig: {
              reasoningEffort: "high",
            },
          },
        }),
      },
      {
        name: "project env bindings",
        category: "envBindings",
        metadata: await buildSessionConfigMetadata({
          projectEnv: {
            PROJECT_FLAG: "enabled",
            NEW_PROJECT_FLAG: "present",
          },
        }),
      },
      {
        name: "secret version",
        category: "secrets",
        metadata: await buildSessionConfigMetadata({
          secretManifest: [
            {
              configPath: "env.OPENAI_API_KEY",
              envKey: "OPENAI_API_KEY",
              secretId: "secret-1",
              bindingId: "binding-1",
              secretKey: "openai-api-key",
              version: 8,
              provider: "local_encrypted",
              outcome: "success",
            },
          ],
        }),
      },
      {
        name: "runtime skills",
        category: "runtimeSkills",
        metadata: await buildSessionConfigMetadata({
          runtimeSkills: [
            {
              key: "wardmote",
              runtimeName: "wardmote",
              source: "/tmp/wardmote/runtime-skills/wardmote",
              versionId: null,
              currentVersionId: "skill-version-2",
              sourceStatus: "available",
              missingDetail: null,
            },
          ],
        }),
      },
    ];

    for (const testCase of cases) {
      const decision = resolveTaskSessionConfigFreshness({
        hasTaskSession: true,
        configuredModel: "gpt-5.4-mini",
        taskSessionParams: sessionParamsWithConfigMetadata(base),
        configMetadata: testCase.metadata,
      });

      expect(decision.reset, testCase.name).toBe(true);
      expect(decision.changedCategories, testCase.name).toContain(testCase.category);
    }
  });

  it("detects instructions content drift without storing the contents", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-session-fingerprint-"));
    const instructionsPath = path.join(root, "AGENTS.md");
    await fs.writeFile(instructionsPath, "Version one instructions.\n", "utf8");
    const base = await buildSessionConfigMetadata({
      effectiveAdapterConfig: {
        command: "codex",
        model: "gpt-5.4-mini",
        instructionsBundleMode: "managed",
        instructionsRootPath: root,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: instructionsPath,
      },
    });
    await fs.writeFile(instructionsPath, "Version two instructions.\n", "utf8");
    const next = await buildSessionConfigMetadata({
      effectiveAdapterConfig: {
        command: "codex",
        model: "gpt-5.4-mini",
        instructionsBundleMode: "managed",
        instructionsRootPath: root,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: instructionsPath,
      },
    });

    const decision = resolveTaskSessionConfigFreshness({
      hasTaskSession: true,
      configuredModel: "gpt-5.4-mini",
      taskSessionParams: sessionParamsWithConfigMetadata(base),
      configMetadata: next,
    });

    expect(decision.reset).toBe(true);
    expect(decision.changedCategories).toContain("instructions");
    expect(next.fingerprints.sessionFingerprint.canonicalJson).not.toContain("Version two instructions");
  });

  it("does not read unbounded legacy instructions paths for config fingerprints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-session-fingerprint-"));
    const instructionsPath = path.join(root, "AGENTS.md");
    await fs.writeFile(instructionsPath, "Legacy direct-path instructions.\n", "utf8");
    const metadata = await buildSessionConfigMetadata({
      effectiveAdapterConfig: {
        command: "codex",
        model: "gpt-5.4-mini",
        instructionsFilePath: instructionsPath,
      },
    });

    const canonical = metadata.fingerprints.sessionFingerprint.canonicalJson;

    expect(canonical).toContain("missing_absolute_root");
    expect(canonical).not.toContain("Legacy direct-path instructions");
    expect(canonical).not.toContain("contentHash");
  });

  it("does not include raw secret or plain env values in canonical session metadata", async () => {
    const metadata = await buildSessionConfigMetadata();
    const canonical = metadata.fingerprints.sessionFingerprint.canonicalJson;

    expect(canonical).toContain("secret-1");
    expect(canonical).toContain('"version":7');
    expect(canonical).not.toContain("resolved-secret-value");
    expect(canonical).not.toContain("plain-value");
    expect(canonical).not.toContain("enabled");
    expect(canonical).not.toContain("openai-api-key");
  });
});

describe("stripConfiguredModelFromSessionParams", () => {
  it("removes the internal model key from persisted session params", () => {
    expect(
      stripConfiguredModelFromSessionParams({
        sessionId: "thread-1",
        __wardmoteConfiguredModel: "gpt-5.4-mini",
      }),
    ).toEqual({ sessionId: "thread-1" });
  });

  it("returns null when session params are missing", () => {
    expect(stripConfiguredModelFromSessionParams(null)).toBeNull();
    expect(stripConfiguredModelFromSessionParams(undefined)).toBeNull();
  });

  it("returns a copy without mutating the input", () => {
    const input = { sessionId: "thread-1", __wardmoteConfiguredModel: "gpt-5.4-mini" };
    const result = stripConfiguredModelFromSessionParams(input);
    expect(result).not.toBe(input);
    expect(input.__wardmoteConfiguredModel).toBe("gpt-5.4-mini");
  });

  it("returns an empty object when only the internal model key is present (caller must normalize)", () => {
    const stripped = stripConfiguredModelFromSessionParams({
      __wardmoteConfiguredModel: "gpt-5.4-mini",
    });
    expect(stripped).toEqual({});
    // Callers that forward params to adapters must normalize {} back to null so
    // the pre-PR null contract is preserved (adapters distinguishing {} from null).
    expect(normalizeSessionParams(stripped)).toBeNull();
  });
});

describe("stripWardmoteSessionMetadataFromSessionParams", () => {
  it("removes all internal Wardmote session metadata before adapter invocation", () => {
    expect(
      stripWardmoteSessionMetadataFromSessionParams({
        sessionId: "thread-1",
        cwd: "/tmp/project",
        wardmoteAiCredentialIdentity: "grant:user:generation",
        __wardmoteConfiguredModel: "gpt-5.4-mini",
        __wardmoteConfigFingerprint: "v1:sha256:abc",
        __wardmoteConfigFingerprintVersion: 1,
        __wardmoteConfigCategories: ["adapterConfig"],
        __wardmoteConfigCategoryFingerprints: { adapterConfig: "v1:sha256:def" },
        __wardmoteAdapterConfigKeyFingerprints: { command: "v1:sha256:ghi" },
      }),
    ).toEqual({
      sessionId: "thread-1",
      cwd: "/tmp/project",
    });
  });
});

describe("isTaskSessionCredentialCompatible", () => {
  it("retains the server-owned identity even when the Codex codec drops it", () => {
    const saved = { sessionId: "thread-1", wardmoteAiCredentialIdentity: "grant:user:generation" };
    const decoded = codexSessionCodec.deserialize(saved);
    expect(decoded).toEqual({ sessionId: "thread-1" });
    expect(isTaskSessionCredentialCompatible(saved, "grant:user:generation")).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { wardmoteAiCredentialIdentity: "other-grant:user:generation" },
    { wardmoteAiCredentialIdentity: "grant:other-user:generation" },
    { wardmoteAiCredentialIdentity: "grant:user:new-generation" },
  ])("requires the same saved grant, responsible user, and credential generation: %j", (saved) => {
    expect(isTaskSessionCredentialCompatible(saved, "grant:user:generation")).toBe(false);
  });

  it("preserves unmanaged session behavior", () => {
    expect(isTaskSessionCredentialCompatible({ sessionId: "thread-1" }, undefined)).toBe(true);
  });
});

describe("normalizeSessionParams", () => {
  it("collapses an empty object to null", () => {
    expect(normalizeSessionParams({})).toBeNull();
  });

  it("returns null for null or undefined inputs", () => {
    expect(normalizeSessionParams(null)).toBeNull();
    expect(normalizeSessionParams(undefined)).toBeNull();
  });

  it("preserves a non-empty object", () => {
    const params = { sessionId: "thread-1" };
    expect(normalizeSessionParams(params)).toBe(params);
  });
});

describe("canonicalIssueTaskKey", () => {
  const issueId = "f6733413-db16-4550-8eb6-eac700a39ea6";

  it("maps an identifier task key onto the issue id", () => {
    expect(canonicalIssueTaskKey("ZHA-1507", issueId, "ZHA-1507")).toBe(issueId);
    expect(canonicalIssueTaskKey("zha-1507", issueId, "ZHA-1507")).toBe(issueId);
  });

  it("leaves an issue-id task key untouched", () => {
    expect(canonicalIssueTaskKey(issueId, issueId, "ZHA-1507")).toBe(issueId);
  });

  it("keeps non-issue task keys and missing issue context", () => {
    expect(canonicalIssueTaskKey("status-card:abc", issueId, "ZHA-1507")).toBe("status-card:abc");
    expect(canonicalIssueTaskKey(issueId, issueId, null)).toBe(issueId);
    expect(canonicalIssueTaskKey("ZHA-1507", null, "ZHA-1507")).toBe("ZHA-1507");
    expect(canonicalIssueTaskKey(null, issueId, "ZHA-1507")).toBeNull();
  });
});

describe("deriveTaskKeyWithHeartbeatFallback", () => {
  it("returns explicit taskKey when present", () => {
    expect(deriveTaskKeyWithHeartbeatFallback({ taskKey: "issue-123" }, null)).toBe("issue-123");
  });

  it("returns explicit issueId when no taskKey", () => {
    expect(deriveTaskKeyWithHeartbeatFallback({ issueId: "issue-456" }, null)).toBe("issue-456");
  });

  it("returns __heartbeat__ for timer wakes with no explicit key", () => {
    expect(deriveTaskKeyWithHeartbeatFallback({ wakeSource: "timer" }, null)).toBe("__heartbeat__");
  });

  it("prefers explicit key over heartbeat fallback even on timer wakes", () => {
    expect(
      deriveTaskKeyWithHeartbeatFallback({ wakeSource: "timer", taskKey: "issue-789" }, null),
    ).toBe("issue-789");
  });

  it("returns null for non-timer wakes with no explicit key", () => {
    expect(deriveTaskKeyWithHeartbeatFallback({ wakeSource: "on_demand" }, null)).toBeNull();
  });

  it("returns null for empty context", () => {
    expect(deriveTaskKeyWithHeartbeatFallback({}, null)).toBeNull();
  });
});

describe("comment wake batching", () => {
  it("updates the latest comment when coalescing queued follow-up wakes", () => {
    const merged = mergeCoalescedContextSnapshot(
      {
        issueId: "issue-1",
        wakeReason: "issue_commented",
        wakeCommentId: "comment-1",
        wakeCommentIds: ["comment-1"],
        wardmoteWake: {
          latestCommentId: "comment-1",
        },
      },
      {
        issueId: "issue-1",
        wakeReason: "issue_commented",
        wakeCommentId: "comment-2",
      },
    );

    expect(merged.wakeCommentIds).toEqual(["comment-1", "comment-2"]);
    expect(merged.commentId).toBe("comment-2");
    expect(merged.wakeCommentId).toBe("comment-2");
    expect(merged.wardmoteWake).toBeUndefined();
  });

  it("keeps forceFreshSession sticky once any coalesced wake requests it", () => {
    const merged = mergeCoalescedContextSnapshot(
      {
        issueId: "issue-1",
        forceFreshSession: true,
      },
      {
        issueId: "issue-1",
        forceFreshSession: false,
      },
    );

    expect(merged.forceFreshSession).toBe(true);
  });

  it("keeps connection tool refresh intent while allowing harness session recovery", () => {
    const merged = mergeCoalescedContextSnapshot(
      { issueId: "issue-1", wakeReason: "issue_commented", refreshTools: true },
      { issueId: "issue-1", wakeReason: "issue_commented", refreshTools: false },
    );
    expect(merged.refreshTools).toBe(true);
    expect(shouldResetTaskSessionForWake(merged)).toBe(false);
  });
});

describe("buildExplicitResumeSessionOverride", () => {
  it("reuses saved task session params when they belong to the selected failed run", () => {
    const result = buildExplicitResumeSessionOverride({
      resumeFromRunId: "run-1",
      resumeRunSessionIdBefore: "session-before",
      resumeRunSessionIdAfter: "session-after",
      taskSession: {
        sessionParamsJson: {
          sessionId: "session-after",
          cwd: "/tmp/project",
        },
        sessionDisplayId: "session-after",
        lastRunId: "run-1",
      },
      sessionCodec: codexSessionCodec,
    });

    expect(result).toEqual({
      sessionDisplayId: "session-after",
      sessionParams: {
        sessionId: "session-after",
        cwd: "/tmp/project",
      },
    });
  });

  it("falls back to the selected run session id when no matching task session params are available", () => {
    const result = buildExplicitResumeSessionOverride({
      resumeFromRunId: "run-1",
      resumeRunSessionIdBefore: "session-before",
      resumeRunSessionIdAfter: "session-after",
      taskSession: {
        sessionParamsJson: {
          sessionId: "other-session",
          cwd: "/tmp/project",
        },
        sessionDisplayId: "other-session",
        lastRunId: "run-2",
      },
      sessionCodec: codexSessionCodec,
    });

    expect(result).toEqual({
      sessionDisplayId: "session-after",
      sessionParams: {
        sessionId: "session-after",
      },
    });
  });

});

describe("resolveNextSessionState", () => {
  it("keeps arbitrary session ids unchanged", () => {
    const result = resolveNextSessionState({
      adapterType: "codex_local",
      codec: codexSessionCodec,
      adapterResult: {
        exitCode: 1,
        signal: null,
        timedOut: false,
        sessionId: "from",
      },
      outcome: "failed",
      previousParams: null,
      previousDisplayId: null,
      previousLegacySessionId: null,
    });

    expect(result.legacySessionId).toBe("from");
  });
});

describe("formatRuntimeWorkspaceWarningLog", () => {
  it("emits informational workspace warnings on stdout", () => {
    expect(formatRuntimeWorkspaceWarningLog("Using fallback workspace")).toEqual({
      stream: "stdout",
      chunk: "[wardmote] Using fallback workspace\n",
    });
  });
});

describe("prioritizeProjectWorkspaceCandidatesForRun", () => {
  it("moves the explicitly selected workspace to the front", () => {
    const rows = [
      { id: "workspace-1", cwd: "/tmp/one" },
      { id: "workspace-2", cwd: "/tmp/two" },
      { id: "workspace-3", cwd: "/tmp/three" },
    ];

    expect(
      prioritizeProjectWorkspaceCandidatesForRun(rows, "workspace-2").map((row) => row.id),
    ).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
  });

  it("keeps the original order when no preferred workspace is selected", () => {
    const rows = [
      { id: "workspace-1" },
      { id: "workspace-2" },
    ];

    expect(
      prioritizeProjectWorkspaceCandidatesForRun(rows, null).map((row) => row.id),
    ).toEqual(["workspace-1", "workspace-2"]);
  });

  it("keeps the original order when the selected workspace is missing", () => {
    const rows = [
      { id: "workspace-1" },
      { id: "workspace-2" },
    ];

    expect(
      prioritizeProjectWorkspaceCandidatesForRun(rows, "workspace-9").map((row) => row.id),
    ).toEqual(["workspace-1", "workspace-2"]);
  });
});

describe("parseSessionCompactionPolicy", () => {
  it("leaves Wardmote-managed rotation off for adapters without declared session management", () => {
    expect(parseSessionCompactionPolicy(buildAgent("acme_local"))).toMatchObject({ enabled: false });
  });

  it("lets explicit agent overrides win over adapter defaults", () => {
    expect(
      parseSessionCompactionPolicy(
        buildAgent("acme_local", {
          heartbeat: {
            sessionCompaction: {
              enabled: true,
              maxSessionRuns: 25,
              maxRawInputTokens: 500_000,
            },
          },
        }),
      ),
    ).toMatchObject({
      enabled: true,
      maxSessionRuns: 25,
      maxRawInputTokens: 500_000,
    });
  });

  it("leaves omp_local to its native compaction unless an agent sets a size threshold", () => {
    expect(parseSessionCompactionPolicy(buildAgent("omp_local"))).toEqual({
      enabled: true,
      maxSessionRuns: 0,
      maxRawInputTokens: 0,
      maxSessionAgeHours: 0,
      maxSessionBytes: 0,
    });
    expect(
      parseSessionCompactionPolicy(
        buildAgent("omp_local", {
          heartbeat: { sessionCompaction: { maxSessionBytes: 4096 } },
        }),
      ),
    ).toEqual({
      enabled: true,
      maxSessionRuns: 0,
      maxRawInputTokens: 0,
      maxSessionAgeHours: 0,
      maxSessionBytes: 4096,
    });
  });
});

describe("isWorkspaceSyncConflictFailure", () => {
  it("matches the git workspace reconciliation failure signatures", () => {
    expect(isWorkspaceSyncConflictFailure(
      "Failed to merge concurrent remote git histories for a5d46a8005b3 and c1042c11774a: Command failed: git merge-tree --write-tree",
    )).toBe(true);
    expect(isWorkspaceSyncConflictFailure(
      "Failed to integrate concurrent remote git history for a5d46a8005b3 after multiple retries.",
    )).toBe(true);
    expect(isWorkspaceSyncConflictFailure(
      "error: /tmp/restore/git-delta.bundle did not send all necessary objects",
    )).toBe(true);
    expect(isWorkspaceSyncConflictFailure(
      "error: Repository lacks these prerequisite commits: 4c631700",
    )).toBe(true);
  });

  it("ignores unrelated adapter failures", () => {
    expect(isWorkspaceSyncConflictFailure("Codex exited with code 2")).toBe(false);
    expect(isWorkspaceSyncConflictFailure("no Codex credentials provisioned for managed home")).toBe(false);
    expect(isWorkspaceSyncConflictFailure(null)).toBe(false);
    expect(isWorkspaceSyncConflictFailure("")).toBe(false);
  });
});

describe("reconcileReusedExecutionWorkspaceProjectWorkspaceId", () => {
  it("backfills a null existing binding from the resolved value", () => {
    expect(
      reconcileReusedExecutionWorkspaceProjectWorkspaceId(null, "resolved-workspace"),
    ).toBe("resolved-workspace");
  });

  it("never overwrites an existing binding, even when a resolved value is present", () => {
    expect(
      reconcileReusedExecutionWorkspaceProjectWorkspaceId("existing-workspace", "resolved-workspace"),
    ).toBe("existing-workspace");
  });

  it("returns null when both existing and resolved are absent", () => {
    expect(reconcileReusedExecutionWorkspaceProjectWorkspaceId(null, null)).toBeNull();
    expect(reconcileReusedExecutionWorkspaceProjectWorkspaceId(undefined, undefined)).toBeNull();
    expect(reconcileReusedExecutionWorkspaceProjectWorkspaceId(null, undefined)).toBeNull();
  });

  it("backfills when existing is undefined and resolved is present", () => {
    expect(
      reconcileReusedExecutionWorkspaceProjectWorkspaceId(undefined, "resolved-workspace"),
    ).toBe("resolved-workspace");
  });
});
