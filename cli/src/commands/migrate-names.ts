import pc from "picocolors";
import { createDb } from "@tickernelz/wardmote-db";
import { resolveConnectionString } from "./db-backup.js";

type MigrateNamesOptions = { config?: string; dryRun?: boolean; json?: boolean };

/** Previews or applies the retired-name rewrite the server also runs on start. */
export async function migrateNamesCommand(options: MigrateNamesOptions): Promise<void> {
  const connection = resolveConnectionString(options.config);
  const { migrateRetiredNames } = await import("@tickernelz/wardmote-server");
  const db = createDb(connection.value) as ReturnType<typeof createDb> & {
    $client?: { end?: (options?: { timeout?: number }) => Promise<void> };
  };
  try {
    const report = await migrateRetiredNames(db, { dryRun: options.dryRun === true });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const verb = report.dryRun ? "Would rewrite" : "Rewrote";
    console.log(pc.bold(`${verb} ${report.files.length} instruction file(s) and ${report.rows.length} stored row(s).`));
    for (const change of report.files) {
      console.log(`  ${change.companyId}/${change.agentId}/${change.file}: ${change.replacements} replacement(s)`);
    }
    for (const change of report.rows) {
      console.log(`  ${change.table} ${change.id} ${change.column}: ${change.replacements} replacement(s)`);
    }
    for (const external of report.externalBundles) {
      console.log(pc.yellow(`  external bundle not rewritten: ${external.companyId}/${external.agentId}`));
    }
    for (const failed of report.failedBundles) {
      console.log(pc.red(`  bundle not rewritten: ${failed.companyId}/${failed.agentId}: ${failed.error}`));
    }
    for (const key of report.quarantinedRunnerStates) {
      console.log(pc.yellow(`  native runner state written under retired names ${report.dryRun ? "would be" : "was"} moved to quarantine: ${key}`));
    }
    if (report.backupDir) console.log(pc.dim(`Backup: ${report.backupDir}`));
  } finally {
    await db.$client?.end?.({ timeout: 5 }).catch(() => undefined);
  }
}
