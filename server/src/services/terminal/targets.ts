import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { executionWorkspaces, issues, projectWorkspaces } from "@tickernelz/paperclip-pro-db";
import { badRequest, notFound, unprocessable } from "../../errors.js";
import { resolveEnvironmentDriverConfigForRuntime } from "../environment-config.js";
import { environmentService } from "../environments.js";
import type { SshTerminalTarget } from "./ssh.js";

function readPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function isDirectory(candidate: string): Promise<boolean> {
  const stat = await fs.stat(candidate).catch(() => null);
  return stat?.isDirectory() ?? false;
}

export async function listIssueWorkspaceCandidates(db: Db, companyId: string, issueId: string): Promise<string[]> {
  const issue = await db
    .select({
      executionWorkspaceId: issues.executionWorkspaceId,
      projectWorkspaceId: issues.projectWorkspaceId,
      projectId: issues.projectId,
    })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
    .then((rows) => rows[0] ?? null);
  if (!issue) throw notFound("Issue not found");

  const candidates: string[] = [];
  if (issue.executionWorkspaceId) {
    const workspace = await db
      .select({ providerRef: executionWorkspaces.providerRef, cwd: executionWorkspaces.cwd })
      .from(executionWorkspaces)
      .where(and(eq(executionWorkspaces.id, issue.executionWorkspaceId), eq(executionWorkspaces.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    const workspacePath = readPath(workspace?.providerRef) ?? readPath(workspace?.cwd);
    if (workspacePath) candidates.push(workspacePath);
  }
  if (issue.projectWorkspaceId) {
    const workspace = await db
      .select({ cwd: projectWorkspaces.cwd })
      .from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.id, issue.projectWorkspaceId), eq(projectWorkspaces.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    const workspacePath = readPath(workspace?.cwd);
    if (workspacePath) candidates.push(workspacePath);
  } else if (issue.projectId) {
    const workspace = await db
      .select({ cwd: projectWorkspaces.cwd })
      .from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.projectId, issue.projectId), eq(projectWorkspaces.companyId, companyId)))
      .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt))
      .then((rows) => rows[0] ?? null);
    const workspacePath = readPath(workspace?.cwd);
    if (workspacePath) candidates.push(workspacePath);
  }
  return candidates;
}

export async function pickExistingDirectory(candidates: string[], fallback: string = homedir()): Promise<string> {
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    if (await isDirectory(candidate)) return candidate;
  }
  return fallback;
}

export async function resolveLocalTerminalCwd(db: Db, companyId: string, issueId: string | null): Promise<string> {
  const candidates = issueId ? await listIssueWorkspaceCandidates(db, companyId, issueId) : [];
  return pickExistingDirectory(candidates);
}

export async function resolveSshTerminalTarget(
  db: Db,
  companyId: string,
  environmentId: string,
): Promise<{ target: SshTerminalTarget; title: string }> {
  const environments = environmentService(db);
  const environment = await environments.getById(environmentId);
  if (!environment) throw notFound("Environment not found");
  const boundCompanyIds = await environments.listBoundCompanyIds(environment.id);
  if (boundCompanyIds.length > 0 && !boundCompanyIds.includes(companyId)) {
    throw notFound("Environment not found");
  }
  if (environment.status !== "active") {
    throw unprocessable("Environment is not active");
  }
  if (environment.driver !== "ssh") {
    throw badRequest(`SSH terminals need an environment with the ssh driver; this environment uses "${environment.driver}"`);
  }
  const parsed = await resolveEnvironmentDriverConfigForRuntime(db, companyId, {
    id: environment.id,
    driver: environment.driver,
    config: environment.config,
  });
  if (parsed.driver !== "ssh") {
    throw badRequest("SSH terminals need an environment with the ssh driver");
  }
  return {
    target: {
      host: parsed.config.host,
      port: parsed.config.port,
      username: parsed.config.username,
      privateKey: parsed.config.privateKey,
      knownHosts: parsed.config.knownHosts,
      strictHostKeyChecking: parsed.config.strictHostKeyChecking,
      remoteCwd: parsed.config.remoteWorkspacePath,
    },
    title: `${parsed.config.username}@${parsed.config.host}`,
  };
}
