import { randomBytes } from "node:crypto";
import path from "node:path";
import postgres from "postgres";

export const EMBEDDED_POSTGRES_USER = "wardmote";
export const EMBEDDED_POSTGRES_PASSWORD = "wardmote";
export const EMBEDDED_POSTGRES_DATABASE = "wardmote";

const RETIRED_EMBEDDED_IDENTITY = "paperclip";
const MIGRATION_ROLE = "wardmote_identity_migration";
const AUTHENTICATION_FAILURES = new Set(["28P01", "28000"]);

export function embeddedPostgresUrl(port: number, database: string = EMBEDDED_POSTGRES_DATABASE): string {
  return `postgres://${EMBEDDED_POSTGRES_USER}:${EMBEDDED_POSTGRES_PASSWORD}@127.0.0.1:${port}/${database}`;
}

export function embeddedPostgresAdminUrl(port: number): string {
  return embeddedPostgresUrl(port, "postgres");
}

type Sql = ReturnType<typeof postgres>;

function connect(port: number, user: string, password: string): Sql {
  return postgres({ host: "127.0.0.1", port, database: "postgres", username: user, password, max: 1, onnotice: () => {} });
}

async function openAs(port: number, user: string, password: string): Promise<Sql | null> {
  const sql = connect(port, user, password);
  try {
    await sql`select 1`;
    return sql;
  } catch (error) {
    await sql.end();
    if (AUTHENTICATION_FAILURES.has((error as { code?: string }).code ?? "")) return null;
    throw error;
  }
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export type EmbeddedIdentityMigration = "current" | "migrated";

/** Renames the retired embedded role and database to the Wardmote names; idempotent and resumable. */
export async function migrateEmbeddedPostgresIdentity(input: { port: number; dataDir: string }): Promise<EmbeddedIdentityMigration> {
  const current = await openAs(input.port, EMBEDDED_POSTGRES_USER, EMBEDDED_POSTGRES_PASSWORD);
  const sql = current ?? await openAs(input.port, RETIRED_EMBEDDED_IDENTITY, RETIRED_EMBEDDED_IDENTITY);
  if (!sql) {
    throw new Error(`Embedded PostgreSQL on port ${input.port} accepts neither the ${EMBEDDED_POSTGRES_USER} nor the ${RETIRED_EMBEDDED_IDENTITY} login.`);
  }
  let changed = false;
  try {
    const [{ data_directory: actualDataDir }] = await sql<{ data_directory: string }[]>`select current_setting('data_directory') as data_directory`;
    if (path.resolve(actualDataDir) !== path.resolve(input.dataDir)) {
      throw new Error(`Refusing to migrate PostgreSQL on port ${input.port}: its data directory is not ${input.dataDir}.`);
    }
    const databases = new Set((await sql<{ datname: string }[]>`
      select datname from pg_database where datname in (${RETIRED_EMBEDDED_IDENTITY}, ${EMBEDDED_POSTGRES_DATABASE})
    `).map((row) => row.datname));
    if (databases.has(RETIRED_EMBEDDED_IDENTITY)) {
      if (databases.has(EMBEDDED_POSTGRES_DATABASE)) {
        throw new Error(`Embedded PostgreSQL holds both the ${RETIRED_EMBEDDED_IDENTITY} and the ${EMBEDDED_POSTGRES_DATABASE} database; keep one and rerun.`);
      }
      const [{ sessions }] = await sql<{ sessions: number }[]>`
        select count(*)::int as sessions from pg_stat_activity where datname = ${RETIRED_EMBEDDED_IDENTITY}
      `;
      if (sessions > 0) {
        throw new Error(`Stop every process using the ${RETIRED_EMBEDDED_IDENTITY} database before upgrading; ${sessions} session(s) are connected.`);
      }
      await sql.unsafe(`alter database ${quote(RETIRED_EMBEDDED_IDENTITY)} rename to ${quote(EMBEDDED_POSTGRES_DATABASE)}`);
      changed = true;
    }
    if (!current) {
      const migrationPassword = randomBytes(24).toString("hex");
      await sql.unsafe(`drop role if exists ${quote(MIGRATION_ROLE)}`);
      await sql.unsafe(`create role ${quote(MIGRATION_ROLE)} superuser login password '${migrationPassword}'`);
      await sql.end();
      const migrator = connect(input.port, MIGRATION_ROLE, migrationPassword);
      try {
        await migrator.unsafe(`alter role ${quote(RETIRED_EMBEDDED_IDENTITY)} rename to ${quote(EMBEDDED_POSTGRES_USER)}`);
        await migrator.unsafe(`alter role ${quote(EMBEDDED_POSTGRES_USER)} password '${EMBEDDED_POSTGRES_PASSWORD}'`);
      } finally {
        await migrator.end();
      }
      changed = true;
    }
  } finally {
    await sql.end();
  }
  const owner = connect(input.port, EMBEDDED_POSTGRES_USER, EMBEDDED_POSTGRES_PASSWORD);
  try {
    const [{ leftover }] = await owner<{ leftover: number }[]>`select count(*)::int as leftover from pg_roles where rolname = ${MIGRATION_ROLE}`;
    if (leftover > 0) {
      await owner.unsafe(`drop role ${quote(MIGRATION_ROLE)}`);
      changed = true;
    }
  } finally {
    await owner.end();
  }
  return changed ? "migrated" : "current";
}
