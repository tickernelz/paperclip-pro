import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  adoptRetiredBackupFilenames,
  createBufferedTextFileWriter,
  DATABASE_BACKUP_SKIPPED_MARKER,
  DatabaseBackupSkippedError,
  removeAbandonedPartialBackups,
  runDatabaseBackup,
  runDatabaseRestore,
} from "./backup-lib.js";
import { ensurePostgresDatabase } from "./client.js";
import { RETIRED_STATEMENT_BREAKPOINT } from "./retired-backup-names.js";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void> | void> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("wardmote-db-backup-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

async function createSiblingDatabase(connectionString: string, databaseName: string): Promise<string> {
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";
  await ensurePostgresDatabase(adminUrl.toString(), databaseName);
  const targetUrl = new URL(connectionString);
  targetUrl.pathname = `/${databaseName}`;
  return targetUrl.toString();
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
}, 60_000);

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres backup tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("createBufferedTextFileWriter", () => {
  it("preserves line boundaries across buffered flushes", async () => {
    const tempDir = createTempDir("wardmote-buffered-writer-");
    const outputPath = path.join(tempDir, "backup.sql");
    const writer = createBufferedTextFileWriter(outputPath, 16);
    const lines = [
      "-- header",
      "BEGIN;",
      "",
      "INSERT INTO test VALUES (1);",
      "-- footer",
    ];

    for (const line of lines) {
      writer.emit(line);
    }

    await writer.close();

    expect(fs.readFileSync(outputPath, "utf8")).toBe(lines.join("\n"));
  });
});

