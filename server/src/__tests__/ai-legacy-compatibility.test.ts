import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { createDb, companies, agents, companyMemberships, environments, connectionGrants, toolConnections, activityLog, companySecrets } from "@tickernelz/wardmote-db";
import { startEmbeddedPostgresTestDatabase } from "@tickernelz/wardmote-db/test-embedded-postgres";
import { secretService } from "../services/secrets.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { prepareManagedAiRuntime, managedAiSessionFingerprintConfig } from "../services/ai-connection-runtime.js";


let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
const companyId = randomUUID(), agentId = randomUUID(), owner = "audit-owner";
beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "ai-legacy-audit-"));
  vi.stubEnv("WARDMOTE_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("ai-legacy-audit-db-");
  db = createDb(database.connectionString);
  await db.insert(companies).values({ id: companyId, name: "Audit", issuePrefix: "AUD" });
  await db.insert(companyMemberships).values({ companyId, principalId: owner, principalType: "user", status: "active", membershipRole: "owner" });
  await db.insert(environments).values({ name: "Local audit", driver: "local" }).onConflictDoNothing();
  await db.insert(agents).values({ id: agentId, companyId, name: "Unadopted legacy agent", adapterType: "claude_local" });
}, 90000);
afterAll(async () => { await database?.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (home) await rm(home, { recursive: true, force: true }); });

it("reconnect detaches an indexed credential without changing unadopted legacy agents", async () => {
  const vault = secretService(db), service = aiConnectionService(db);
  const definition = await vault.createUserSecretDefinition(companyId, { key: "audit_legacy_claude", name: "Legacy key", provider: "local_encrypted" }, { userId: owner });
  const secret = await vault.createCurrentUserSecretValue(companyId, owner, { definitionId: definition.id, value: "fixture-original" }, { userId: owner });
  const legacyConfig = { env: { ANTHROPIC_API_KEY: { type: "user_secret_ref", key: definition.key, required: true } } };
  await db.update(agents).set({ adapterConfig: legacyConfig }).where(eq(agents.id, agentId));
  await vault.syncUserSecretDeclarationsForTarget(companyId, { targetType: "agent", targetId: agentId }, [{ definitionKey: definition.key, configPath: "env.ANTHROPIC_API_KEY", envKey: "ANTHROPIC_API_KEY", required: true }]);
  const migration = await readFile(new URL("../../../packages/db/src/migrations/0276_hard_mandroid.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration.slice(migration.indexOf("DO $$", migration.indexOf("-- Only declared")))));
  const connection = (await service.list(companyId, owner)).find(c => c.name === secret.name)!;
  const input = { companyId, agentId, responsibleUserId: owner, adapterType: "claude_local", binding: { provider: "anthropic", method: "api_key", mode: "delegated", connectionId: connection.id, grantId: connection.grantId } as const, config: {}, allowLegacyValidation: true };
  const before = await prepareManagedAiRuntime(db, input);
  await before.cleanup();
  const resolve = () => vault.resolveUserSecretValue(companyId, { definitionId: definition.id, responsibleUserId: owner, required: true, version: "latest" }, { companyId, responsibleUserId: owner, actorType: "system" });
  expect((await resolve())?.value).toBe("fixture-original");
  await service.save(companyId, owner, { provider: "anthropic", method: "api_key", name: connection.name, ownership: "personal", agentIds: [], allAgents: true, connectionId: connection.id, apiKey: "fixture-new-account" }, "fixture-new-account");
  expect((await resolve())?.value).toBe("fixture-original");
  const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, connection.grantId));
  expect(grant.credentialSecretRefs[0].secretId).not.toBe(secret.id);
  const [oldSecret] = await db.select().from(companySecrets).where(eq(companySecrets.id, secret.id));
  const [newSecret] = await db.select().from(companySecrets).where(eq(companySecrets.id, grant.credentialSecretRefs[0].secretId));
  expect(oldSecret.aiSessionEpoch).toBe(0);
  expect(newSecret.aiSessionEpoch).toBe(0);
  const after = await prepareManagedAiRuntime(db, input);
  try {
    expect(after.attribution.grantId).toBe(before.attribution.grantId);
    expect(after.sessionIdentity).not.toBe(before.sessionIdentity);
    expect(managedAiSessionFingerprintConfig(after.config, after.home)).not.toEqual(managedAiSessionFingerprintConfig(before.config, before.home));
  } finally { await after.cleanup(); }
  const selected = await service.select({ companyId, agentId, userId: owner, adapterType: "claude_local", binding: { provider: "anthropic", method: "api_key", mode: "responsible_user" } });
  expect(await service.credential(selected)).toBe("fixture-new-account");
  await service.save(companyId, owner, { provider: "anthropic", method: "api_key", name: connection.name, ownership: "personal", agentIds: [], allAgents: true, connectionId: connection.id, apiKey: "fixture-second" }, "fixture-second");
  expect((await resolve())?.value).toBe("fixture-original");
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  expect(agent.runtimeConfig.aiConnection).toBeUndefined();
  expect(agent.adapterConfig).toEqual(legacyConfig);
});

const intent = { provider: "openai", method: "subscription", name: "Isolated Codex", ownership: "personal", agentIds: [], allAgents: true } as const;
const loginIntent = () => ({ ...intent, agentIds: [] });
const auth = (mark: string, hour = 10) => JSON.stringify({ tokens: { account_id: "fixture-account", id_token: `id-${mark}`, access_token: `access-${mark}`, refresh_token: `refresh-${mark}` }, last_refresh: `2026-09-10T${hour}:00:00Z` });

it("blocks preview-era copied subscriptions until isolated reconnect, leaving legacy config intact", async () => {
  const service = aiConnectionService(db);
  await service.save(companyId, owner, loginIntent(), auth("preview"));
  const account = (await service.list(companyId, owner)).find(c => c.provider === "openai")!;
  const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, account.id));
  await db.update(toolConnections).set({ config: { ...connection.config, aiIsolatedSubscription: false } }).where(eq(toolConnections.id, account.id));
  await expect(prepareManagedAiRuntime(db, {
    companyId, agentId, adapterType: "codex_local", responsibleUserId: owner,
    binding: { provider: "openai", method: "subscription", mode: "responsible_user" }, config: { cwd: home },
  })).rejects.toThrow("separate sign-in");
  expect((await service.list(companyId, owner)).find(c => c.id === account.id)?.status).toBe("needs_attention");
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  expect(agent.runtimeConfig.aiConnection).toBeUndefined();
  const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, account.grantId));
  expect(grant.status).toBe("active");
});
