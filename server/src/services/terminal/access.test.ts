import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authSessions,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  instanceUserRoles,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { databaseTerminalActorLoader, terminalAccessDenial } from "./access.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("databaseTerminalActorLoader", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let userId: string;
  let authSessionId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-terminal-access-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    companyId = randomUUID();
    userId = `user-${randomUUID()}`;
    authSessionId = `session-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Terminal", issuePrefix: `T${companyId.slice(0, 8)}` });
    await db.insert(authUsers).values({ id: userId, name: "Admin", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(authSessions).values({
      id: authSessionId,
      token: randomUUID(),
      userId,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
  });

  const load = (overrides: { authSessionId?: string | null; actorSource?: string; userId?: string | null } = {}) =>
    databaseTerminalActorLoader(db)({
      userId: overrides.userId === undefined ? userId : overrides.userId,
      actorSource: overrides.actorSource ?? "session",
      authSessionId: overrides.authSessionId === undefined ? authSessionId : overrides.authSessionId,
    });

  it("loads an instance admin with a live login session", async () => {
    const actor = await load();
    expect(actor).toMatchObject({ type: "board", source: "session", userId, isInstanceAdmin: true, companyIds: [companyId] });
    expect(terminalAccessDenial(actor!, companyId, "local")).toBeNull();
  });

  it("denies when the login session row is deleted", async () => {
    await db.delete(authSessions).where(eq(authSessions.id, authSessionId));
    expect(await load()).toBeNull();
  });

  it("denies when the login session has expired", async () => {
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authSessions.id, authSessionId));
    expect(await load()).toBeNull();
  });

  it("denies when the login session belongs to another user", async () => {
    const otherUser = `user-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: otherUser, name: "Other", email: `${otherUser}@example.test`, createdAt: now, updatedAt: now });
    expect(await load({ userId: otherUser })).toBeNull();
  });

  it("denies when the user row is missing", async () => {
    expect(await load({ actorSource: "cloud_tenant", authSessionId: null })).toMatchObject({ source: "cloud_tenant", userId });
    await db.delete(authUsers).where(eq(authUsers.id, userId));
    expect(await load()).toBeNull();
    expect(await load({ actorSource: "cloud_tenant", authSessionId: null })).toBeNull();
  });

  it("denies a session-sourced grant without a login session id", async () => {
    expect(await load({ authSessionId: null })).toBeNull();
  });

  it("reflects a removed instance admin role and membership", async () => {
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, userId));
    const nonAdmin = await load();
    expect(terminalAccessDenial(nonAdmin!, companyId, "local")).toBe("Instance admin access required");
    expect(terminalAccessDenial(nonAdmin!, companyId, "ssh")).toBeNull();
    await db.delete(companyMemberships).where(eq(companyMemberships.principalId, userId));
    const removed = await load();
    expect(terminalAccessDenial(removed!, companyId, "ssh")).toBe("User does not have access to this company");
  });

  it("refuses non-human sources", async () => {
    expect(await load({ actorSource: "board_key" })).toBeNull();
  });
});
