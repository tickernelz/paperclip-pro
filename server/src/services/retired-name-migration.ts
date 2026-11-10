import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  agentConfigRevisions,
  agentInstructionHeads,
  agentInstructionRevisions,
  agents,
  chatEndpoints,
  routineRevisions,
  routines,
  type Db,
} from "@tickernelz/wardmote-db";
import {
  operatorRetiredEnvKeys,
  rewriteRetiredNames,
  rewriteRetiredNamesInJson,
  type RetiredNameRewriteOptions,
} from "@tickernelz/wardmote-shared/retired-names";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { adoptAgentFiles } from "./agent-file-store.js";
import { materializeInstructionBytes } from "./agent-instruction-files.js";
import { agentInstructionsBundleMode, resolveManagedInstructionsRoot } from "./agent-instructions.js";

export type RetiredNameFileChange = { companyId: string; agentId: string; file: string; replacements: number };
export type RetiredNameRowChange = { table: string; id: string; column: string; replacements: number };

export type RetiredNameMigrationReport = {
  dryRun: boolean;
  files: RetiredNameFileChange[];
  rows: RetiredNameRowChange[];
  externalBundles: Array<{ companyId: string; agentId: string }>;
  backupDir: string | null;
};

type Agent = typeof agents.$inferSelect;
type FileText = { file: string; text: string };

async function listBundleTexts(root: string): Promise<FileText[]> {
  const files: FileText[] = [];
  async function walk(relative: string): Promise<void> {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(path.join(root, child));
        if (!bytes.includes(0)) files.push({ file: child, text: bytes.toString("utf8") });
      }
    }
  }
  await walk("");
  return files;
}

async function isAdopted(root: string): Promise<boolean> {
  return fs.access(path.join(path.dirname(root), "file-sync", "adopted.json")).then(() => true, () => false);
}

async function headTexts(db: Db, agent: Agent): Promise<FileText[]> {
  const rows = await db
    .select({ entryFile: agentInstructionHeads.entryFile, contentBase64: agentInstructionRevisions.contentBase64 })
    .from(agentInstructionHeads)
    .innerJoin(agentInstructionRevisions, eq(agentInstructionHeads.revisionId, agentInstructionRevisions.id))
    .where(and(eq(agentInstructionHeads.companyId, agent.companyId), eq(agentInstructionHeads.agentId, agent.id)));
  return rows.map((row) => ({ file: row.entryFile, text: Buffer.from(row.contentBase64, "base64").toString("utf8") }));
}

async function previewBundleTexts(db: Db, agent: Agent, root: string): Promise<FileText[]> {
  const files = new Map((await listBundleTexts(root)).map((entry) => [entry.file, entry.text]));
  if (!(await isAdopted(root))) for (const head of await headTexts(db, agent)) files.set(head.file, head.text);
  return [...files].map(([file, text]) => ({ file, text }));
}

