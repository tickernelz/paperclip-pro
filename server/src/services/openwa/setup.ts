import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { chatActions, chatDeliveries, chatOutboundMessages, heartbeatRuns, type Db } from "@tickernelz/wardmote-db";
import {
  maskOpenwaPhoneNumber,
  type OpenwaGatewayInspection,
} from "@tickernelz/wardmote-shared";
import { OPENWA_GATEWAY_VERSION } from "@tickernelz/wardmote-shared/openwa-operations";
import { HttpError, unprocessable } from "../../errors.js";
import {
  createOpenwaGatewayClient,
  OpenwaGatewayError,
  type OpenwaGatewayClient,
  type OpenwaKeyValidation,
  type OpenwaSession,
} from "./gateway.js";

const SETUP_TIMEOUT_MS = 15_000;
const CHAT_SCOPED_KEY_MESSAGE = "restricted to selected chats";
const E164_DIGITS = /^[1-9][0-9]{6,14}$/;

export interface OpenwaSetupOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface OpenwaReservations {
  accounts: ReadonlySet<string>;
  numbers: ReadonlySet<string>;
}

export interface OpenwaVerifiedSession {
  baseUrl: string;
  sessionId: string;
  sessionName: string;
  phoneNumber: string;
  pushName: string | null;
}

export function openwaProviderAccountId(baseUrl: string, sessionId: string): string {
  return baseUrl + "#" + sessionId;
}

export function openwaPhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.split("@")[0].replace(/\D/g, "");
  return E164_DIGITS.test(digits) ? digits : null;
}

function unreachable(baseUrl: string): HttpError {
  return new HttpError(
    503,
    "Paperclip could not reach the OpenWA gateway at " + baseUrl + ". Check that the gateway is running and reachable from Paperclip; do not replace the API key or other credentials because of this error.",
    { code: "openwa_gateway_unreachable" },
  );
}

