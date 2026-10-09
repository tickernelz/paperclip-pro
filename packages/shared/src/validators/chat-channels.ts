import { z } from "zod";
import { multilineTextSchema } from "./text.js";
import {
  CHAT_CONCURRENCY_POLICIES,
  CHAT_DELIVERY_STATES,
  CHAT_ENDPOINT_STATUSES,
  CHAT_EVENT_KINDS,
  CHAT_FILE_TRANSFER_PHASES,
  CHAT_IDENTITY_LINK_STATUSES,
  CHAT_PRINCIPAL_KINDS,
  CHAT_PROVIDERS,
  CHAT_PUBLICATION_STATES,
  CHAT_RESOURCE_AVAILABILITIES,
  CHAT_INFLIGHT_MODES,
  OPENWA_CHAT_ACTIVATIONS,
  OPENWA_GATEWAY_ADMIN_TOOL_LEVELS,
  OPENWA_NUMBER_MODES,
  OPENWA_REPLY_POLICIES,
  OPENWA_SENDER_POLICY_MODES,
  CHAT_SENDER_RULE_LISTS,
  CHAT_OWNER_APPROVAL_STATUSES,
  type OpenwaEndpointPolicy,
  type OpenwaNumberMode,
  type OpenwaTriggerRules,
} from "../types/chat-channels.js";

export const chatProviderSchema = z.enum(CHAT_PROVIDERS);
export const chatEndpointStatusSchema = z.enum(CHAT_ENDPOINT_STATUSES);
export const chatConcurrencyPolicySchema = z.enum(CHAT_CONCURRENCY_POLICIES);
export const chatEventKindSchema = z.enum(CHAT_EVENT_KINDS);
export const chatDeliveryStateSchema = z.enum(CHAT_DELIVERY_STATES);
export const chatPublicationStateSchema = z.enum(CHAT_PUBLICATION_STATES);
export const chatPrincipalKindSchema = z.enum(CHAT_PRINCIPAL_KINDS);
export const chatIdentityLinkStatusSchema = z.enum(CHAT_IDENTITY_LINK_STATUSES);
export const chatResourceAvailabilitySchema = z.enum(
  CHAT_RESOURCE_AVAILABILITIES,
);

/**
 * Microsoft emits Entra application and tenant identifiers in canonical UUID
 * form in Bot Framework activities. Tenant aliases such as `common` or an
 * `onmicrosoft.com` domain can be accepted by the token endpoint, but cannot
 * be compared safely with the activity tenant id used by Paperclip's runtime
 * fence. Normalize the UUIDs at the API boundary instead.
 */
export const microsoftTeamsCredentialIdSchema = z
  .string()
  .trim()
  .uuid()
  .refine((value) => value !== "00000000-0000-0000-0000-000000000000", {
    message: "Microsoft Teams credential IDs cannot be the nil UUID",
  })
  .transform((value) => value.toLowerCase());

