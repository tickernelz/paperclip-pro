import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedPostgresAdminUrl, embeddedPostgresUrl, migrateEmbeddedPostgresIdentity } from "./embedded-identity.js";
import { prepareEmbeddedPostgresNativeRuntime } from "./embedded-postgres-native.js";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport } from "./test-embedded-postgres.js";

const RETIRED = "paperclip";
const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

function retiredUrl(port: number, database: string): string {
  return `postgres://${RETIRED}:${RETIRED}@127.0.0.1:${port}/${database}`;
}

async function query<T extends Record<string, unknown>>(url: string, text: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await sql.unsafe<T[]>(text);
  } finally {
    await sql.end();
  }
}

describeEmbeddedPostgres("migrateEmbeddedPostgresIdentity", () => {
  let dataDir: string;
  let port: number;
  let instance: { start(): Promise<void>; stop(): Promise<void>; initialise(): Promise<void> };

  beforeAll(async () => {
    await prepareEmbeddedPostgresNativeRuntime();
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wardmote-identity-"));
    port = await freePort();
    instance = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: RETIRED,
      password: RETIRED,
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
      onLog: () => {},
      onError: () => {},
    });
    await instance.initialise();
    await instance.start();
    await query(retiredUrl(port, "postgres"), `create database "${RETIRED}"`);
    await query(retiredUrl(port, RETIRED), "create table notes (id int primary key, body text); insert into notes values (1, 'a'), (2, 'b'), (3, 'c')");
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await instance?.stop().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("refuses a different data directory and a database still in use, changing nothing", async () => {
    await expect(migrateEmbeddedPostgresIdentity({ port, dataDir: path.join(dataDir, "other") })).rejects.toThrow("data directory");
    const session = postgres(retiredUrl(port, RETIRED), { max: 1 });
    try {
      await session`select 1`;
      await expect(migrateEmbeddedPostgresIdentity({ port, dataDir })).rejects.toThrow("1 session(s) are connected");
    } finally {
      await session.end();
    }
    const roles = await query<{ rolname: string }>(retiredUrl(port, "postgres"), "select rolname from pg_roles where rolname not like 'pg\\_%' order by rolname");
    expect(roles.map((row) => row.rolname)).toEqual([RETIRED]);
    const [{ count }] = await query<{ count: number }>(retiredUrl(port, RETIRED), "select count(*)::int as count from notes");
    expect(count).toBe(3);
  });

  it("renames the role and database, keeps the data, and is a no-op afterwards", async () => {
    await expect(migrateEmbeddedPostgresIdentity({ port, dataDir })).resolves.toBe("migrated");
    const [{ count, owner }] = await query<{ count: number; owner: string }>(
      embeddedPostgresUrl(port),
      "select (select count(*)::int from notes) as count, (select pg_get_userbyid(datdba) from pg_database where datname = current_database()) as owner",
    );
    expect(count).toBe(3);
    expect(owner).toBe("wardmote");
    const roles = await query<{ rolname: string }>(embeddedPostgresAdminUrl(port), "select rolname from pg_roles where rolname not like 'pg\\_%' order by rolname");
    expect(roles.map((row) => row.rolname)).toEqual(["wardmote"]);
    const databases = await query<{ datname: string }>(embeddedPostgresAdminUrl(port), "select datname from pg_database where not datistemplate order by datname");
    expect(databases.map((row) => row.datname)).toEqual(["postgres", "wardmote"]);
    await expect(query(retiredUrl(port, "postgres"), "select 1")).rejects.toMatchObject({ code: "28P01" });
    await expect(migrateEmbeddedPostgresIdentity({ port, dataDir })).resolves.toBe("current");
  });
});