/** Maps a gateway failure to the setup error contract: credentials/scope 422, throttling 429, unreachable 503, malformed 502. */
export function openwaSetupError(error: unknown, baseUrl: string): Error {
  if (error instanceof HttpError) return error;
  if (!(error instanceof OpenwaGatewayError)) return error instanceof Error ? error : new Error(String(error));
  switch (error.code) {
    case "unauthorized":
      return unprocessable("OpenWA rejected the API key. Copy an active operator key from the OpenWA dashboard.", {
        code: "openwa_credentials_invalid",
      });
    case "forbidden":
      return error.message.includes(CHAT_SCOPED_KEY_MESSAGE)
        ? chatScopedKey()
        : unprocessable("The OpenWA API key is not allowed to read sessions. Use an operator key scoped to the agent's session.", {
            code: "openwa_credentials_scope",
          });
    case "retry_after":
    case "rate_limited":
      return new HttpError(429, "The OpenWA gateway is rate limiting requests. Wait a moment, then try again.", {
        code: "openwa_rate_limited",
        ...(error.retryAfterSeconds === null ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
      });
    case "gateway_unavailable":
    case "uncertain":
      return unreachable(baseUrl);
    default:
      return new HttpError(502, "The OpenWA gateway returned an unexpected response. Check the gateway version and logs.", {
        code: "openwa_invalid_response",
      });
  }
}

function chatScopedKey(): HttpError {
  return unprocessable(
    "This OpenWA API key is restricted to selected chats, which disables live events. Create a key scoped to the session only (allowedSessions) without allowedChats.",
    { code: "openwa_key_chat_scoped" },
  );
}

function client(baseUrl: string, apiKey: string, adminApiKey: string | undefined, sessionId: string, options: OpenwaSetupOptions): OpenwaGatewayClient {
  return createOpenwaGatewayClient({
    baseUrl,
    apiKey,
    adminApiKey: adminApiKey ?? null,
    sessionId,
    timeoutMs: options.timeoutMs ?? SETUP_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });
}

function assertOperatorKey(validation: OpenwaKeyValidation): asserts validation is OpenwaKeyValidation & { role: "operator" | "admin" } {
  if (!validation.valid) {
    throw unprocessable("OpenWA rejected the API key. Copy an active operator key from the OpenWA dashboard.", {
      code: "openwa_credentials_invalid",
    });
  }
  if (validation.role !== "operator" && validation.role !== "admin") {
    throw unprocessable("The OpenWA API key has the viewer role. Use an operator key so the agent can send messages.", {
      code: "openwa_key_role_insufficient",
    });
  }
}

function adminKeyInvalid(): HttpError {
  return unprocessable("The OpenWA admin key is invalid or does not have the admin role. Copy the admin key that OpenWA printed at its first start.", {
    code: "openwa_admin_key_invalid",
  });
}

async function validateAdminKey(gateway: OpenwaGatewayClient): Promise<"admin"> {
  const validation = await gateway.validateKey("admin");
  if (!validation.valid || validation.role !== "admin") throw adminKeyInvalid();
  return "admin";
}

function adminKeyRequired(): HttpError {
  return unprocessable("Enter the OpenWA admin API key, or an operator key limited to one ready session.", {
    code: "openwa_admin_key_required",
  });
}

async function readSessions(gateway: OpenwaGatewayClient): Promise<OpenwaSession[]> {
  const sessions = await gateway.listSessions();
  if (!Array.isArray(sessions) || sessions.some((session) => !session || typeof session.id !== "string" || typeof session.status !== "string")) {
    throw new HttpError(502, "The OpenWA gateway returned an unexpected session list. Check the gateway version and logs.", {
      code: "openwa_invalid_response",
    });
  }
  return sessions;
}

/** Read-only setup inspection (spec 5.2 steps 1-4); never returns keys or full numbers. */
export async function inspectOpenwaGateway(
  input: { baseUrl: string; apiKey?: string; adminApiKey?: string },
  reservations: OpenwaReservations,
  options: OpenwaSetupOptions = {},
): Promise<OpenwaGatewayInspection> {
  const agentKey = input.apiKey || input.adminApiKey;
  if (!agentKey) throw adminKeyRequired();
  const gateway = client(input.baseUrl, agentKey, input.adminApiKey, "", options);
  try {
    const [versionResult, validation] = await Promise.all([
      gateway.openApiVersion().then(
        (version) => ({ version }),
        (error: unknown) => ({ error }),
      ),
      gateway.validateKey("operator"),
    ]);
    if ("error" in versionResult && versionResult.error instanceof OpenwaGatewayError && versionResult.error.code === "gateway_unavailable") {
      throw versionResult.error;
    }
    if (!input.apiKey && validation.valid && validation.role !== "admin") throw adminKeyInvalid();
    assertOperatorKey(validation);
    const sessions = await readSessions(gateway);
    const adminRole = !input.adminApiKey ? null : input.apiKey ? await validateAdminKey(gateway) : "admin";
    const agentKeyMinted = validation.role === "admin";
    const canManageSessions = adminRole !== null || (agentKeyMinted && validation.scoped !== true);
    const gatewayVersion = "version" in versionResult ? versionResult.version : null;
    const warnings: string[] = [];
    if (gatewayVersion === null) {
      warnings.push("The gateway version is unknown because its API document is unavailable; Paperclip assumes OpenWA " + OPENWA_GATEWAY_VERSION + ".");
    } else if (gatewayVersion !== OPENWA_GATEWAY_VERSION) {
      warnings.push("The gateway runs OpenWA " + gatewayVersion + "; Paperclip is tested with " + OPENWA_GATEWAY_VERSION + ", so some operations may behave differently.");
    }
    if (agentKeyMinted && input.apiKey) {
      warnings.push("The operator API key has the admin role. Wardmote keeps it only for session management and gives the agent a new key limited to the chosen session.");
    } else if (!agentKeyMinted && sessions.length > 1) {
      warnings.push("This key can see " + sessions.length + " sessions, so it is not scoped to one session. Create an operator key whose allowedSessions contains only the agent's session.");
    }
    if (sessions.length === 0 && !canManageSessions) {
      throw unprocessable("This OpenWA API key cannot see any session. Create a session in the OpenWA dashboard or scope the key to an existing one.", {
        code: "openwa_no_session",
      });
    }
    const projected = sessions.map((session) => {
      const digits = openwaPhoneDigits(session.phone);
      const reason =
        session.status !== "ready"
          ? "The session is " + session.status.replaceAll("_", " ") + (canManageSessions ? "; link WhatsApp to it first" : "; open the OpenWA dashboard and connect WhatsApp first")
          : digits === null
            ? "The session has no phone number yet"
            : reservations.accounts.has(openwaProviderAccountId(input.baseUrl, session.id)) || reservations.numbers.has(digits)
              ? "This session or WhatsApp number already belongs to another channel"
              : null;
      return {
        sessionId: session.id,
        name: typeof session.name === "string" ? session.name : session.id,
        status: session.status,
        maskedNumber: digits === null ? null : maskOpenwaPhoneNumber(digits),
        pushName: typeof session.pushName === "string" && session.pushName.trim() ? session.pushName.trim() : null,
        eligible: reason === null,
        ...(reason === null ? {} : { unavailableReason: reason }),
      };
    });
    return {
      baseUrl: input.baseUrl,
      gatewayVersion,
      pinnedVersion: OPENWA_GATEWAY_VERSION,
      engine: typeof validation.engineType === "string" ? validation.engineType : null,
      keyRole: validation.role,
      adminKey: adminRole ? { role: adminRole } : null,
      canManageSessions,
      agentKeyMinted,
      warnings,
      eligible: projected.some((session) => session.eligible),
      sessions: projected,
    };
  } catch (error) {
    throw openwaSetupError(error, input.baseUrl);
  }
}

/** Replaces an admin-role agent key with a new operator key limited to the chosen session, keeping the admin key for board management. */
export async function scopeOpenwaAgentKey(
  credentials: { baseUrl: string; sessionId: string; apiKey?: string; adminApiKey?: string },
  keyName: string,
  options: OpenwaSetupOptions = {},
): Promise<{ apiKey: string; adminApiKey?: string; mintedKeyId: string | null }> {
  const agentKey = credentials.apiKey || credentials.adminApiKey;
  if (!agentKey) throw adminKeyRequired();
  try {
    const validation = await client(credentials.baseUrl, agentKey, undefined, credentials.sessionId, options).validateKey("operator");
    if (!credentials.apiKey && validation.valid && validation.role !== "admin") throw adminKeyInvalid();
    assertOperatorKey(validation);
    if (validation.role !== "admin")
      return { apiKey: agentKey, ...(credentials.adminApiKey ? { adminApiKey: credentials.adminApiKey } : {}), mintedKeyId: null };
    const adminApiKey = credentials.adminApiKey || agentKey;
    const admin = client(credentials.baseUrl, adminApiKey, adminApiKey, credentials.sessionId, options);
    if (adminApiKey !== agentKey) await validateAdminKey(admin);
    const created = await admin.createApiKey({ name: keyName, role: "operator", allowedSessions: [credentials.sessionId] });
    if (!created || typeof created.apiKey !== "string" || !created.apiKey || typeof created.id !== "string")
      throw new HttpError(502, "The OpenWA gateway did not return the new operator key. Check the gateway version and logs.", {
        code: "openwa_invalid_response",
      });
    return { apiKey: created.apiKey, adminApiKey, mintedKeyId: created.id };
  } catch (error) {
    throw openwaSetupError(error, credentials.baseUrl);
  }
}

/** Best-effort revoke of an operator key Wardmote minted for a setup attempt that did not complete. */
export async function revokeOpenwaAgentKey(
  credentials: { baseUrl: string; adminApiKey: string },
  keyId: string,
  options: OpenwaSetupOptions = {},
): Promise<void> {
  await client(credentials.baseUrl, credentials.adminApiKey, credentials.adminApiKey, "", options)
    .revokeApiKey(keyId)
    .catch(() => undefined);
}

/** Verifies stored or supplied credentials still identify one ready session (configure, reconnect, resume). */
export async function verifyOpenwaSession(
  credentials: { baseUrl: string; sessionId: string; apiKey: string; adminApiKey?: string },
  options: OpenwaSetupOptions = {},
): Promise<OpenwaVerifiedSession> {
  const gateway = client(credentials.baseUrl, credentials.apiKey, credentials.adminApiKey, credentials.sessionId, options);
  try {
    assertOperatorKey(await gateway.validateKey("operator"));
    const sessions = await readSessions(gateway);
    if (credentials.adminApiKey) await validateAdminKey(gateway);
    const session = sessions.find((candidate) => candidate.id === credentials.sessionId);
    if (!session) {
      throw unprocessable("The API key cannot see the selected OpenWA session. Inspect the gateway again and choose a visible session.", {
        code: "openwa_session_not_visible",
      });
    }
    const phoneNumber = openwaPhoneDigits(session.phone);
    if (session.status !== "ready" || phoneNumber === null) {
      throw unprocessable("The selected OpenWA session is not ready. Connect WhatsApp in the OpenWA dashboard, then try again.", {
        code: "openwa_session_not_ready",
        status: session.status,
      });
    }
    return {
      baseUrl: credentials.baseUrl,
      sessionId: session.id,
      sessionName: typeof session.name === "string" ? session.name : session.id,
      phoneNumber,
      pushName: typeof session.pushName === "string" && session.pushName.trim() ? session.pushName.trim() : null,
    };
  } catch (error) {
    throw openwaSetupError(error, credentials.baseUrl);
  }
}

/** True when the agent run woken by the setup test message sent a WhatsApp reply to that chat itself, for example with openwa_send. */
export async function openwaSetupReplyDelivered(
  db: Db,
  input: { companyId: string; endpointId: string; agentId: string; deliveryId: string; since: Date },
): Promise<boolean> {
  const [row] = await db
    .select({ id: chatOutboundMessages.id })
    .from(chatOutboundMessages)
    .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, chatOutboundMessages.runId), eq(heartbeatRuns.companyId, chatOutboundMessages.companyId)))
    .innerJoin(
      chatDeliveries,
      and(eq(chatDeliveries.id, input.deliveryId), eq(chatDeliveries.companyId, input.companyId), eq(chatDeliveries.endpointId, input.endpointId)),
    )
    .where(
      and(
        eq(chatOutboundMessages.companyId, input.companyId),
        eq(chatOutboundMessages.endpointId, input.endpointId),
        eq(chatOutboundMessages.state, "sent"),
        inArray(chatOutboundMessages.source, ["tool", "publication"]),
        gte(chatOutboundMessages.sentAt, input.since),
        sql`${chatOutboundMessages.chatKey} = ${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'chatKey'`,
        eq(heartbeatRuns.agentId, input.agentId),
        eq(heartbeatRuns.status, "succeeded"),
        or(
          sql`exists (select 1 from ${chatActions} where ${chatActions.id} = ${heartbeatRuns.wakeupRequestId} and ${chatActions.companyId} = ${input.companyId} and ${chatActions.deliveryId} = ${input.deliveryId})`,
          sql`coalesce(${heartbeatRuns.contextSnapshot} -> 'paperclipOpenwa' -> 'deliveryIds', '[]'::jsonb) ? ${input.deliveryId}`,
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}