async function writeBackup(backupDir: string, relative: string, contents: string): Promise<void> {
  const target = path.join(backupDir, relative);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, contents, { flag: "wx", mode: 0o600 });
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** Rewrites retired product names in live agent instructions and stored agent-facing text; idempotent. */
export async function migrateRetiredNames(
  db: Db,
  options: { dryRun?: boolean; instanceRoot?: string; now?: Date } = {},
): Promise<RetiredNameMigrationReport> {
  const dryRun = options.dryRun === true;
  const instanceRoot = options.instanceRoot ?? resolvePaperclipInstanceRoot();
  const backupDir = path.join(instanceRoot, "backups", `wardmote-rename-${stamp(options.now ?? new Date())}`);
  const report: RetiredNameMigrationReport = { dryRun, files: [], rows: [], externalBundles: [], backupDir: null };
  const rowBackups: Array<{ table: string; id: string; column: string; before: unknown }> = [];
  const allAgents = await db.select().from(agents);
  const companyKeep = new Map<string, Set<string>>();
  const agentKeep = new Map<string, Set<string>>();
  for (const agent of allAgents) {
    const keys = operatorRetiredEnvKeys(agent.adapterConfig);
    agentKeep.set(agent.id, keys);
    const company = companyKeep.get(agent.companyId) ?? new Set<string>();
    for (const key of keys) company.add(key);
    companyKeep.set(agent.companyId, company);
  }
  const optionsFor = (keep: Set<string> | undefined): RetiredNameRewriteOptions => ({ keepEnvKeys: keep ?? new Set() });

  for (const agent of allAgents) {
    if (agentInstructionsBundleMode(agent) === "external") {
      report.externalBundles.push({ companyId: agent.companyId, agentId: agent.id });
      continue;
    }
    const root = resolveManagedInstructionsRoot(agent);
    const rewriteOptions = optionsFor(agentKeep.get(agent.id));
    const texts = dryRun
      ? await previewBundleTexts(db, agent, root)
      : await db.transaction(async (tx) => {
          const [locked] = await tx.select().from(agents).where(eq(agents.id, agent.id)).for("update");
          if (!locked) return [];
          await adoptAgentFiles(tx, locked);
          return listBundleTexts(root);
        });
    for (const { file, text } of texts) {
      const result = rewriteRetiredNames(text, rewriteOptions);
      if (result.text === text) continue;
      report.files.push({ companyId: agent.companyId, agentId: agent.id, file, replacements: result.replacements });
      if (dryRun) continue;
      await writeBackup(backupDir, path.join("instructions", agent.companyId, agent.id, file), text);
      await materializeInstructionBytes(root, file, Buffer.from(result.text, "utf8"));
    }
  }

  await db.transaction(async (tx) => {
    const record = (table: string, id: string, column: string, before: unknown, replacements: number) => {
      report.rows.push({ table, id, column, replacements });
      rowBackups.push({ table, id, column, before });
    };
    for (const agent of allAgents) {
      const next = rewriteRetiredNamesInJson(agent.adapterConfig, optionsFor(agentKeep.get(agent.id)));
      if (next.replacements === 0) continue;
      record("agents", agent.id, "adapter_config", agent.adapterConfig, next.replacements);
      if (!dryRun) await tx.update(agents).set({ adapterConfig: next.value }).where(eq(agents.id, agent.id));
    }
    for (const revision of await tx.select().from(agentConfigRevisions)) {
      const keep = optionsFor(agentKeep.get(revision.agentId));
      const before = rewriteRetiredNamesInJson(revision.beforeConfig, keep);
      const after = rewriteRetiredNamesInJson(revision.afterConfig, keep);
      if (before.replacements + after.replacements === 0) continue;
      record("agent_config_revisions", revision.id, "before_config,after_config",
        { beforeConfig: revision.beforeConfig, afterConfig: revision.afterConfig }, before.replacements + after.replacements);
      if (!dryRun) {
        await tx.update(agentConfigRevisions)
          .set({ beforeConfig: before.value, afterConfig: after.value })
          .where(eq(agentConfigRevisions.id, revision.id));
      }
    }
    for (const routine of await tx.select({ id: routines.id, companyId: routines.companyId, description: routines.description }).from(routines)) {
      if (!routine.description) continue;
      const next = rewriteRetiredNames(routine.description, optionsFor(companyKeep.get(routine.companyId)));
      if (next.text === routine.description) continue;
      record("routines", routine.id, "description", routine.description, next.replacements);
      if (!dryRun) await tx.update(routines).set({ description: next.text }).where(eq(routines.id, routine.id));
    }
    const revisions = await tx
      .select({ id: routineRevisions.id, companyId: routineRevisions.companyId, description: routineRevisions.description, snapshot: routineRevisions.snapshot })
      .from(routineRevisions);
    for (const revision of revisions) {
      const keep = optionsFor(companyKeep.get(revision.companyId));
      const description = revision.description ? rewriteRetiredNames(revision.description, keep) : null;
      const snapshot = rewriteRetiredNamesInJson(revision.snapshot, keep);
      const replacements = (description?.replacements ?? 0) + snapshot.replacements;
      if (replacements === 0) continue;
      record("routine_revisions", revision.id, "description,snapshot",
        { description: revision.description, snapshot: revision.snapshot }, replacements);
      if (!dryRun) {
        await tx.update(routineRevisions)
          .set({ description: description?.text ?? revision.description, snapshot: snapshot.value })
          .where(eq(routineRevisions.id, revision.id));
      }
    }
    const endpoints = await tx
      .select({ id: chatEndpoints.id, companyId: chatEndpoints.companyId, policy: chatEndpoints.policy, communicationInstructions: chatEndpoints.communicationInstructions })
      .from(chatEndpoints);
    for (const endpoint of endpoints) {
      const keep = optionsFor(companyKeep.get(endpoint.companyId));
      const policy = rewriteRetiredNamesInJson(endpoint.policy, keep);
      const instructions = rewriteRetiredNames(endpoint.communicationInstructions, keep);
      if (policy.replacements + instructions.replacements === 0) continue;
      record("chat_endpoints", endpoint.id, "policy,communication_instructions",
        { policy: endpoint.policy, communicationInstructions: endpoint.communicationInstructions }, policy.replacements + instructions.replacements);
      if (!dryRun) {
        await tx.update(chatEndpoints)
          .set({ policy: policy.value, communicationInstructions: instructions.text })
          .where(eq(chatEndpoints.id, endpoint.id));
      }
    }
    if (!dryRun && rowBackups.length > 0) {
      await writeBackup(backupDir, "rows.json", JSON.stringify(rowBackups, null, 2));
    }
  });

  if (!dryRun && (report.files.length > 0 || report.rows.length > 0)) {
    report.backupDir = backupDir;
    await writeBackup(backupDir, "report.json", JSON.stringify(report, null, 2));
  }
  return report;
}
