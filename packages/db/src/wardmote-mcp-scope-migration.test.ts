import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations } from "./client.js";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0368_wardmote_mcp_scopes.sql";
const OLD = "paperclip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote MCP scope migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames stored OAuth scopes and event names and keeps other values", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-mcp-scope-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const userId = "user-1";
    const clientId = "client-1";
    const grantId = randomUUID();
    const subscriptionId = "sub-1";
    const otherSubscriptionId = "sub-2";
    const scopes = (prefix: string) => [`${prefix}:read`, `${prefix}:write`, "offline_access", `${prefix}:configure`];
    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Scopes', 'SCO')`;
    await sql`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES (${userId}, 'U', 'u@example.com', true, now(), now())`;
    const taskId = randomUUID();
    await sql`INSERT INTO "issues" ("id", "company_id", "title", "identifier") VALUES (${taskId}, ${companyId}, 'Task', 'SCO-1')`;
    await sql`INSERT INTO "mcp_oauth_clients" ("id", "name", "redirect_uris") VALUES (${clientId}, 'Client', ${sql.json(["https://client.example/cb"])})`;
    await sql`
      INSERT INTO "mcp_oauth_grants" ("id", "company_id", "user_id", "client_id", "resource", "scopes")
      VALUES (${grantId}, ${companyId}, ${userId}, ${clientId}, 'https://wardmote.example/mcp', ${sql.json(scopes(OLD))})
    `;
    await sql`
      INSERT INTO "mcp_oauth_requests" ("id", "client_id", "redirect_uri", "resource", "scopes", "challenge", "expires_at")
      VALUES ('request-1', ${clientId}, 'https://client.example/cb', 'https://wardmote.example/mcp', ${sql.json([`${OLD}:agent`, "offline_access"])}, 'c', now() + interval '1 hour')
    `;
    await sql`
      INSERT INTO "mcp_oauth_device_requests" ("client_id", "device_code_hash", "user_code_hash", "resource", "scopes", "source_hash", "expires_at")
      VALUES (${clientId}, 'd', 'u', 'https://wardmote.example/mcp', ${sql.json([`${OLD}:read`, "custom:scope"])}, 's', now() + interval '1 hour')
    `;
    await sql`
      INSERT INTO "mcp_event_subscriptions" ("id", "company_id", "grant_id", "name", "task_id", "arguments", "delivery_material", "verified_at", "expires_at")
      VALUES
        (${subscriptionId}, ${companyId}, ${grantId}, ${`${OLD}.task.status_changed`}, ${taskId}, ${sql.json({ companyId })}, ${sql.json({})}, now(), now() + interval '1 day'),
        (${otherSubscriptionId}, ${companyId}, ${grantId}, 'custom.event', ${taskId}, ${sql.json({ companyId })}, ${sql.json({})}, now(), now() + interval '1 day')
    `;
    await sql`
      INSERT INTO "mcp_event_deliveries" ("subscription_id", "activity_id", "event")
      VALUES
        (${subscriptionId}, ${randomUUID()}, ${sql.json({ eventId: "e1", name: `${OLD}.task.status_changed`, data: { companyId } })}),
        (${subscriptionId}, ${randomUUID()}, ${sql.json({})})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const [grant] = await sql<{ scopes: string[] }[]>`SELECT "scopes" FROM "mcp_oauth_grants" WHERE "id" = ${grantId}`;
    expect(grant!.scopes).toEqual(scopes("wardmote"));
    const [request] = await sql<{ scopes: string[] }[]>`SELECT "scopes" FROM "mcp_oauth_requests"`;
    expect(request!.scopes).toEqual(["wardmote:agent", "offline_access"]);
    const [device] = await sql<{ scopes: string[] }[]>`SELECT "scopes" FROM "mcp_oauth_device_requests"`;
    expect(device!.scopes).toEqual(["wardmote:read", "custom:scope"]);
    const subscriptions = await sql<{ id: string; name: string }[]>`SELECT "id", "name" FROM "mcp_event_subscriptions" ORDER BY "id"`;
    expect(subscriptions).toEqual([
      { id: subscriptionId, name: "wardmote.task.status_changed" },
      { id: otherSubscriptionId, name: "custom.event" },
    ]);
    const deliveries = await sql<{ event: Record<string, unknown> }[]>`SELECT "event" FROM "mcp_event_deliveries" ORDER BY "event" ? 'name' DESC`;
    expect(deliveries.map((row) => row.event)).toEqual([
      { eventId: "e1", name: "wardmote.task.status_changed", data: { companyId } },
      {},
    ]);

    const snapshot = async () => ({
      grants: await sql`SELECT "id", "scopes" FROM "mcp_oauth_grants" ORDER BY "id"`,
      requests: await sql`SELECT "id", "scopes" FROM "mcp_oauth_requests" ORDER BY "id"`,
      devices: await sql`SELECT "id", "scopes" FROM "mcp_oauth_device_requests" ORDER BY "id"`,
      subscriptions: await sql`SELECT "id", "name" FROM "mcp_event_subscriptions" ORDER BY "id"`,
      deliveries: await sql`SELECT "id", "event" FROM "mcp_event_deliveries" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
