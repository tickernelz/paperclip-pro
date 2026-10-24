import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { authSessions, authUsers, companyMemberships, instanceUserRoles } from "@tickernelz/paperclip-pro-db";
import type { TerminalSessionKind } from "@tickernelz/paperclip-pro-shared";

export type TerminalActor = Pick<
  Express.Request["actor"],
  "type" | "source" | "userId" | "isInstanceAdmin" | "companyIds" | "memberships"
>;

export interface TerminalActorClaim {
  userId: string | null;
  actorSource: string;
  authSessionId: string | null;
}

export type TerminalActorLoader = (claim: TerminalActorClaim) => Promise<TerminalActor | null>;

export const HUMAN_TERMINAL_SOURCES: ReadonlySet<string> = new Set(["local_implicit", "session", "cloud_tenant"]);

export const TERMINAL_INSTANCE_ADMIN_REQUIRED = "Instance admin access required";

export function terminalAccessDenial(actor: TerminalActor, companyId: string, kind: TerminalSessionKind): string | null {
  if (actor.type !== "board") return "Terminal access requires a signed-in board user";
  if (!HUMAN_TERMINAL_SOURCES.has(actor.source ?? "")) {
    return "Terminal access requires a signed-in board session, not an API key";
  }
  if (actor.source === "local_implicit") return null;
  if (!(actor.companyIds ?? []).includes(companyId)) return "User does not have access to this company";
  if (kind === "local") return actor.isInstanceAdmin ? null : TERMINAL_INSTANCE_ADMIN_REQUIRED;
  if (actor.isInstanceAdmin) return null;
  const membership = actor.memberships?.find((item) => item.companyId === companyId);
  if (!membership || membership.status !== "active" || membership.membershipRole === "viewer") {
    return "Terminal access requires an active non-viewer company membership";
  }
  return null;
}

export function databaseTerminalActorLoader(db: Db): TerminalActorLoader {
  return async ({ userId, actorSource, authSessionId }) => {
    if (!userId) return null;
    if (actorSource === "local_implicit") {
      return { type: "board", source: "local_implicit", userId, isInstanceAdmin: true };
    }
    if (!HUMAN_TERMINAL_SOURCES.has(actorSource)) return null;
    if (actorSource === "session" && !authSessionId) return null;
    const user = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null);
    if (!user) return null;
    if (authSessionId) {
      const session = await db
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.id, authSessionId),
            eq(authSessions.userId, userId),
            gt(authSessions.expiresAt, new Date()),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!session) return null;
    }
    const [roleRow, memberships] = await Promise.all([
      db
        .select({ id: instanceUserRoles.id })
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
        .then((rows) => rows[0] ?? null),
      db
        .select({
          companyId: companyMemberships.companyId,
          membershipRole: companyMemberships.membershipRole,
          status: companyMemberships.status,
        })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.status, "active"),
          ),
        ),
    ]);
    return {
      type: "board",
      source: actorSource as TerminalActor["source"],
      userId,
      isInstanceAdmin: Boolean(roleRow),
      companyIds: memberships.map((row) => row.companyId),
      memberships,
    };
  };
}