describe("adoptRetiredBackupFilenames", () => {
  it("renames retired-prefix backups once and leaves everything else", () => {
    const dir = createTempDir("wardmote-backup-adopt-");
    const retired = ["paperclip", ""].join("-");
    fs.writeFileSync(path.join(dir, `${retired}20261101-010000.sql.gz`), "old");
    fs.writeFileSync(path.join(dir, `${retired}20261102-010000.sql.gz`), "taken");
    fs.writeFileSync(path.join(dir, "wardmote-20261102-010000.sql.gz"), "new");
    fs.writeFileSync(path.join(dir, `${retired}notes.txt`), "keep");
    expect(adoptRetiredBackupFilenames(dir)).toBe(1);
    expect(fs.readFileSync(path.join(dir, "wardmote-20261101-010000.sql.gz"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(dir, "wardmote-20261102-010000.sql.gz"), "utf8")).toBe("new");
    expect(fs.readdirSync(dir).filter((name) => name.startsWith(retired)).sort()).toEqual([`${retired}20261102-010000.sql.gz`, `${retired}notes.txt`]);
    expect(adoptRetiredBackupFilenames(dir)).toBe(0);
  });
});

describe("removeAbandonedPartialBackups", () => {
  it("removes partials of dead or stale owners and keeps live ones and unrelated files", () => {
    const dir = createTempDir("wardmote-backup-partial-");
    const deadPid = 999_999_999;
    const write = (name: string, mtime?: Date) => {
      fs.writeFileSync(path.join(dir, name), "x");
      if (mtime) fs.utimesSync(path.join(dir, name), mtime, mtime);
    };
    write(`wardmote-20261112-040545.sql.gz.${deadPid}.partial`);
    write(`wardmote-20261112-040545.sql.${deadPid}.partial`);
    write(`wardmote-20261112-050000.sql.${process.pid}.partial`);
    write(`wardmote-20261112-060000.sql.gz.${process.ppid}.partial`);
    write(`wardmote-20261110-060000.sql.gz.${process.ppid}.partial`, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    write(`notes.${deadPid}.partial`);
    write("wardmote-20261112-070000.sql.gz");

    expect(removeAbandonedPartialBackups(dir)).toBe(4);
    expect(fs.readdirSync(dir).sort()).toEqual([
      `notes.${deadPid}.partial`,
      `wardmote-20261112-060000.sql.gz.${process.ppid}.partial`,
      "wardmote-20261112-070000.sql.gz",
    ]);
  });
});

describeEmbeddedPostgres("runDatabaseBackup", () => {
  it("leaves no final backup when the backup process is killed mid-dump, and the next run cleans its partials", async () => {
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("wardmote-backup-killed-");
    const fixtureDir = createTempDir("wardmote-backup-killed-fixture-");
    const marker = path.join(fixtureDir, "dumping");
    const slowPgDump = path.join(fixtureDir, "pg-dump-slow");
    fs.writeFileSync(
      slowPgDump,
      `#!/bin/sh\nhead -c 4000000 /dev/urandom | base64\ntouch '${marker}'\nexec sleep 60\n`,
      { mode: 0o700 },
    );
    const script = path.join(fixtureDir, "backup.mts");
    fs.writeFileSync(
      script,
      [
        `import { runDatabaseBackup } from ${JSON.stringify(path.join(import.meta.dirname, "backup-lib.ts"))};`,
        `await runDatabaseBackup({ connectionString: process.env.BACKUP_TEST_URL!, backupDir: ${JSON.stringify(backupDir)}, backupEngine: "pg_dump", retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 } });`,
      ].join("\n"),
    );
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      cwd: path.dirname(import.meta.dirname),
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BACKUP_TEST_URL: connectionString, WARDMOTE_PG_DUMP_PATH: slowPgDump },
    });
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const exited = new Promise<NodeJS.Signals | null>((resolveExit) => child.once("exit", (_code, signal) => resolveExit(signal)));
    cleanups.push(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    });

    const archiveBytes = () => fs.readdirSync(backupDir)
      .filter((name) => name.includes(".sql.gz"))
      .reduce((sum, name) => sum + fs.statSync(path.join(backupDir, name)).size, 0);
    const deadline = Date.now() + 60_000;
    while (!(fs.existsSync(marker) && archiveBytes() > 0)) {
      if (Date.now() > deadline) throw new Error(`backup never started writing: [${fs.readdirSync(backupDir).join(", ")}] ${stderr}`);
      await new Promise((tick) => setTimeout(tick, 50));
    }
    process.kill(-child.pid!, "SIGKILL");
    expect(await exited).toBe("SIGKILL");

    const left = fs.readdirSync(backupDir);
    expect(left.filter((name) => name.endsWith(".sql") || name.endsWith(".sql.gz"))).toEqual([]);
    expect(left.some((name) => name.endsWith(`.${child.pid}.partial`))).toBe(true);

    const quickPgDump = path.join(fixtureDir, "pg-dump-quick");
    fs.writeFileSync(quickPgDump, "#!/bin/sh\nprintf 'SELECT 1;\\n'\n", { mode: 0o700 });
    const previous = process.env.WARDMOTE_PG_DUMP_PATH;
    process.env.WARDMOTE_PG_DUMP_PATH = quickPgDump;
    try {
      const result = await runDatabaseBackup({
        connectionString, backupDir, backupEngine: "pg_dump",
        retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
      });
      expect(fs.readdirSync(backupDir)).toEqual([path.basename(result.backupFile)]);
      expect(gunzipSync(fs.readFileSync(result.backupFile)).toString()).toBe("SELECT 1;\n");
    } finally {
      if (previous === undefined) delete process.env.WARDMOTE_PG_DUMP_PATH;
      else process.env.WARDMOTE_PG_DUMP_PATH = previous;
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("preserves a post-pg_dump verification error without falling back or pruning", async () => {
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("checkpoint-pg-dump-");
    const executable = path.join(backupDir, "pg-dump-fixture");
    fs.writeFileSync(executable, "#!/bin/sh\nprintf 'SELECT 1;\\n'\n", { mode: 0o700 });
    const history = path.join(backupDir, "wardmote-history.sql.gz");
    const historyBytes = gzipSync("SELECT 'history';");
    fs.writeFileSync(history, historyBytes);
    fs.utimesSync(history, new Date(0), new Date(0));
    const previous = process.env.WARDMOTE_PG_DUMP_PATH;
    process.env.WARDMOTE_PG_DUMP_PATH = executable;
    const failure = new Error("fixture archive fsync failed");
    let verified = 0;
    try {
      await expect(runDatabaseBackup({
        connectionString, backupDir,
        retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
        verifyBeforePrune: async archive => {
          verified++;
          expect(gunzipSync(fs.readFileSync(archive)).toString()).toBe("SELECT 1;\n");
          throw failure;
        },
      })).rejects.toBe(failure);
      expect(verified).toBe(1);
      expect(fs.readFileSync(history)).toEqual(historyBytes);
      expect(fs.readdirSync(backupDir).filter(name => name.endsWith(".sql.gz"))).toEqual(["wardmote-history.sql.gz"]);
    } finally {
      if (previous === undefined) delete process.env.WARDMOTE_PG_DUMP_PATH;
      else process.env.WARDMOTE_PG_DUMP_PATH = previous;
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("preserves identity generation, sequence options and progress in JavaScript backups", async () => {
    const source = await createTempDatabase();
    const target = await createSiblingDatabase(source, "identity_restore_target");
    const sourceSql = postgres(source, { max: 1, onnotice: () => {} });
    const targetSql = postgres(target, { max: 1, onnotice: () => {} });
    try {
      await sourceSql.unsafe(`
        CREATE SCHEMA identity_fixture;
        CREATE TABLE identity_fixture.records (
          id bigint GENERATED ALWAYS AS IDENTITY (START WITH 7 INCREMENT BY 2) PRIMARY KEY,
          default_id integer GENERATED BY DEFAULT AS IDENTITY,
          value text NOT NULL
        );
        INSERT INTO identity_fixture.records (value) VALUES ('one'), ('two');
      `);
      const backup = await runDatabaseBackup({ connectionString: source, backupDir: createTempDir("identity-backup-"), backupEngine: "javascript", retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 } });
      await runDatabaseRestore({ connectionString: target, backupFile: backup.backupFile });
      expect(await targetSql`SELECT id::text, default_id, value FROM identity_fixture.records ORDER BY id`)
        .toEqual([{ id: "7", default_id: 1, value: "one" }, { id: "9", default_id: 2, value: "two" }]);
      expect(await targetSql`INSERT INTO identity_fixture.records (value) VALUES ('three') RETURNING id::text, default_id`)
        .toEqual([{ id: "11", default_id: 3 }]);
      await expect(targetSql`INSERT INTO identity_fixture.records (id, value) VALUES (99, 'explicit')`).rejects.toThrow("non-DEFAULT");
    } finally {
      await sourceSql.end();
      await targetSql.end();
    }
  }, 30_000);

  it(
    "keeps the newest backup for each retained calendar month",
    async () => {
      const sourceConnectionString = await createTempDatabase();
      const backupDir = createTempDir("wardmote-db-backup-retention-");
      const realDateNow = Date.now;
      Date.now = () => Date.UTC(2026, 2, 31, 12, 0, 0);

      const janNewest = path.join(backupDir, "wardmote-test-2026-01-28T12-00-00.sql.gz");
      const janOlder = path.join(backupDir, "wardmote-test-2026-01-10T12-00-00.sql.gz");
      const decOld = path.join(backupDir, "wardmote-test-2025-12-15T12-00-00.sql.gz");

      try {
        fs.writeFileSync(janNewest, "jan-newest");
        fs.writeFileSync(janOlder, "jan-older");
        fs.writeFileSync(decOld, "dec-old");

        fs.utimesSync(janNewest, new Date("2026-01-28T12:00:00Z"), new Date("2026-01-28T12:00:00Z"));
        fs.utimesSync(janOlder, new Date("2026-01-10T12:00:00Z"), new Date("2026-01-10T12:00:00Z"));
        fs.utimesSync(decOld, new Date("2025-12-15T12:00:00Z"), new Date("2025-12-15T12:00:00Z"));

        const result = await runDatabaseBackup({
          connectionString: sourceConnectionString,
          backupDir,
          retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 2 },
          filenamePrefix: "wardmote-test",
        });

        expect(result.prunedCount).toBe(2);
        expect(fs.existsSync(janNewest)).toBe(true);
        expect(fs.existsSync(janOlder)).toBe(false);
        expect(fs.existsSync(decOld)).toBe(false);
      } finally {
        Date.now = realDateNow;
      }
    },
    30_000,
  );

  it(
    "backs up and restores large table payloads without materializing one giant string",
    async () => {
      const sourceConnectionString = await createTempDatabase();
      const restoreConnectionString = await createSiblingDatabase(
        sourceConnectionString,
        "wardmote_restore_target",
      );
      const backupDir = createTempDir("wardmote-db-backup-output-");
      const sourceSql = postgres(sourceConnectionString, { max: 1, onnotice: () => {} });
      const restoreSql = postgres(restoreConnectionString, { max: 1, onnotice: () => {} });

      try {
        await sourceSql.unsafe(`
          CREATE TYPE "public"."backup_test_state" AS ENUM ('pending', 'done');
        `);
        await sourceSql.unsafe(`
          CREATE TABLE "public"."backup_test_records" (
            "id" serial PRIMARY KEY,
            "title" text NOT NULL,
            "payload" text NOT NULL,
            "state" "public"."backup_test_state" NOT NULL,
            "metadata" jsonb,
            "created_at" timestamptz NOT NULL DEFAULT now()
          );
        `);
        await sourceSql.unsafe(`
          CREATE FUNCTION "public"."backup_test_mark_done"()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            NEW."state" := 'done';
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER "backup_test_mark_done_trigger"
          BEFORE UPDATE OF "title" ON "public"."backup_test_records"
          FOR EACH ROW
          EXECUTE FUNCTION "public"."backup_test_mark_done"();
        `);

        const payload = "x".repeat(8192);
        for (let index = 0; index < 160; index += 1) {
          const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index));
          await sourceSql`
            INSERT INTO "public"."backup_test_records" (
              "title",
              "payload",
              "state",
              "metadata",
              "created_at"
            )
            VALUES (
              ${`row-${index}`},
              ${payload},
              ${index % 2 === 0 ? "pending" : "done"}::"public"."backup_test_state",
              ${JSON.stringify({ index, even: index % 2 === 0 })}::jsonb,
              ${createdAt}
            )
          `;
        }

        const result = await runDatabaseBackup({
          connectionString: sourceConnectionString,
          backupDir,
          retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
          filenamePrefix: "wardmote-test",
          backupEngine: "javascript",
        });

        expect(result.backupFile).toMatch(/wardmote-test-.*\.sql\.gz$/);
        expect(result.sizeBytes).toBeGreaterThan(0);
        expect(fs.existsSync(result.backupFile)).toBe(true);

        await runDatabaseRestore({
          connectionString: restoreConnectionString,
          backupFile: result.backupFile,
        });

        const counts = await restoreSql.unsafe<{ count: number }[]>(`
          SELECT count(*)::int AS count
          FROM "public"."backup_test_records"
        `);
        expect(counts[0]?.count).toBe(160);

        const sampleRows = await restoreSql.unsafe<{
          title: string;
          payload: string;
          state: string;
          metadata: { index: number; even: boolean } | string;
        }[]>(`
          SELECT "title", "payload", "state"::text AS "state", "metadata"
          FROM "public"."backup_test_records"
          WHERE "title" IN ('row-0', 'row-159')
          ORDER BY "title"
        `);
        expect(sampleRows.map((row) => ({
          ...row,
          metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
        }))).toEqual([
          {
            title: "row-0",
            payload,
            state: "pending",
            metadata: { index: 0, even: true },
          },
          {
            title: "row-159",
            payload,
            state: "done",
            metadata: { index: 159, even: false },
          },
        ]);

        await restoreSql.unsafe(`
          UPDATE "public"."backup_test_records"
          SET "title" = 'triggered'
          WHERE "title" = 'row-0'
        `);
        const triggeredRows = await restoreSql.unsafe<{ state: string }[]>(`
          SELECT "state"::text AS "state"
          FROM "public"."backup_test_records"
          WHERE "title" = 'triggered'
        `);
        expect(triggeredRows).toEqual([{ state: "done" }]);
      } finally {
        await sourceSql.end();
        await restoreSql.end();
      }
    },
    60_000,
  );

  it(
    "backs up and restores non-public database schemas and migration history",
    async () => {
      const sourceConnectionString = await createTempDatabase();
      const restoreConnectionString = await createSiblingDatabase(
        sourceConnectionString,
        "wardmote_full_logical_restore_target",
      );
      const backupDir = createTempDir("wardmote-db-full-logical-backup-");
      const sourceSql = postgres(sourceConnectionString, { max: 1, onnotice: () => {} });
      const restoreSql = postgres(restoreConnectionString, { max: 1, onnotice: () => {} });

      try {
        await sourceSql.unsafe(`
          CREATE SCHEMA IF NOT EXISTS "drizzle";
          CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
            "id" serial PRIMARY KEY,
            "hash" text NOT NULL,
            "created_at" bigint
          );
          INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
          VALUES ('wardmote-migration-history', 1770000000000);
        `);
        await sourceSql.unsafe(`
          CREATE TABLE "public"."backup_parent_records" (
            "id" uuid PRIMARY KEY,
            "name" text NOT NULL
          );
          INSERT INTO "public"."backup_parent_records" ("id", "name")
          VALUES ('11111111-1111-4111-8111-111111111111', 'parent');
        `);
        await sourceSql.unsafe(`
          CREATE TABLE "public"."plugin_rows" (
            "id" serial PRIMARY KEY,
            "note" text NOT NULL
          );
          CREATE TABLE "public"."audit_rows" (
            "id" serial PRIMARY KEY,
            "secret_note" text
          );
          INSERT INTO "public"."plugin_rows" ("note")
          VALUES ('public-collision');
          INSERT INTO "public"."audit_rows" ("secret_note")
          VALUES ('public-secret');
        `);
        await sourceSql.unsafe(`
          CREATE SCHEMA "plugin_backup_scope";
          CREATE TYPE "plugin_backup_scope"."plugin_status" AS ENUM ('ready', 'done');
          CREATE TABLE "plugin_backup_scope"."plugin_rows" (
            "id" serial PRIMARY KEY,
            "parent_id" uuid NOT NULL REFERENCES "public"."backup_parent_records"("id") ON DELETE CASCADE,
            "status" "plugin_backup_scope"."plugin_status" NOT NULL,
            "note" text NOT NULL
          );
          CREATE TABLE "plugin_backup_scope"."audit_rows" (
            "id" serial PRIMARY KEY,
            "secret_note" text
          );
          CREATE UNIQUE INDEX "plugin_rows_note_uq" ON "plugin_backup_scope"."plugin_rows" ("note");
          INSERT INTO "plugin_backup_scope"."plugin_rows" ("parent_id", "status", "note")
            VALUES ('11111111-1111-4111-8111-111111111111', 'ready', 'first');
          INSERT INTO "plugin_backup_scope"."audit_rows" ("secret_note")
          VALUES ('plugin-secret');
        `);

        const result = await runDatabaseBackup({
          connectionString: sourceConnectionString,
          backupDir,
          retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
          filenamePrefix: "wardmote-full-logical-test",
          backupEngine: "javascript",
          excludeTables: ["plugin_rows"],
          nullifyColumns: {
            audit_rows: ["secret_note"],
          },
        });

        await runDatabaseRestore({
          connectionString: restoreConnectionString,
          backupFile: result.backupFile,
        });

        const migrationRows = await restoreSql.unsafe<{ hash: string }[]>(`
          SELECT "hash"
          FROM "drizzle"."__drizzle_migrations"
          WHERE "hash" = 'wardmote-migration-history'
        `);
        expect(migrationRows).toEqual([{ hash: "wardmote-migration-history" }]);

        const pluginRows = await restoreSql.unsafe<{ note: string; status: string; parent_name: string }[]>(`
          SELECT r."note", r."status"::text AS "status", p."name" AS "parent_name"
          FROM "plugin_backup_scope"."plugin_rows" r
          JOIN "public"."backup_parent_records" p ON p."id" = r."parent_id"
        `);
        expect(pluginRows).toEqual([{ note: "first", status: "ready", parent_name: "parent" }]);

        const publicCollisionRows = await restoreSql.unsafe<{ count: number }[]>(`
          SELECT count(*)::int AS count
          FROM "public"."plugin_rows"
        `);
        expect(publicCollisionRows[0]?.count).toBe(0);

        const publicAuditRows = await restoreSql.unsafe<{ secret_note: string | null }[]>(`
          SELECT "secret_note"
          FROM "public"."audit_rows"
        `);
        expect(publicAuditRows).toEqual([{ secret_note: null }]);

        const pluginAuditRows = await restoreSql.unsafe<{ secret_note: string | null }[]>(`
          SELECT "secret_note"
          FROM "plugin_backup_scope"."audit_rows"
        `);
        expect(pluginAuditRows).toEqual([{ secret_note: "plugin-secret" }]);

        await expect(
          restoreSql.unsafe(`
            INSERT INTO "plugin_backup_scope"."plugin_rows" ("parent_id", "status", "note")
            VALUES ('11111111-1111-4111-8111-111111111111', 'done', 'first')
          `),
        ).rejects.toThrow();
      } finally {
        await sourceSql.end();
        await restoreSql.end();
      }
    },
    60_000,
  );

  it(
    "preserves composite foreign key column order without duplicate referenced columns",
    async () => {
      const sourceConnectionString = await createTempDatabase();
      const restoreConnectionString = await createSiblingDatabase(
        sourceConnectionString,
        "wardmote_composite_fk_restore_target",
      );
      const backupDir = createTempDir("wardmote-db-composite-fk-backup-");
      const sourceSql = postgres(sourceConnectionString, { max: 1, onnotice: () => {} });
      const restoreSql = postgres(restoreConnectionString, { max: 1, onnotice: () => {} });

      try {
        await sourceSql.unsafe(`
          CREATE SCHEMA "plugin_composite_fk";
          CREATE TABLE "plugin_composite_fk"."content_cases" (
            "id" uuid PRIMARY KEY,
            "company_id" uuid NOT NULL,
            "title" text NOT NULL,
            CONSTRAINT "content_cases_company_case_unique" UNIQUE ("company_id", "id")
          );
          CREATE TABLE "plugin_composite_fk"."content_case_signals" (
            "company_id" uuid NOT NULL,
            "case_id" uuid NOT NULL,
            "signal" text NOT NULL,
            "scopes" text[] NOT NULL,
            "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
            CONSTRAINT "content_case_signals_company_case"
              FOREIGN KEY ("company_id", "case_id")
              REFERENCES "plugin_composite_fk"."content_cases" ("company_id", "id")
              ON DELETE CASCADE
          );
          INSERT INTO "plugin_composite_fk"."content_cases" ("company_id", "id", "title")
          VALUES (
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'case'
          );
          INSERT INTO "plugin_composite_fk"."content_case_signals" ("company_id", "case_id", "signal", "scopes", "warnings")
          VALUES (
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'signal',
            ARRAY['upstream_import:preview', 'scope with space', 'quoted "scope"', 'NULL', 'null'],
            jsonb_build_array('json warning', jsonb_build_object('code', 'quoted "value"'))
          );
        `);

        const result = await runDatabaseBackup({
          connectionString: sourceConnectionString,
          backupDir,
          retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
          filenamePrefix: "wardmote-composite-fk-test",
          backupEngine: "javascript",
        });

        await runDatabaseRestore({
          connectionString: restoreConnectionString,
          backupFile: result.backupFile,
        });

        const rows = await restoreSql.unsafe<{
          signal: string;
          title: string;
          scopes: string[];
          warnings: Array<string | { code: string }>;
        }[]>(`
          SELECT s."signal", c."title", s."scopes", s."warnings"
          FROM "plugin_composite_fk"."content_case_signals" s
          JOIN "plugin_composite_fk"."content_cases" c
            ON c."company_id" = s."company_id"
           AND c."id" = s."case_id"
        `);
        expect(rows).toEqual([
          {
            signal: "signal",
            title: "case",
            scopes: ["upstream_import:preview", "scope with space", 'quoted "scope"', "NULL", "null"],
            warnings: ["json warning", { code: 'quoted "value"' }],
          },
        ]);

        await expect(
          restoreSql.unsafe(`
            INSERT INTO "plugin_composite_fk"."content_case_signals" ("company_id", "case_id", "signal", "scopes")
            VALUES (
              '11111111-1111-4111-8111-111111111111',
              '33333333-3333-4333-8333-333333333333',
              'orphan',
              ARRAY[]::text[]
            )
          `),
        ).rejects.toThrow();
      } finally {
        await sourceSql.end();
        await restoreSql.end();
      }
    },
    60_000,
  );

  it(
    "restores fallback COPY data when child tables are dumped before parent tables",
    async () => {
      const sourceConnectionString = await createTempDatabase();
      const restoreConnectionString = await createSiblingDatabase(
        sourceConnectionString,
        "wardmote_copy_fk_restore_target",
      );
      const backupDir = createTempDir("wardmote-db-copy-fk-backup-");
      const sourceSql = postgres(sourceConnectionString, { max: 1, onnotice: () => {} });
      const restoreSql = postgres(restoreConnectionString, { max: 1, onnotice: () => {} });
      const originalPgDumpPath = process.env.WARDMOTE_PG_DUMP_PATH;
      const originalPsqlPath = process.env.WARDMOTE_PSQL_PATH;
      process.env.WARDMOTE_PG_DUMP_PATH = "/bin/false";
      process.env.WARDMOTE_PSQL_PATH = "/bin/false";

      try {
        await sourceSql.unsafe(`
          CREATE TABLE "public"."zzz_parent_records" (
            "id" uuid PRIMARY KEY,
            "name" text NOT NULL
          );
          CREATE TABLE "public"."aaa_child_records" (
            "id" uuid PRIMARY KEY,
            "parent_id" uuid NOT NULL REFERENCES "public"."zzz_parent_records"("id") ON DELETE CASCADE,
            "note" text NOT NULL
          );
          INSERT INTO "public"."zzz_parent_records" ("id", "name")
          VALUES ('11111111-1111-4111-8111-111111111111', 'parent');
          INSERT INTO "public"."aaa_child_records" ("id", "parent_id", "note")
          VALUES (
            '22222222-2222-4222-8222-222222222222',
            '11111111-1111-4111-8111-111111111111',
            'child emitted before parent'
          );
        `);

        const result = await runDatabaseBackup({
          connectionString: sourceConnectionString,
          backupDir,
          retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
          filenamePrefix: "wardmote-copy-fk-test",
          backupEngine: "auto",
        });

        const backupSql = gunzipSync(await fs.promises.readFile(result.backupFile)).toString("utf8");
        expect(backupSql.indexOf("-- Data for: public.aaa_child_records")).toBeGreaterThan(-1);
        expect(backupSql.indexOf("-- Data for: public.aaa_child_records")).toBeLessThan(
          backupSql.indexOf("-- Data for: public.zzz_parent_records"),
        );
        expect(backupSql).not.toContain(" FROM stdin;");

        await runDatabaseRestore({
          connectionString: restoreConnectionString,
          backupFile: result.backupFile,
        });

        const rows = await restoreSql.unsafe<{ note: string; name: string }[]>(`
          SELECT child."note", parent."name"
          FROM "public"."aaa_child_records" child
          JOIN "public"."zzz_parent_records" parent ON parent."id" = child."parent_id"
        `);
        expect(rows).toEqual([{ note: "child emitted before parent", name: "parent" }]);
      } finally {
        if (originalPgDumpPath === undefined) {
          delete process.env.WARDMOTE_PG_DUMP_PATH;
        } else {
          process.env.WARDMOTE_PG_DUMP_PATH = originalPgDumpPath;
        }
        if (originalPsqlPath === undefined) {
          delete process.env.WARDMOTE_PSQL_PATH;
        } else {
          process.env.WARDMOTE_PSQL_PATH = originalPsqlPath;
        }
        await sourceSql.end();
        await restoreSql.end();
      }
    },
    60_000,
  );

  it(
    "restores legacy public-only backups without migration history",
    async () => {
      const restoreConnectionString = await createTempDatabase();
      const restoreSql = postgres(restoreConnectionString, { max: 1, onnotice: () => {} });
      const backupDir = createTempDir("wardmote-db-restore-manual-");
      const backupFile = path.join(backupDir, "manual.sql");

      try {
        await fs.promises.writeFile(
          backupFile,
          [
            "-- Wardmote database backup",
            "-- Created: 2026-04-06T00:00:00.000Z",
            "",
            "BEGIN;",
            RETIRED_STATEMENT_BREAKPOINT,
            "CREATE TABLE public.restore_stream_test (id integer primary key, payload text not null);",
            RETIRED_STATEMENT_BREAKPOINT,
            "INSERT INTO public.restore_stream_test (id, payload)",
            "VALUES (1, 'hello');",
            RETIRED_STATEMENT_BREAKPOINT,
            "COMMIT;",
            RETIRED_STATEMENT_BREAKPOINT,
          ].join("\n"),
          "utf8",
        );

        const previousPsql = process.env.WARDMOTE_PSQL_PATH;
        process.env.WARDMOTE_PSQL_PATH = path.join(backupDir, "missing-psql");
        try {
          await runDatabaseRestore({
            connectionString: restoreConnectionString,
            backupFile,
          });
        } finally {
          if (previousPsql === undefined) delete process.env.WARDMOTE_PSQL_PATH;
          else process.env.WARDMOTE_PSQL_PATH = previousPsql;
        }

        const rows = await restoreSql.unsafe<{ payload: string }[]>(`
          SELECT payload
          FROM public.restore_stream_test
        `);
        expect(rows).toEqual([{ payload: "hello" }]);
      } finally {
        await restoreSql.end();
      }
    },
    20_000,
  );
});