const chatEndpointCredentialsSchema = z
  .record(z.string(), z.string().min(1))
  .superRefine((credentials, ctx) => {
    for (const key of ["clientId", "tenantId"] as const) {
      const value = credentials[key];
      if (value === undefined) continue;
      const parsed = microsoftTeamsCredentialIdSchema.safeParse(value);
      if (parsed.success) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be a canonical Microsoft Entra UUID`,
      });
    }
  })
  .transform((credentials) => {
    const normalized = { ...credentials };
    for (const key of ["clientId", "tenantId"] as const) {
      const value = normalized[key];
      if (value !== undefined) {
        normalized[key] = microsoftTeamsCredentialIdSchema.parse(value);
      }
    }
    return normalized;
  });

export const createChatEndpointSchema = z
  .object({
    provider: chatProviderSchema.exclude(["agentmail"]),
    assignedAgentId: z.string().uuid(),
    applicationId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const slackAppConfigurationSchema = z.object({
  appName: z.string().trim().min(1, "Enter a Slack app name.").max(35),
  botName: z.string().trim().min(1).max(80).regex(/^[a-z0-9._-]+$/, "Use lowercase letters, numbers, dots, hyphens, or underscores for the bot name."),
  command: z.string().trim().min(2).max(32).regex(/^\/[a-z0-9_-]+$/, "Start the command with / and use lowercase letters, numbers, hyphens, or underscores."),
}).strict();

export const updateChatEndpointSchema = z
  .object({
    communicationInstructions: multilineTextSchema.pipe(z.string().trim().max(4000)).optional(),
    slackApp: slackAppConfigurationSchema.optional(),
    allowDirectMessages: z.boolean().optional(),
    allowGroupChats: z.boolean().optional(),
    allowUnlinkedPeople: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one chat endpoint field is required",
  });

export const photonProjectIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const photonLineIdSchema = z.string().trim().min(1).max(63).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/);
export const photonChannelConfigurationSchema = z.union([
  z.object({ allocation: z.literal("dedicated").default("dedicated"), projectId: photonProjectIdSchema, lineId: photonLineIdSchema }).strict(),
  z.object({ allocation: z.literal("shared"), projectId: photonProjectIdSchema }).strict(),
]);
export const inspectPhotonProjectSchema = z.object({
  projectId: photonProjectIdSchema,
  projectSecret: z.string().min(1).max(4096),
}).strict();

export const openwaBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the OpenWA gateway URL, for example http://localhost:2785" });
      return z.NEVER;
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use only the gateway origin: http(s)://host:port, without a path, query, or credentials" });
      return z.NEVER;
    }
    return url.origin;
  });
export const openwaSessionIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const openwaApiKeyInputSchema = z.string().trim().min(1).max(4096);
export const inspectOpenwaGatewaySchema = z.object({
  baseUrl: openwaBaseUrlSchema,
  apiKey: openwaApiKeyInputSchema,
  adminApiKey: openwaApiKeyInputSchema.optional(),
}).strict();
export const openwaChannelConfigurationSchema = z.object({
  baseUrl: openwaBaseUrlSchema,
  sessionId: openwaSessionIdSchema,
  numberMode: z.enum(OPENWA_NUMBER_MODES).default("agent_number"),
  attestations: z.object({ pacing: z.boolean(), soleClient: z.boolean() }).strict(),
}).strict();

/** Masks an E.164 digit string as +62xxx...1234 for display. */
export function maskOpenwaPhoneNumber(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 7) return "+xxx";
  return `+${clean.slice(0, 2)}xxx...${clean.slice(-4)}`;
}

export const configureChatEndpointSchema = z
  .object({
    action: z.enum([
      "configure",
      "verify",
      "pause",
      "resume",
      "reconnect",
      "remove",
    ]),
    credentials: chatEndpointCredentialsSchema.optional(),
    photon: photonChannelConfigurationSchema.optional(),
    openwa: openwaChannelConfigurationSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.credentials || value.photon || value.openwa) &&
      value.action !== "configure" &&
      value.action !== "reconnect"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["credentials"],
        message: `Credentials are not accepted for the ${value.action} action`,
      });
    }
  });

export const replaceChatEndpointResourcesSchema = z
  .object({
    resources: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const publishChatCommentSchema = z
  .object({
    commentId: z.string().uuid(),
  })
  .strict();

export const publishChatBoardMessageSchema = z
  .object({
    body: multilineTextSchema.pipe(z.string().trim().min(1).max(100_000)),
    idempotencyKey: z.string().trim().min(16).max(200),
    attachmentIds: z
      .array(z.string().uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Attachment ids must be unique",
      })
      .optional(),
  })
  .strict();

export const publishChatPublicationSchema = z.union([
  publishChatCommentSchema,
  publishChatBoardMessageSchema,
]);

export const resolveChatPublicationSchema = z
  .object({
    action: z.enum(["mark_delivered", "retry_anyway", "cancel"]),
    fileTransfer: z
      .object({
        phase: z.enum(CHAT_FILE_TRANSFER_PHASES),
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .optional(),
  })
  .strict();

export const resolveChatActionSchema = z
  .object({
    action: z.enum(["mark_delivered", "retry_anyway", "cancel"]),
  })
  .strict();

export const createChatIdentityLinkIntentSchema = z
  .object({
    expiresInSeconds: z.number().int().min(300).max(86_400).default(1_800),
  })
  .strict()
  .default({ expiresInSeconds: 1_800 });

export const confirmChatIdentityLinkSchema = z
  .object({
    token: z.string().min(32).max(4096),
  })
  .strict();

export const replayChatDeliverySchema = z.object({}).strict();

export const chatInflightModeSchema = z.enum(CHAT_INFLIGHT_MODES);
export const openwaNumberModeSchema = z.enum(OPENWA_NUMBER_MODES);
export const openwaSenderPolicyModeSchema = z.enum(OPENWA_SENDER_POLICY_MODES);
export const openwaReplyPolicySchema = z.enum(OPENWA_REPLY_POLICIES);
export const openwaChatActivationSchema = z.enum(OPENWA_CHAT_ACTIVATIONS);
export const openwaGatewayAdminToolLevelSchema = z.enum(OPENWA_GATEWAY_ADMIN_TOOL_LEVELS);

export const OPENWA_DEFAULT_COMMAND_PREFIX = "/ai";
export const OPENWA_DEFAULT_OWNER_NUMBER_PREFIX = "\u{1F916} *Assistant:*";
export const OPENWA_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 8000;
export const OPENWA_CHAT_NOTE_MAX_LENGTH = 2000;

const openwaCommandPrefixSchema = z.string().trim().min(1).max(32).regex(/^\S+$/);
const openwaKeywordsSchema = z.array(z.string().trim().min(1).max(100)).max(50);
const openwaAbsenceSecondsSchema = z.number().int().min(10).max(86_400);

export function openwaDefaultTriggerRules(numberMode: OpenwaNumberMode): OpenwaTriggerRules {
  const agentNumber = numberMode === "agent_number";
  return {
    directMessage: agentNumber,
    agentMentioned: agentNumber,
    replyToAgent: true,
    commandPrefix: { enabled: !agentNumber, prefix: OPENWA_DEFAULT_COMMAND_PREFIX },
    selfChat: !agentNumber,
    ownerMentionedAbsent: true,
    keywords: [],
    allMessages: false,
  };
}

const openwaTriggerRulesInputSchema = z
  .object({
    directMessage: z.boolean().optional(),
    agentMentioned: z.boolean().optional(),
    replyToAgent: z.boolean().optional(),
    commandPrefix: z
      .object({
        enabled: z.boolean().optional(),
        prefix: openwaCommandPrefixSchema.optional(),
      })
      .strict()
      .optional(),
    selfChat: z.boolean().optional(),
    ownerMentionedAbsent: z.boolean().optional(),
    keywords: openwaKeywordsSchema.optional(),
    allMessages: z.boolean().optional(),
  })
  .strict();

export const openwaEndpointPolicySchema = z
  .object({
    numberMode: openwaNumberModeSchema.default("agent_number"),
    senderPolicyMode: openwaSenderPolicyModeSchema.default("allowlist"),
    replyPolicy: openwaReplyPolicySchema.default("allowed"),
    groupMemberReplies: z.boolean().default(true),
    triggers: openwaTriggerRulesInputSchema.optional(),
    absenceSeconds: openwaAbsenceSecondsSchema.default(120),
    approvals: z
      .object({
        createTask: z.boolean().default(true),
        externalTools: z.boolean().default(true),
        crossChatSend: z.boolean().default(true),
        waAdmin: z.boolean().default(true),
        gatewayAdmin: z.boolean().default(true),
        reminderMinutes: z.number().int().min(1).max(1440).default(30),
        maxReminders: z.number().int().min(0).max(10).default(3),
        grantTtlHours: z.number().int().min(1).max(720).default(24),
        pendingTtlHours: z.number().int().min(1).max(168).default(24),
      })
      .strict()
      .prefault({}),
    rotateAfterIdleHours: z.number().int().min(1).max(720).default(24),
    progressNudgeSeconds: z.number().int().min(0).max(3600).default(60),
    typingIndicator: z.boolean().default(true),
    ownerNumberPrefix: z
      .object({
        enabled: z.boolean().default(true),
        text: z.string().trim().min(1).max(64).default(OPENWA_DEFAULT_OWNER_NUMBER_PREFIX),
      })
      .strict()
      .prefault({}),
    gatewayAdminTools: openwaGatewayAdminToolLevelSchema.default("off"),
    customInstructions: multilineTextSchema
      .pipe(z.string().trim().max(OPENWA_CUSTOM_INSTRUCTIONS_MAX_LENGTH))
      .default(""),
    auditContentRetentionDays: z.number().int().min(1).max(3650).default(90),
    attestations: z
      .object({
        pacing: z.boolean().default(false),
        soleClient: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .transform((value): OpenwaEndpointPolicy => {
    const defaults = openwaDefaultTriggerRules(value.numberMode);
    const triggers = value.triggers ?? {};
    return {
      ...value,
      triggers: {
        directMessage: triggers.directMessage ?? defaults.directMessage,
        agentMentioned: triggers.agentMentioned ?? defaults.agentMentioned,
        replyToAgent: triggers.replyToAgent ?? defaults.replyToAgent,
        commandPrefix: {
          enabled: triggers.commandPrefix?.enabled ?? defaults.commandPrefix.enabled,
          prefix: triggers.commandPrefix?.prefix ?? defaults.commandPrefix.prefix,
        },
        selfChat: triggers.selfChat ?? defaults.selfChat,
        ownerMentionedAbsent: triggers.ownerMentionedAbsent ?? defaults.ownerMentionedAbsent,
        keywords: triggers.keywords ?? defaults.keywords,
        allMessages: triggers.allMessages ?? defaults.allMessages,
      },
    };
  });

export const openwaTriggerOverridesSchema = openwaTriggerRulesInputSchema;

export const openwaChatSettingsSchema = z
  .object({
    activation: openwaChatActivationSchema.default("auto"),
    triggers: openwaTriggerOverridesSchema.optional(),
    absenceSeconds: openwaAbsenceSecondsSchema.optional(),
    replyPolicy: openwaReplyPolicySchema.optional(),
    note: multilineTextSchema.pipe(z.string().trim().max(OPENWA_CHAT_NOTE_MAX_LENGTH)).optional(),
  })
  .strict();

export const openwaE164Schema = z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/, "Use an E.164 number such as +6281234567890");

export const addOpenwaOwnerSchema = z
  .object({
    e164: openwaE164Schema,
    expiresInSeconds: z.number().int().min(300).max(86_400).default(1_800),
  })
  .strict();

export const createOpenwaSenderRuleSchema = z
  .object({
    list: z.enum(CHAT_SENDER_RULE_LISTS),
    e164: openwaE164Schema,
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const updateOpenwaChatSettingsSchema = z
  .object({
    chatId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,128}@(c\.us|g\.us|lid)$/),
    label: z.string().trim().min(1).max(512).optional(),
    settings: openwaChatSettingsSchema,
  })
  .strict();

export const openwaLinkedChatSchema = z
  .object({
    chatId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,128}@(c\.us|g\.us|lid)$/),
    label: z.string().trim().min(1).max(200),
    isGroup: z.boolean(),
  })
  .strict();

export const linkOpenwaSessionSchema = z
  .object({
    sessionId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,128}$/),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export const updateOpenwaLinkedChatsSchema = z
  .object({ chats: z.array(openwaLinkedChatSchema).max(500) })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.chats.map((chat) => chat.chatId.toLowerCase())).size !== value.chats.length)
      ctx.addIssue({ code: "custom", path: ["chats"], message: "Each chat may be selected once" });
  });

export const updateOpenwaEndpointPolicySchema = z.looseObject({ inflightMode: chatInflightModeSchema.optional() });

export const resolveOpenwaApprovalSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const listOpenwaApprovalsQuerySchema = z
  .object({ status: z.enum(CHAT_OWNER_APPROVAL_STATUSES).optional() })
  .strict();

export type OpenwaEndpointPolicyInput = z.input<typeof openwaEndpointPolicySchema>;
export type UpdateOpenwaEndpointPolicyInput = OpenwaEndpointPolicyInput & { inflightMode?: z.infer<typeof chatInflightModeSchema> };
export type OpenwaChatSettingsInput = z.input<typeof openwaChatSettingsSchema>;

export const chatPublicEndpointIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{32,128}$/);
