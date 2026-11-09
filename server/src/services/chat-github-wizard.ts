import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  chatEndpoints,
  chatGitHubRegistrations,
  chatExternalPrincipals,
  chatIdentityLinks,
  companies,
  companyMemberships,
  toolConnections,
  type Db,
} from "@tickernelz/wardmote-db";
import type {
  GitHubAppRegistrationInput,
  GitHubAppWizardState,
} from "@tickernelz/wardmote-shared";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { logActivity } from "./activity-log.js";
import {
  githubBotCredentials,
  githubBotRequest,
} from "./chat-github-client.js";
import {
  resyncGitHubAppWebhook,
  listGitHubAppWebhookDeliveries,
  requestGitHubAppWebhookRedelivery,
} from "./chat-github-webhook-config.js";
import { githubChatManagementService } from "./chat-github-management.js";

export function githubWizardBrowserOrigin(
  value: string | null,
  enrolledOrigins: string[],
): string | null {
  if (!value) return value;
  const loopback = (url: URL) =>
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const exactOrigin = (url: URL) =>
    !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  const current = new URL(value);
  if (!exactOrigin(current)) return value;
  if (!loopback(current) || enrolledOrigins.includes(current.origin)) return value;
  for (const candidate of enrolledOrigins) {
    const approved = new URL(candidate);
    if (loopback(approved) && approved.port === current.port && exactOrigin(approved))
      return approved.origin;
  }
  return value;
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const nonce = () => randomBytes(32).toString("base64url");
type Endpoint = typeof chatEndpoints.$inferSelect;
type Resource = { id: string; enabled: boolean; availability: string };
/** Manager-only orchestration. Provider callbacks resume this same durable draft. */
export function githubChatWizardService(
  db: Db,
  options: {
    origin: () => string | null;
    fetch?: typeof fetch;
    startDirect: (
      endpointId: string,
      userId: string,
      input: GitHubAppRegistrationInput,
    ) => Promise<{
      registrationUrl: string;
      manifest: Record<string, unknown>;
      expiresAt: string;
    }>;
    resumeDirect?: (
      endpointId: string,
      userId: string,
    ) => Promise<{
      registrationUrl: string;
      manifest: Record<string, unknown>;
      expiresAt: string;
    }>;
    completeDirect?: (state: string, code: string) => Promise<string>;
    storeApp: (
      endpointId: string,
      userId: string,
      credentials: Record<string, string>,
    ) => Promise<unknown>;
    storeCredentials: (
      endpointId: string,
      userId: string,
      credentials: Record<string, string>,
    ) => Promise<void>;
    refreshRepositories: (
      endpointId: string,
      userId: string,
    ) => Promise<Resource[]>;
    resources: (endpointId: string) => Promise<Resource[]>;
    replaceResources: (
      endpointId: string,
      updates: Array<{ id: string; enabled: boolean }>,
      userId: string,
      options?: { initialGitHubImport?: boolean },
    ) => Promise<unknown>;
    configure: (endpointId: string, userId: string) => Promise<unknown>;
    finish: (endpointId: string, userId: string) => Promise<unknown>;
  },
) {
  const fetchImpl = options.fetch ?? fetch;
  const management = githubChatManagementService(db, fetchImpl);
  const pending = new Map<string, Promise<GitHubAppWizardState>>();
  async function endpoint(id: string, userId: string): Promise<Endpoint> {
    const [bot] = await db
      .select()
      .from(chatEndpoints)
      .where(
        and(eq(chatEndpoints.id, id), eq(chatEndpoints.provider, "github")),
      );
    if (!bot || bot.status === "archived")
      throw notFound("GitHub bot not found");
    const [member] = await db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, bot.companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      );
    if (!member || member.membershipRole === "viewer")
      throw forbidden("An active company manager is required");
    return bot;
  }
  async function registration(bot: Endpoint) {
    const [session] = await db
      .select()
      .from(chatGitHubRegistrations)
      .where(
        and(
          eq(chatGitHubRegistrations.companyId, bot.companyId),
          eq(chatGitHubRegistrations.endpointId, bot.id),
        ),
      )
      .orderBy(desc(chatGitHubRegistrations.createdAt))
      .limit(1);
    return session;
  }
  async function setup(
    bot: Endpoint,
    values: Partial<NonNullable<Endpoint["setup"]["github"]>>,
  ) {
    await db
      .update(chatEndpoints)
      .set({
        setup: sql`jsonb_set(${chatEndpoints.setup}, '{github}', coalesce(${chatEndpoints.setup}->'github','{}'::jsonb) || ${JSON.stringify(values)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatEndpoints.id, bot.id),
          eq(chatEndpoints.companyId, bot.companyId),
        ),
      );
  }
  async function resume(bot: Endpoint) {
    const [company] = await db
      .select({ prefix: companies.issuePrefix })
      .from(companies)
      .where(eq(companies.id, bot.companyId));
    return `${options.origin()}/${company!.prefix}/apps/chat/connect?provider=github&purpose=chat&resume=${bot.id}`;
  }
  function origin() {
    const value = githubWizardBrowserOrigin(options.origin(), []);
    if (!value)
      throw badRequest(
        "Configure this instance's browser address before connecting GitHub",
      );
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw badRequest("Use an enrolled HTTPS or local browser address");
    return url.origin;
  }
  async function start(
    id: string,
    userId: string,
    input: GitHubAppRegistrationInput,
  ) {
    const bot = await endpoint(id, userId);
    if (bot.botExternalId)
      throw conflict(
        "This draft already has an App. Continue its installation or recover its credentials.",
      );
    const prior = await registration(bot);
    if (prior && ["pending", "exchanging", "failed"].includes(prior.status)) {
      if (prior.userId !== userId)
        throw conflict("The configuring member must resume this registration");
      if (prior.status !== "pending" || prior.expiresAt <= new Date())
        throw conflict(
          "Recover the existing App from GitHub settings; its registration cannot safely be repeated.",
        );
      if (prior.handoff) return advance(id, userId);
      // The direct flow's hashed state cannot be reconstructed. Do not create a duplicate App.
      throw conflict(
        "An App registration is already pending. Complete its open GitHub page, or use existing-App recovery.",
      );
    }
    await saveDraft(id, userId, input);
    // Only a fresh registration may import GitHub's initial selection. Old
    // drafts without this marker retain even an entirely disabled selection.
    if (
      !bot.setup.github?.repositorySelectionSaved &&
      !(await options.resources(id)).length
    )
      await setup(bot, { initialRepositoryImportPending: true });
    if (!origin().startsWith("https://"))
      throw badRequest(
        "GitHub App setup needs this instance's HTTPS browser address",
      );
    return {
      endpointId: id,
      state: "create",
      registration: await options.startDirect(id, userId, input),
    } satisfies GitHubAppWizardState;
  }
  async function saveDraft(
    id: string,
    userId: string,
    input: GitHubAppRegistrationInput,
  ) {
    const bot = await endpoint(id, userId);
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(chatEndpoints)
        .where(eq(chatEndpoints.id, id))
        .for("update");
      const [session] = await tx
        .select()
        .from(chatGitHubRegistrations)
        .where(eq(chatGitHubRegistrations.endpointId, id))
        .limit(1);
      if (bot.botExternalId || session)
        throw conflict(
          "Resume the existing App registration before changing its account.",
        );
      await tx
        .update(chatEndpoints)
        .set({
          setup: sql`jsonb_set(${chatEndpoints.setup}, '{github}', coalesce(${chatEndpoints.setup}->'github','{}'::jsonb) || ${JSON.stringify({ ownerType: input.ownerType, ownerLogin: input.ownerType === "organization" ? input.ownerLogin : null, appName: input.name })}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(chatEndpoints.id, id));
      await logActivity(tx as unknown as Db, {
        companyId: bot.companyId,
        actorType: "user",
        actorId: userId,
        action: "chat_github.draft_saved",
        entityType: "tool_connection",
        entityId: bot.connectionId,
        details: { endpointId: id },
      });
    });
    return { saved: true as const };
  }
  async function advance(
    id: string,
    userId: string,
  ): Promise<GitHubAppWizardState> {
    // Multiple open tabs for this manager share one operation, not concurrent vault writes.
    const key = `${id}:${userId}`;
    if (pending.has(key)) return pending.get(key)!;
    const work = advanceOnce(id, userId);
    pending.set(key, work);
    try {
      return await work;
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
  }
  async function advanceOnce(
    id: string,
    userId: string,
  ): Promise<GitHubAppWizardState> {
    let bot = await endpoint(id, userId);
    if (["paused", "revoked"].includes(bot.status))
      return {
        endpointId: id,
        state: "recovery",
        message: "Reconnect this App from connection settings.",
      };
    const session = await registration(bot);

    bot = await endpoint(id, userId);
    if (!bot.botExternalId) {
      if (session) {
        if (
          session.status === "pending" &&
          session.expiresAt > new Date() &&
          session.handoff?.returnState &&
          options.resumeDirect
        )
          return {
            endpointId: id,
            state: "create",
            registration: await options.resumeDirect(id, userId),
          };
        return {
          endpointId: id,
          state: "recovery",
          message:
            "Resume the open GitHub registration page or recover the existing App from GitHub settings.",
        };
      }
      return { endpointId: id, state: "create" };
    }
    if (bot.setup.github?.initialSetupPending) {
      try {
        const stored = await githubBotCredentials(db, bot.companyId, id);
        if (!stored.credentials.webhookSecret)
          throw conflict("The App webhook secret is missing");
      } catch {
        return {
          endpointId: id,
          state: "recovery",
          message:
            "This App's credentials were not completely saved. Recover its existing credentials before continuing.",
        };
      }
    }
    if (
      !bot.providerAccountId ||
      bot.setup.github?.stage === "install" ||
      bot.setup.github?.initialSetupPending
    ) {
      try {
        await options.refreshRepositories(id, userId);
      } catch (error) {
        return {
          endpointId: id,
          state: "install",
          installationUrl: bot.setup.github?.installationUrl,
          message:
            error instanceof Error
              ? error.message
              : "Waiting for installation or administrator approval on GitHub.",
        };
      }
    }
    bot = await endpoint(id, userId);
    const saved = await management.configuration(id, userId);
    if (!bot.setup.github?.initialRepositoriesImported) {
      const resources = await options.resources(id);
      // Fresh manifest and manual Apps import GitHub's initial choices. Saved
      // selections and configuration still belong to the user on recovery.
      const initializeApp =
        !!session || bot.setup.github?.initialSetupPending === true;
      if (
        initializeApp &&
        bot.status !== "active" &&
        saved.revision === 0 &&
        bot.setup.github?.initialRepositoryImportPending === true &&
        !bot.setup.github?.repositorySelectionSaved &&
        !resources.some((resource) => resource.enabled)
      ) {
        await options.replaceResources(
          id,
          resources
            .filter((resource) => resource.availability === "available")
            .map((resource) => ({ id: resource.id, enabled: true })),
          userId,
          { initialGitHubImport: true },
        );
      }
      if (initializeApp && saved.revision === 0 && bot.status !== "active")
        await management.saveConfiguration(
          id,
          {
            expectedRevision: 0,
            configuration: {
              ...saved.configuration,
              toolsEnabled: true,
              defaults: {
                ...saved.configuration.defaults,
                invocation: "mentions_only",
                events: [],
              },
            },
          },
          userId,
        );
      await setup(bot, {
        initialRepositoriesImported: true,
        initialSetupPending: false,
      });
    }
    // Installation callbacks can precede the separately delivered signed ping.
    // Keep the same vaulted App in the wizard instead of throwing JSON from
    // the browser callback or relaxing the configure action's signature gate.
    bot = await endpoint(id, userId);
    if (!bot.setup.webhookVerifiedAt)
      return {
        endpointId: id,
        state: "verify",
        message: "Waiting for GitHub to verify webhook delivery…",
        verification: {
          ready: false,
          checks: [
            {
              key: "webhook",
              label: "Signed webhook delivery",
              ok: false,
              detail: "Keep this page open. Setup will continue automatically when GitHub’s signed ping arrives.",
            },
          ],
        },
      };
    if (
      bot.status !== "active" &&
      (bot.status !== "verifying" || bot.setup.step === "provider_setup")
    )
      await options.configure(id, userId);
    bot = await endpoint(id, userId);
    let linked = await linkedIdentity(bot, userId);
    if (!linked) {
      const [prior] = await db
        .select({
          githubUserId: chatExternalPrincipals.externalId,
          login: chatExternalPrincipals.handle,
        })
        .from(chatIdentityLinks)
        .innerJoin(
          chatExternalPrincipals,
          eq(chatExternalPrincipals.id, chatIdentityLinks.principalId),
        )
        .where(
          and(
            eq(chatIdentityLinks.companyId, bot.companyId),
            eq(chatIdentityLinks.paperclipUserId, userId),
            eq(chatIdentityLinks.status, "linked"),
            eq(chatExternalPrincipals.provider, "github"),
          ),
        )
        .limit(1);
      if (prior?.login) {
        await management.linkObservedIdentity(id, userId, {
          githubUserId: prior.githubUserId,
          login: prior.login,
          avatarUrl: null,
        });
        linked = true;
      }
    }
    if (!linked) {
      const { credentials } = await githubBotCredentials(db, bot.companyId, id);
      return {
        endpointId: id,
        state: "identity",
        identityMethod:
          session && credentials.clientId && credentials.clientSecret
            ? "dedicated_app"
            : "existing_connection",
        identity:
          session?.handoff?.identity &&
          Date.parse(session.handoff.identity.expiresAt) > Date.now()
            ? session.handoff.identity
            : undefined,
      };
    }
    const verification = await management.verification(id);
    const connectionChecks = verification.checks.filter(
      (check) => !["runtime", "isolation"].includes(check.key),
    );
    const runtimeChecks = verification.checks.filter((check) =>
      ["runtime", "isolation"].includes(check.key),
    );
    const connectionReady = connectionChecks.every((check) => check.ok);
    if (connectionReady && bot.status !== "active")
      await options.finish(id, userId);
    return {
      endpointId: id,
      state: connectionReady ? "connected" : "verify",
      identityLinked: true,
      verification: { ready: connectionReady, checks: connectionChecks },
      runtimeChecks,
    };
  }
  async function linkedIdentity(bot: Endpoint, userId: string) {
    const [link] = await db
      .select({ id: chatIdentityLinks.id })
      .from(chatIdentityLinks)
      .where(
        and(
          eq(chatIdentityLinks.companyId, bot.companyId),
          eq(chatIdentityLinks.endpointId, bot.id),
          eq(chatIdentityLinks.paperclipUserId, userId),
          eq(chatIdentityLinks.status, "linked"),
        ),
      )
      .limit(1);
    return !!link;
  }
  async function withIdentityLease<T>(
    sessionId: string,
    work: (assertOwned: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const leaseId = nonce();
    const leaseUntil = () => new Date(Date.now() + 120_000).toISOString();
    const [claimed] = await db
      .update(chatGitHubRegistrations)
      .set({
        handoff: sql`coalesce(${chatGitHubRegistrations.handoff}, '{"cloudId":"","returnState":"","redemptionId":""}'::jsonb) || ${JSON.stringify({ identityLeaseId: leaseId, identityLeaseExpiresAt: leaseUntil() })}::jsonb`,
      })
      .where(
        and(
          eq(chatGitHubRegistrations.id, sessionId),
          sql`(${chatGitHubRegistrations.handoff}->>'identityLeaseExpiresAt' is null or ${chatGitHubRegistrations.handoff}->>'identityLeaseExpiresAt' <= ${new Date().toISOString()})`,
        ),
      )
      .returning({ id: chatGitHubRegistrations.id });
    if (!claimed)
      throw conflict(
        "Another account-linking attempt is in progress. Try again shortly.",
      );
    let lost = false;
    const assertOwned = async () => {
      const [owned] = await db
        .select({ id: chatGitHubRegistrations.id })
        .from(chatGitHubRegistrations)
        .where(
          and(
            eq(chatGitHubRegistrations.id, sessionId),
            sql`${chatGitHubRegistrations.handoff}->>'identityLeaseId' = ${leaseId}`,
            sql`${chatGitHubRegistrations.handoff}->>'identityLeaseExpiresAt' > ${new Date().toISOString()}`,
          ),
        );
      if (lost || !owned)
        throw conflict("Account-linking changed. Connect your account again.");
    };
    const renewal = setInterval(() => {
      void db
        .update(chatGitHubRegistrations)
        .set({
          handoff: sql`jsonb_set(${chatGitHubRegistrations.handoff}, '{identityLeaseExpiresAt}', ${JSON.stringify(leaseUntil())}::jsonb)`,
        })
        .where(
          and(
            eq(chatGitHubRegistrations.id, sessionId),
            sql`${chatGitHubRegistrations.handoff}->>'identityLeaseId' = ${leaseId}`,
          ),
        )
        .returning({ id: chatGitHubRegistrations.id })
        .then((rows) => {
          if (!rows.length) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, 30_000);
    renewal.unref();
    try {
      return await work(assertOwned);
    } finally {
      clearInterval(renewal);
      await db
        .update(chatGitHubRegistrations)
        .set({
          handoff: sql`${chatGitHubRegistrations.handoff} - 'identityLeaseId' - 'identityLeaseExpiresAt'`,
        })
        .where(
          and(
            eq(chatGitHubRegistrations.id, sessionId),
            sql`${chatGitHubRegistrations.handoff}->>'identityLeaseId' = ${leaseId}`,
          ),
        );
    }
  }
  async function startIdentity(id: string, userId: string) {
    const bot = await endpoint(id, userId),
      session = await registration(bot);
    if (!session || session.userId !== userId)
      throw forbidden("The configuring member must link their GitHub account");
    return withIdentityLease(session.id, (assertOwned) =>
      startIdentityLocked(id, userId, assertOwned),
    );
  }
  async function startIdentityLocked(
    id: string,
    userId: string,
    assertOwned: () => Promise<void>,
  ) {
    const bot = await endpoint(id, userId),
      session = await registration(bot);
    if (!session || session.userId !== userId)
      throw forbidden("The configuring member must link their GitHub account");
    const credentials = await githubBotCredentials(db, bot.companyId, id);
    if (
      !credentials.credentials.clientId ||
      !credentials.credentials.clientSecret
    )
      throw conflict(
        "This existing App needs a personal GitHub connection to verify your account.",
      );
    const verifier = nonce(),
      state = nonce();
    await assertOwned();
    await options.storeCredentials(id, userId, {
      identityCodeVerifier: verifier,
    });
    await assertOwned();
    await db
      .update(chatGitHubRegistrations)
      .set({
        handoff: sql`(${chatGitHubRegistrations.handoff} - 'identity') || ${JSON.stringify({ identityStateHash: hash(state), identityExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), identityRedemptionId: nonce() })}::jsonb`,
      })
      .where(eq(chatGitHubRegistrations.id, session.id));
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", credentials.credentials.clientId);
    url.searchParams.set(
      "redirect_uri",
      `${origin()}/api/chat-github/identity/callback`,
    );
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString() };
  }
  async function completeIdentity(
    session: typeof chatGitHubRegistrations.$inferSelect,
    code: string,
    redirectUri: string,
  ) {
    return withIdentityLease(session.id, async (assertOwned) => {
      const [current] = await db
        .select()
        .from(chatGitHubRegistrations)
        .where(eq(chatGitHubRegistrations.id, session.id));
      if (
        !current ||
        current.handoff?.identityStateHash !==
          session.handoff?.identityStateHash
      )
        return resume(await endpoint(session.endpointId, session.userId));
      return completeIdentityLocked(current, code, redirectUri, assertOwned);
    });
  }
  async function completeIdentityLocked(
    session: typeof chatGitHubRegistrations.$inferSelect,
    code: string,
    redirectUri: string,
    assertOwned: () => Promise<void>,
  ) {
    const bot = await endpoint(session.endpointId, session.userId);
    if (
      !session.handoff?.identityExpiresAt ||
      Date.parse(session.handoff.identityExpiresAt) <= Date.now()
    )
      throw conflict(
        "GitHub identity authorization expired. Connect your account again.",
      );
    const [consumed] = await db
      .update(chatGitHubRegistrations)
      .set({
        handoff: sql`${chatGitHubRegistrations.handoff} - 'identityStateHash'`,
      })
      .where(
        and(
          eq(chatGitHubRegistrations.id, session.id),
          sql`${chatGitHubRegistrations.handoff}->>'identityStateHash' = ${session.handoff?.identityStateHash ?? ""}`,
        ),
      )
      .returning();
    if (!consumed) return resume(bot);
    const material = await githubBotCredentials(db, bot.companyId, bot.id);
    const response = await fetchImpl(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: material.credentials.clientId,
          client_secret: material.credentials.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: material.credentials.identityCodeVerifier,
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw conflict(
        "GitHub authorization failed. Connect your account again.",
      );
    }
    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token)
      throw conflict(
        "GitHub authorization was denied. Connect your account again.",
      );
    const user = await githubBotRequest<{
      id: number;
      login: string;
      avatar_url?: string;
    }>(fetchImpl, token.access_token, "/user");
    let allowed = false;
    for (let page = 1; page <= 100; page++) {
      const result = await githubBotRequest<{
        installations: Array<{ id: number; app_id: number }>;
      }>(
        fetchImpl,
        token.access_token,
        `/user/installations?per_page=100&page=${page}`,
      );
      allowed = result.installations.some(
        (installation) =>
          String(installation.app_id) === bot.botExternalId &&
          String(installation.id) === material.credentials.installationId,
      );
      if (allowed || result.installations.length < 100) break;
    }
    if (!allowed)
      throw forbidden(
        "Your GitHub account cannot access this App installation",
      );
    if (
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      !/^[A-Za-z0-9-]{1,39}$/.test(user.login)
    )
      throw conflict("GitHub returned an invalid account");
    // OAuth token remains transient; only an expiring observed identity is saved.
    await assertOwned();
    const identity = {
      githubUserId: String(user.id),
      login: user.login,
      avatarUrl: user.avatar_url ?? null,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    await db
      .update(chatGitHubRegistrations)
      .set({
        handoff: sql`jsonb_set(${chatGitHubRegistrations.handoff}, '{identity}', ${JSON.stringify(identity)}::jsonb)`,
      })
      .where(eq(chatGitHubRegistrations.id, session.id));
    await assertOwned();
    await options.storeCredentials(bot.id, session.userId, {
      identityCodeVerifier: nonce(),
    });
    return resume(bot);
  }
  async function directCallback(state: string, code: string) {
    const [session] = await db
      .select()
      .from(chatGitHubRegistrations)
      .where(eq(chatGitHubRegistrations.stateHash, hash(state)))
      .limit(1);
    if (
      !session ||
      session.trustedOrigin !== origin()
    )
      throw forbidden("GitHub return did not match this instance");
    const bot = await endpoint(session.endpointId, session.userId);
    if (session.status === "failed" || session.status === "exchanging")
      return resume(bot);
    if (session.status === "pending") {
      if (!options.completeDirect)
        throw conflict("GitHub registration is unavailable");
      await options.completeDirect(state, code);
    }
    const progress = await advance(bot.id, session.userId);
    return progress.state === "install" && progress.installationUrl
      ? progress.installationUrl
      : resume(bot);
  }
  async function identityCallback(state: string, code: string) {
    const [session] = await db
      .select()
      .from(chatGitHubRegistrations)
      .where(
        sql`${chatGitHubRegistrations.handoff}->>'identityStateHash' = ${hash(state)}`,
      )
      .limit(1);
    if (!session || session.trustedOrigin !== origin())
      throw forbidden("GitHub identity return did not match");
    await endpoint(session.endpointId, session.userId);
    if (!code) {
      await db
        .update(chatGitHubRegistrations)
        .set({
          handoff: sql`${chatGitHubRegistrations.handoff} - 'identityStateHash'`,
        })
        .where(
          and(
            eq(chatGitHubRegistrations.id, session.id),
            sql`${chatGitHubRegistrations.handoff}->>'identityStateHash' = ${hash(state)}`,
          ),
        );
      return resume(await endpoint(session.endpointId, session.userId));
    }
    return completeIdentity(
      session,
      code,
      `${origin()}/api/chat-github/identity/callback`,
    );
  }
  async function confirmIdentity(
    id: string,
    userId: string,
    githubUserId: string,
  ) {
    const bot = await endpoint(id, userId),
      session = await registration(bot),
      candidate = session?.handoff?.identity;
    if (
      session?.userId !== userId ||
      !candidate ||
      candidate.githubUserId !== githubUserId ||
      Date.parse(candidate.expiresAt) <= Date.now()
    )
      throw conflict(
        "Connect your GitHub account again before confirming its identity",
      );
    await withIdentityLease(session.id, async (assertOwned) => {
      const [current] = await db
        .select()
        .from(chatGitHubRegistrations)
        .where(eq(chatGitHubRegistrations.id, session.id));
      if (
        current?.handoff?.identity?.githubUserId !== githubUserId ||
        current.handoff.identity.expiresAt !== candidate.expiresAt
      )
        throw conflict("GitHub identity changed. Connect your account again.");
      await assertOwned();
      await management.linkObservedIdentity(id, userId, candidate);
      await db
        .update(chatGitHubRegistrations)
        .set({ handoff: sql`${chatGitHubRegistrations.handoff} - 'identity'` })
        .where(eq(chatGitHubRegistrations.id, session.id));
    });
    return advance(id, userId);
  }
  return {
    saveDraft,
    start,
    advance,
    startIdentity,
    directCallback,
    identityCallback,
    confirmIdentity,
  };
}