describeEmbeddedPostgres("runDatabaseBackup rotation and disk guard", () => {
  const retention = { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1, maxFiles: 2 } as const;

  async function withFixturePgDump<T>(backupDir: string, run: () => Promise<T>): Promise<T> {
    const executable = path.join(path.dirname(backupDir), `pg-dump-fixture-${path.basename(backupDir)}`);
    fs.writeFileSync(executable, "#!/bin/sh\nprintf 'SELECT 1;\\n'\n", { mode: 0o700 });
    cleanups.push(() => fs.rmSync(executable, { force: true }));
    const previous = process.env.WARDMOTE_PG_DUMP_PATH;
    process.env.WARDMOTE_PG_DUMP_PATH = executable;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env.WARDMOTE_PG_DUMP_PATH;
      else process.env.WARDMOTE_PG_DUMP_PATH = previous;
    }
  }

  function seed(backupDir: string, name: string, bytes: Buffer, hoursAgo: number): string {
    const file = path.join(backupDir, name);
    fs.writeFileSync(file, bytes);
    const at = new Date(Date.now() - hoursAgo * 3_600_000);
    fs.utimesSync(file, at, at);
    return file;
  }

  function rotated(backupDir: string): string[] {
    return fs.readdirSync(backupDir).filter((name) => name.endsWith(".sql.gz")).sort();
  }

  const waitNextSecond = () => new Promise((resolveWait) => setTimeout(resolveWait, 1_100));

  it("keeps exactly maxFiles valid backups and drops corrupt and empty ones", async () => {
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("rotation-max-files-");
    seed(backupDir, "wardmote-20260101-030000.sql.gz", gzipSync("SELECT 'truncated';").subarray(0, 12), 1);
    seed(backupDir, "wardmote-20260101-020000.sql.gz", Buffer.alloc(0), 2);
    seed(backupDir, "wardmote-20260101-010000.sql.gz", gzipSync("SELECT 'last valid';"), 3);
    seed(backupDir, "wardmote-20260101-000000.sql.gz", gzipSync("SELECT 'oldest';"), 4);

    const result = await withFixturePgDump(backupDir, () =>
      runDatabaseBackup({ connectionString, backupDir, retention }));

    expect(rotated(backupDir)).toEqual(["wardmote-20260101-010000.sql.gz", path.basename(result.backupFile)].sort());
    expect(result.prunedCount).toBe(3);
    expect(gunzipSync(fs.readFileSync(result.backupFile)).toString()).toBe("SELECT 1;\n");
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("keeps a backup it cannot read instead of treating it as corrupt", async () => {
    if (process.getuid?.() === 0) return;
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("rotation-unreadable-");
    const unreadable = seed(backupDir, "wardmote-20260101-020000.sql.gz", gzipSync("SELECT 'unreadable';"), 1);
    fs.chmodSync(unreadable, 0o000);
    cleanups.push(() => fs.chmodSync(unreadable, 0o600));
    seed(backupDir, "wardmote-20260101-010000.sql.gz", gzipSync("SELECT 'valid';"), 2);
    seed(backupDir, "wardmote-20260101-000000.sql.gz", gzipSync("SELECT 'oldest';"), 3);

    const result = await withFixturePgDump(backupDir, () =>
      runDatabaseBackup({ connectionString, backupDir, retention }));

    expect(rotated(backupDir)).toEqual(
      ["wardmote-20260101-010000.sql.gz", "wardmote-20260101-020000.sql.gz", path.basename(result.backupFile)].sort(),
    );
    expect(result.unreadableBackups).toEqual([unreadable]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("skips the backup and keeps the last valid backup when space is short", async () => {
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("rotation-low-disk-");
    const last = seed(backupDir, "wardmote-20260101-000000.sql.gz", gzipSync("SELECT 'last';"), 1);
    const lastBytes = fs.readFileSync(last);

    const attempt = withFixturePgDump(backupDir, () =>
      runDatabaseBackup({
        connectionString,
        backupDir,
        retention,
        spaceGuard: { reservePercent: 5, reserveBytes: 0, statfs: () => ({ freeBytes: 1_000, totalBytes: 100_000 }) },
      }));

    await expect(attempt).rejects.toBeInstanceOf(DatabaseBackupSkippedError);
    expect(rotated(backupDir)).toEqual(["wardmote-20260101-000000.sql.gz"]);
    expect(fs.readFileSync(last)).toEqual(lastBytes);
    expect(fs.readdirSync(backupDir).some((name) => name.endsWith(".partial"))).toBe(false);
    const marker = JSON.parse(fs.readFileSync(path.join(backupDir, DATABASE_BACKUP_SKIPPED_MARKER), "utf8"));
    expect(marker).toMatchObject({ freeBytes: 1_000, requiredBytes: 5_000 + Math.ceil(lastBytes.length * 1.5) });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("frees the oldest backup only when that makes room, then clears the skip marker", async () => {
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("rotation-make-room-");
    const oldest = seed(backupDir, "wardmote-20260101-000000.sql.gz", gzipSync("x".repeat(4_000)), 2);
    seed(backupDir, "wardmote-20260101-010000.sql.gz", gzipSync("SELECT 'newest';"), 1);
    fs.writeFileSync(path.join(backupDir, DATABASE_BACKUP_SKIPPED_MARKER), "{}");
    const newestSize = fs.statSync(path.join(backupDir, "wardmote-20260101-010000.sql.gz")).size;
    const freeBytes = Math.ceil(newestSize * 1.5) - fs.statSync(oldest).size;

    const result = await withFixturePgDump(backupDir, () =>
      runDatabaseBackup({
        connectionString,
        backupDir,
        retention,
        spaceGuard: { reservePercent: 0, reserveBytes: 0, statfs: () => ({ freeBytes, totalBytes: 10_000_000 }) },
      }));

    expect(rotated(backupDir)).toEqual(["wardmote-20260101-010000.sql.gz", path.basename(result.backupFile)].sort());
    expect(fs.existsSync(path.join(backupDir, DATABASE_BACKUP_SKIPPED_MARKER))).toBe(false);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("keeps pinned backups outside rotation and expires them only by age", async () => {
    const connectionString = await createTempDatabase();
    const backupDir = createTempDir("rotation-pinned-");
    const pinnedDir = path.join(backupDir, "pinned");
    fs.mkdirSync(pinnedDir);
    const expired = seed(pinnedDir, "wardmote-20250101-000000.sql.gz", gzipSync("SELECT 'expired';"), 24 * 40);

    const pinned = await withFixturePgDump(backupDir, () =>
      runDatabaseBackup({ connectionString, backupDir, retention, pinned: true }));
    expect(path.dirname(pinned.backupFile)).toBe(pinnedDir);
    expect(fs.existsSync(expired)).toBe(true);

    for (let index = 0; index < 3; index += 1) {
      await waitNextSecond();
      await withFixturePgDump(backupDir, () =>
        runDatabaseBackup({ connectionString, backupDir, retention, pinnedMaxAgeDays: 30 }));
    }

    expect(rotated(backupDir)).toHaveLength(2);
    expect(fs.existsSync(pinned.backupFile)).toBe(true);
    expect(fs.existsSync(expired)).toBe(false);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});

