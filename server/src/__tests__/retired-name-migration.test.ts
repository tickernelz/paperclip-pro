import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentConfigRevisions,
  agentInstructionHeads,
  agentInstructionRevisions,
  agents,
  companies,
  createDb,
  routineRevisions,
  routines,
} from "@tickernelz/wardmote-db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { resolveManagedInstructionsRoot } from "../services/agent-instructions.js";
import { migrateRetiredNames } from "../services/retired-name-migration.js";

describe("retired product name migration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const previousHome = process.env.WARDMOTE_HOME;
  let home: string;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const routineId = randomUUID();
  const configRevisionId = randomUUID();
  const routineRevisionId = randomUUID();
  const original = "# Agent\nCall paperclipListIssues with $PAPERCLIP_RUN_SCRATCH_DIR and $PAPERCLIP_WIRA_API_KEY.\nRead skill://paperclip.\n";

  beforeAll(async () => {
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "retired-name-migration-")));
    process.env.WARDMOTE_HOME = home;
    database = await startEmbeddedPostgresTestDatabase("retired-name-migration-");
    db = createDb(database.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Rename", issuePrefix: randomUUID().slice(0, 8) });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Agent",
      adapterConfig: {
        env: { PAPERCLIP_WIRA_API_KEY: "secret-ref" },
        promptTemplate: "Use paperclipGetIssue, send X-Paperclip-Run-Id, keep $PAPERCLIP_WIRA_API_KEY.",
        paperclipRuntimeSkills: [],
      },
    });
    const revisionId = randomUUID();
    await db.insert(agentInstructionRevisions).values({
      id: revisionId, companyId, agentId, entryFile: "AGENTS.md",
      contentBase64: Buffer.from(original).toString("base64"),
      contentHash: createHash("sha256").update(original).digest("hex"),
      byteLength: Buffer.byteLength(original), source: "board",
    });
    await db.insert(agentInstructionHeads).values({ companyId, agentId, entryFile: "AGENTS.md", revisionId });
    await db.insert(agentConfigRevisions).values({
      id: configRevisionId, companyId, agentId, changedKeys: ["adapterConfig"],
      beforeConfig: { adapterConfig: { promptTemplate: "paperclipMe" } },
      afterConfig: { adapterConfig: { promptTemplate: "paperclipGetAgent" } },
    });
    await db.insert(routines).values({ id: routineId, companyId, title: "Daily", description: "Post with paperclipAddComment via /mcp/paperclip." });
    await db.insert(routineRevisions).values({
      id: routineRevisionId, companyId, routineId, revisionNumber: 1, title: "Daily",
      description: "Post with paperclipAddComment.",
      snapshot: { description: "Post with paperclipAddComment." } as never,
    });
  }, 90_000);

  afterAll(async () => {
    if (previousHome === undefined) delete process.env.WARDMOTE_HOME; else process.env.WARDMOTE_HOME = previousHome;
    await database?.cleanup();
    if (home) await fs.rm(home, { recursive: true, force: true });
  });

  it("previews, applies with backups, keeps operator env names, then becomes a no-op", async () => {
    const instanceRoot = path.join(home, "instances", "default");
    const root = resolveManagedInstructionsRoot({ id: agentId, companyId, adapterConfig: {} } as never);

    const preview = await migrateRetiredNames(db, { dryRun: true, instanceRoot });
    expect(preview.files).toEqual([{ companyId, agentId, file: "AGENTS.md", replacements: 3 }]);
    expect(preview.rows.map((row) => row.table).sort()).toEqual(["agent_config_revisions", "agents", "routine_revisions", "routines"]);
    expect(preview.backupDir).toBeNull();
    await expect(fs.access(path.join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    const [unchanged] = await db.select().from(routines).where(eq(routines.id, routineId));
    expect(unchanged!.description).toBe("Post with paperclipAddComment via /mcp/paperclip.");

    const applied = await migrateRetiredNames(db, { instanceRoot, now: new Date("2026-11-10T00:00:00Z") });
    expect(applied.files).toHaveLength(1);
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(
      "# Agent\nCall wardmoteListIssues with $WARDMOTE_RUN_SCRATCH_DIR and $PAPERCLIP_WIRA_API_KEY.\nRead skill://wardmote.\n",
    );
    expect(await fs.readFile(path.join(applied.backupDir!, "instructions", companyId, agentId, "AGENTS.md"), "utf8")).toBe(original);
    const backedUpRows = JSON.parse(await fs.readFile(path.join(applied.backupDir!, "rows.json"), "utf8"));
    expect(backedUpRows).toHaveLength(4);

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent!.adapterConfig).toEqual({
      env: { PAPERCLIP_WIRA_API_KEY: "secret-ref" },
      promptTemplate: "Use wardmoteGetIssue, send X-Wardmote-Run-Id, keep $PAPERCLIP_WIRA_API_KEY.",
      paperclipRuntimeSkills: [],
    });
    const [configRevision] = await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, configRevisionId));
    expect(configRevision!.beforeConfig).toEqual({ adapterConfig: { promptTemplate: "wardmoteMe" } });
    expect(configRevision!.afterConfig).toEqual({ adapterConfig: { promptTemplate: "wardmoteGetAgent" } });
    const [routine] = await db.select().from(routines).where(eq(routines.id, routineId));
    expect(routine!.description).toBe("Post with wardmoteAddComment via /mcp/wardmote.");
    const [routineRevision] = await db.select().from(routineRevisions).where(eq(routineRevisions.id, routineRevisionId));
    expect(routineRevision!.description).toBe("Post with wardmoteAddComment.");
    expect(routineRevision!.snapshot).toEqual({ description: "Post with wardmoteAddComment." });

    await fs.mkdir(path.join(root, "notes"), { recursive: true });
    await fs.writeFile(path.join(root, "notes", "extra.md"), "Use paperclipMe.\n");
    await fs.writeFile(path.join(root, "notes", "blob.bin"), Buffer.from([0, 112, 97, 112, 101, 114, 99, 108, 105, 112, 77, 101]));
    const followUp = await migrateRetiredNames(db, { instanceRoot, now: new Date("2026-11-10T00:01:00Z") });
    expect(followUp.files).toEqual([{ companyId, agentId, file: "notes/extra.md", replacements: 1 }]);
    expect(followUp.rows).toEqual([]);
    expect(await fs.readFile(path.join(root, "notes", "extra.md"), "utf8")).toBe("Use wardmoteMe.\n");

    const idle = await migrateRetiredNames(db, { instanceRoot, now: new Date("2026-11-10T00:02:00Z") });
    expect(idle).toEqual({ dryRun: false, files: [], rows: [], externalBundles: [], failedBundles: [], backupDir: null });
  }, 60_000);

  it("reports a bundle it cannot adopt and still rewrites the other agents", async () => {
    const instanceRoot = path.join(home, "instances", "default");
    const brokenId = randomUUID();
    const healthyId = randomUUID();
    await db.insert(agents).values([
      { id: brokenId, companyId, name: "Broken", adapterConfig: {} },
      { id: healthyId, companyId, name: "Healthy", adapterConfig: {} },
    ]);
    const brokenRoot = resolveManagedInstructionsRoot({ id: brokenId, companyId, adapterConfig: {} } as never);
    await fs.mkdir(path.join(path.dirname(brokenRoot), "file-sync"), { recursive: true });
    await fs.writeFile(path.join(path.dirname(brokenRoot), "file-sync", "adopted.json"), JSON.stringify({ schema: "unknown" }));
    const healthyRoot = resolveManagedInstructionsRoot({ id: healthyId, companyId, adapterConfig: {} } as never);
    await fs.mkdir(healthyRoot, { recursive: true });
    await fs.writeFile(path.join(healthyRoot, "AGENTS.md"), "Use paperclipMe.\n");

    const report = await migrateRetiredNames(db, { instanceRoot, now: new Date("2026-11-10T00:03:00Z") });

    expect(report.failedBundles).toEqual([{ companyId, agentId: brokenId, error: "Unsupported agent file contract" }]);
    expect(report.files).toEqual([{ companyId, agentId: healthyId, file: "AGENTS.md", replacements: 1 }]);
    expect(await fs.readFile(path.join(healthyRoot, "AGENTS.md"), "utf8")).toBe("Use wardmoteMe.\n");
  }, 60_000);
});
