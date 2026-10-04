import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ChatAdapterCapabilities,
  ChatAnswerState,
  ChatAuditActorKind,
  ChatAuditEntryKind,
  ChatConcurrencyPolicy,
  ChatInflightMode,
  ChatOutboundMessageSource,
  ChatOutboundMessageState,
  ChatOwnerApprovalChannel,
  ChatOwnerApprovalStatus,
  ChatOwnerGrantScope,
  ChatOwnerGrantStatus,
  ChatScheduledWakeKind,
  ChatScheduledWakeState,
  ChatSenderRuleList,
  OpenwaChatSettings,
  OpenwaEndpointPolicy,
  OpenwaLinkedChat,
  OpenwaLinkedSessionStatus,
  OpenwaGrantCategory,
  OpenwaPrincipalRole,
  OpenwaTriggerClass,
  ChatDeliveryState,
  ChatDeploymentMode,
  ChatEndpointSetupState,
  ChatEndpointStatus,
  ChatEventKind,
  ChatIdentityLinkStatus,
  ChatPrincipalKind,
  ChatProvider,
  ChatPublicationState,
  ChatResourceAvailability,
  SafeChatPublicationPayload,
} from "@tickernelz/paperclip-pro-shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issueComments } from "./issue_comments.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";
import { issues } from "./issues.js";
import { toolConnections } from "./tool_access.js";

export const chatEndpoints = pgTable(
  "chat_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    provider: text("provider").$type<ChatProvider>().notNull(),
    publicId: text("public_id").notNull(),
    publicationMode: text("publication_mode").$type<"automatic" | "explicit">().notNull().default("automatic"),
    externalExecutionPolicy: text("external_execution_policy").$type<"restricted" | "agent">().notNull().default("restricted"),
    assignedAgentId: uuid("assigned_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    sponsorUserId: text("sponsor_user_id"),
    status: text("status")
      .$type<ChatEndpointStatus>()
      .notNull()
      .default("draft"),
    deploymentMode: text("deployment_mode")
      .$type<ChatDeploymentMode>()
      .notNull()
      .default("direct"),
    providerAccountId: text("provider_account_id"),
    providerAccountLabel: text("provider_account_label"),
    botExternalId: text("bot_external_id"),
    botUsername: text("bot_username"),
    botDisplayName: text("bot_display_name"),
    botAvatarUrl: text("bot_avatar_url"),
    communicationInstructions: text("communication_instructions").notNull().default(""),
    allowDirectMessages: boolean("allow_direct_messages")
      .notNull()
      .default(true),
    allowGroupChats: boolean("allow_group_chats").notNull().default(false),
    allowUnlinkedPeople: boolean("allow_unlinked_people")
      .notNull()
      .default(true),
    concurrencyPolicy: text("concurrency_policy")
      .$type<ChatConcurrencyPolicy>()
      .notNull()
      .default("queue"),
    capabilities: jsonb("capabilities")
      .$type<ChatAdapterCapabilities>()
      .notNull()
      .default({
        threads: false,
        directMessages: false,
        nativeStreaming: false,
        messageEdits: false,
        messageDeletes: false,
        reactions: false,
        files: false,
        cards: false,
        actions: false,
        modals: false,
        slashCommands: false,
        ephemeralMessages: false,
        proactiveDirectMessages: false,
      }),
    setup: jsonb("setup")
      .$type<ChatEndpointSetupState>()
      .notNull()
      .default({ step: "provider_setup" }),
    policy: jsonb("policy")
      .$type<OpenwaEndpointPolicy | Record<string, never>>()
      .notNull()
      .default({}),
    policyRevision: integer("policy_revision").notNull().default(0),
    inflightMode: text("inflight_mode")
      .$type<ChatInflightMode>()
      .notNull()
      .default("queue"),
    healthMessage: text("health_message"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastPublicationAt: timestamp("last_publication_at", { withTimezone: true }),
    lastError: text("last_error"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("chat_endpoints_publication_mode_check", sql`${table.publicationMode} in ('automatic', 'explicit')`),
    check("chat_endpoints_execution_policy_check", sql`${table.externalExecutionPolicy} in ('restricted', 'agent')`),
    check("chat_endpoints_email_policy_check", sql`${table.provider} <> 'agentmail' or (${table.publicationMode} = 'explicit' and ${table.externalExecutionPolicy} = 'agent')`),
    check(
      "chat_endpoints_provider_check",
      sql`${table.provider} in ('slack', 'github', 'discord', 'microsoft-teams', 'telegram', 'agentmail', 'imessage-photon', 'openwa')`,
    ),
    check(
      "chat_endpoints_inflight_mode_check",
      sql`${table.inflightMode} in ('steer', 'queue')`,
    ),
    check(
      "chat_endpoints_policy_revision_check",
      sql`${table.policyRevision} >= 0`,
    ),
    check(
      "chat_endpoints_status_check",
      sql`${table.status} in ('draft', 'verifying', 'active', 'paused', 'attention', 'revoked', 'archived')`,
    ),
    check(
      "chat_endpoints_deployment_check",
      sql`${table.deploymentMode} in ('direct', 'relay')`,
    ),
    check(
      "chat_endpoints_concurrency_check",
      sql`${table.concurrencyPolicy} in ('burst', 'queue', 'debounce', 'drop', 'concurrent')`,
    ),
    index("chat_endpoints_company_idx").on(table.companyId),
    index("chat_endpoints_agent_idx").on(
      table.companyId,
      table.assignedAgentId,
    ),
    index("chat_endpoints_status_idx").on(table.companyId, table.status),
    uniqueIndex("chat_endpoints_public_id_uq").on(table.publicId),
    uniqueIndex("chat_endpoints_agentmail_inbox_uq")
      .on(table.botExternalId)
      .where(sql`${table.provider} = 'agentmail' and ${table.status} != 'archived' and ${table.botExternalId} is not null`),
    uniqueIndex("chat_endpoints_connection_uq").on(table.connectionId),
    // A native provider identity can back only one live Paperclip endpoint.
    // Historical archived/revoked endpoints retain attribution without
    // preventing an operator from deliberately reusing the provider bot later.
    uniqueIndex("chat_endpoints_live_bot_external_uq")
      .on(table.provider, table.providerAccountId, table.botExternalId)
      .where(
        sql`${table.status} in ('verifying', 'active', 'paused', 'attention')
          and ${table.providerAccountId} is not null
          and ${table.botExternalId} is not null`,
      ),
    // One Discord application can be installed in many guilds, but it remains
    // one native bot identity. Excluding providerAccountId closes the race
    // where concurrent setup in two guilds could otherwise claim that bot for
    // two Paperclip agents after both application-level prechecks passed.
    uniqueIndex("chat_endpoints_photon_number_uq")
      .on(table.botExternalId)
      .where(sql`${table.provider} = 'imessage-photon' and ${table.status} <> 'archived' and ${table.botExternalId} is not null`),
    uniqueIndex("chat_endpoints_openwa_account_uq")
      .on(table.providerAccountId)
      .where(sql`${table.provider} = 'openwa' and ${table.status} <> 'archived' and ${table.providerAccountId} is not null`),
    uniqueIndex("chat_endpoints_openwa_number_uq")
      .on(table.botExternalId)
      .where(sql`${table.provider} = 'openwa' and ${table.status} <> 'archived' and ${table.botExternalId} is not null`),
    uniqueIndex("chat_endpoints_live_discord_bot_external_uq")
      .on(table.provider, table.botExternalId)
      .where(
        sql`${table.provider} = 'discord'
          and ${table.status} in ('verifying', 'active', 'paused', 'attention')
          and ${table.botExternalId} is not null`,
      ),
    // GitHub App and Microsoft Bot application ids are provider-global bot
    // identities. Their mutable owner/tenant coordinate is useful metadata,
    // but it cannot be part of the exclusivity key: an App transfer or a
    // multi-tenant service principal must never let one native bot represent
    // two Paperclip agents through two different webhook URLs.
    uniqueIndex("chat_endpoints_live_global_app_bot_external_uq")
      .on(table.provider, table.botExternalId)
      .where(
        sql`${table.provider} in ('github', 'microsoft-teams')
          and ${table.status} in ('verifying', 'active', 'paused', 'attention')
          and ${table.botExternalId} is not null`,
      ),
    // GitHub App verification does not expose the bot user's numeric id, so
    // retain an equivalent live-slot constraint on the provider-native name.
    uniqueIndex("chat_endpoints_live_bot_username_uq")
      .on(table.provider, table.providerAccountId, table.botUsername)
      .where(
        sql`${table.status} in ('verifying', 'active', 'paused', 'attention')
          and ${table.providerAccountId} is not null
          and ${table.botUsername} is not null`,
      ),
    unique("chat_endpoints_company_id_uq").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.assignedAgentId],
      foreignColumns: [agents.companyId, agents.id],
      name: "chat_endpoints_company_agent_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.connectionId],
      foreignColumns: [toolConnections.companyId, toolConnections.id],
      name: "chat_endpoints_company_connection_fk",
    }).onDelete("cascade"),
  ],
);
export const chatEndpointResources = pgTable(
  "chat_endpoint_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    type: text("type").notNull(),
    providerResourceId: text("provider_resource_id").notNull(),
    parentProviderResourceId: text("parent_provider_resource_id"),
    label: text("label").notNull(),
    detail: text("detail"),
    providerUrl: text("provider_url"),
    availability: text("availability")
      .$type<ChatResourceAvailability>()
      .notNull()
      .default("available"),
    enabled: boolean("enabled").notNull().default(false),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    settings: jsonb("settings")
      .$type<OpenwaChatSettings | Record<string, never>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_endpoint_resources_availability_check",
      sql`${table.availability} in ('available', 'unavailable', 'removed')`,
    ),
    index("chat_endpoint_resources_endpoint_idx").on(
      table.companyId,
      table.endpointId,
    ),
    uniqueIndex("chat_endpoint_resources_external_uq").on(
      table.endpointId,
      table.type,
      table.providerResourceId,
    ),
    unique("chat_endpoint_resources_company_id_uq").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_endpoint_resources_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatExternalPrincipals = pgTable(
  "chat_external_principals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ChatProvider>().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    externalId: text("external_id").notNull(),
    kind: text("kind").$type<ChatPrincipalKind>().notNull().default("user"),
    displayName: text("display_name"),
    handle: text("handle"),
    avatarUrl: text("avatar_url"),
    isBot: boolean("is_bot").notNull().default(false),
    alternateExternalIds: text("alternate_external_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_external_principals_provider_check",
      sql`${table.provider} in ('slack', 'github', 'discord', 'microsoft-teams', 'telegram', 'agentmail', 'imessage-photon', 'openwa')`,
    ),
    check(
      "chat_external_principals_kind_check",
      sql`${table.kind} in ('user', 'bot', 'app', 'system')`,
    ),
    index("chat_external_principals_company_idx").on(table.companyId),
    uniqueIndex("chat_external_principals_external_uq").on(
      table.companyId,
      table.provider,
      table.providerAccountId,
      table.externalId,
    ),
    unique("chat_external_principals_company_id_uq").on(
      table.companyId,
      table.id,
    ),
  ],
);

export const chatIdentityLinks = pgTable(
  "chat_identity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    principalId: uuid("principal_id").notNull(),
    paperclipUserId: text("paperclip_user_id"),
    status: text("status")
      .$type<ChatIdentityLinkStatus>()
      .notNull()
      .default("pending"),
    confirmationTokenHash: text("confirmation_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_identity_links_status_check",
      sql`${table.status} in ('pending', 'linked', 'revoked', 'expired')`,
    ),
    index("chat_identity_links_user_idx").on(
      table.companyId,
      table.paperclipUserId,
    ),
    uniqueIndex("chat_identity_links_endpoint_principal_uq").on(
      table.endpointId,
      table.principalId,
    ),
    unique("chat_identity_links_company_id_uq").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_identity_links_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.principalId],
      foreignColumns: [
        chatExternalPrincipals.companyId,
        chatExternalPrincipals.id,
      ],
      name: "chat_identity_links_company_principal_fk",
    }).onDelete("cascade"),
  ],
);

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    resourceId: uuid("resource_id").references(() => chatEndpointResources.id, {
      onDelete: "set null",
    }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "restrict" }),
    externalConversationId: text("external_conversation_id").notNull(),
    externalThreadId: text("external_thread_id").notNull().default(""),
    // Providers with linear conversations (DMs, Telegram groups, Teams group
    // chats) reuse one native thread id. A generation preserves the native id
    // used for replies while allowing completed Paperclip tasks to roll over.
    sessionGeneration: integer("session_generation").notNull().default(1),
    externalLabel: text("external_label").notNull(),
    providerUrl: text("provider_url"),
    isDirectMessage: boolean("is_direct_message").notNull().default(false),
    // Immutable initial task context, never refreshed from endpoint settings.
    communicationGuidance: text("communication_guidance"),
    state: text("state").notNull().default("active"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_conversations_state_check",
      sql`${table.state} in ('active', 'waiting', 'completed', 'unavailable', 'endpoint_removed')`,
    ),
    index("chat_conversations_issue_idx").on(table.companyId, table.issueId),
    uniqueIndex("chat_conversations_thread_uq").on(
      table.endpointId,
      table.externalConversationId,
      table.externalThreadId,
      table.sessionGeneration,
    ),
    unique("chat_conversations_company_id_uq").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
      name: "chat_conversations_company_issue_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_conversations_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.resourceId],
      foreignColumns: [
        chatEndpointResources.companyId,
        chatEndpointResources.id,
      ],
      name: "chat_conversations_company_resource_fk",
    }),
  ],
);

export const chatDeliveries = pgTable(
  "chat_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    conversationId: uuid("conversation_id").references(
      () => chatConversations.id,
      {
        onDelete: "set null",
      },
    ),
    principalId: uuid("principal_id").references(
      () => chatExternalPrincipals.id,
      {
        onDelete: "set null",
      },
    ),
    providerEventId: text("provider_event_id").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    eventKind: text("event_kind").$type<ChatEventKind>().notNull(),
    normalizedEvent: jsonb("normalized_event")
      .$type<Record<string, unknown>>()
      .notNull(),
    state: text("state")
      .$type<ChatDeliveryState>()
      .notNull()
      .default("received"),
    attempts: integer("attempts").notNull().default(0),
    redactedError: text("redacted_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    triggerClass: text("trigger_class").$type<OpenwaTriggerClass>(),
    principalRole: text("principal_role").$type<OpenwaPrincipalRole>(),
    answerState: text("answer_state").$type<ChatAnswerState>(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_deliveries_state_check",
      sql`${table.state} in ('received', 'filtered', 'processing', 'processed', 'retry', 'failed')`,
    ),
    check(
      "chat_deliveries_trigger_class_check",
      sql`${table.triggerClass} is null or ${table.triggerClass} in ('owner', 'other', 'grant')`,
    ),
    check(
      "chat_deliveries_principal_role_check",
      sql`${table.principalRole} is null or ${table.principalRole} in ('owner', 'allowed', 'outside_allowlist', 'denylisted')`,
    ),
    check(
      "chat_deliveries_answer_state_check",
      sql`${table.answerState} is null or ${table.answerState} in ('pending', 'answered', 'silenced', 'handed_off')`,
    ),
    index("chat_deliveries_work_idx").on(table.state, table.nextAttemptAt),
    index("chat_deliveries_pending_answer_idx")
      .on(table.endpointId, table.conversationId, table.receivedAt)
      .where(sql`${table.answerState} = 'pending'`),
    unique("chat_deliveries_company_id_uq").on(table.companyId, table.id),
    uniqueIndex("chat_deliveries_event_uq").on(
      table.endpointId,
      table.providerEventId,
    ),
    uniqueIndex("chat_deliveries_dedupe_uq").on(
      table.endpointId,
      table.deduplicationKey,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_deliveries_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
      name: "chat_deliveries_company_conversation_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.principalId],
      foreignColumns: [
        chatExternalPrincipals.companyId,
        chatExternalPrincipals.id,
      ],
      name: "chat_deliveries_company_principal_fk",
    }),
  ],
);

export const chatPublications = pgTable(
  "chat_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "restrict" }),
    commentId: uuid("comment_id").references(() => issueComments.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<SafeChatPublicationPayload>().notNull(),
    state: text("state")
      .$type<ChatPublicationState>()
      .notNull()
      .default("pending"),
    providerMessageId: text("provider_message_id"),
    providerUrl: text("provider_url"),
    attempts: integer("attempts").notNull().default(0),
    redactedError: text("redacted_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_publications_state_check",
      sql`${table.state} in ('pending', 'streaming', 'published', 'retry', 'delivery_unknown', 'failed', 'cancelled', 'awaiting_consent')`,
    ),
    uniqueIndex("chat_publications_company_id_uq").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
      name: "chat_publications_company_issue_fk",
    }),
    // Retain the single-column SET NULL action above. The additional tenant
    // key uses NO ACTION so deletion clears only comment_id, never company_id.
    foreignKey({
      columns: [table.companyId, table.commentId],
      foreignColumns: [issueComments.companyId, issueComments.id],
      name: "chat_publications_company_comment_fk",
    }),
    index("chat_publications_work_idx").on(table.state, table.nextAttemptAt),
    uniqueIndex("chat_publications_idempotency_uq").on(
      table.companyId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_publications_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
      name: "chat_publications_company_conversation_fk",
    }).onDelete("cascade"),
  ],
);

export const chatMessageLinks = pgTable(
  "chat_message_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    deliveryId: uuid("delivery_id").references(() => chatDeliveries.id, {
      onDelete: "set null",
    }),
    publicationId: uuid("publication_id").references(
      () => chatPublications.id,
      { onDelete: "set null" },
    ),
    commentId: uuid("comment_id").references(() => issueComments.id, {
      onDelete: "set null",
    }),
    providerMessageId: text("provider_message_id").notNull(),
    direction: text("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_message_links_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_message_links_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.deliveryId],
      foreignColumns: [chatDeliveries.companyId, chatDeliveries.id],
      name: "chat_message_links_company_delivery_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.publicationId],
      foreignColumns: [chatPublications.companyId, chatPublications.id],
      name: "chat_message_links_company_publication_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.commentId],
      foreignColumns: [issueComments.companyId, issueComments.id],
      name: "chat_message_links_company_comment_fk",
    }),
    uniqueIndex("chat_message_links_provider_message_uq").on(
      table.endpointId,
      table.conversationId,
      table.providerMessageId,
    ),
    foreignKey({
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
      name: "chat_message_links_company_conversation_fk",
    }).onDelete("cascade"),
  ],
);

export const chatActions = pgTable(
  "chat_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    deliveryId: uuid("delivery_id").references(() => chatDeliveries.id, {
      onDelete: "set null",
    }),
    conversationId: uuid("conversation_id"),
    principalId: uuid("principal_id"),
    kind: text("kind").notNull(),
    providerActionId: text("provider_action_id").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("received"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_actions_provider_action_uq").on(
      table.endpointId,
      table.providerActionId,
    ),
    foreignKey({
      columns: [table.companyId, table.deliveryId],
      foreignColumns: [chatDeliveries.companyId, chatDeliveries.id],
      name: "chat_actions_company_delivery_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
      name: "chat_actions_company_conversation_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.principalId],
      foreignColumns: [
        chatExternalPrincipals.companyId,
        chatExternalPrincipals.id,
      ],
      name: "chat_actions_company_principal_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_actions_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatAgentRoutes = pgTable(
  "chat_agent_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceEndpointId: uuid("source_endpoint_id").notNull(),
    destinationEndpointId: uuid("destination_endpoint_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    triggerMode: text("trigger_mode").notNull().default("explicit_mention"),
    maxHops: integer("max_hops").notNull().default(1),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_agent_routes_hops_check",
      sql`${table.maxHops} between 1 and 8`,
    ),
    uniqueIndex("chat_agent_routes_pair_uq").on(
      table.sourceEndpointId,
      table.destinationEndpointId,
    ),
    foreignKey({
      columns: [table.companyId, table.sourceEndpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_agent_routes_company_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.destinationEndpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_agent_routes_company_destination_fk",
    }).onDelete("cascade"),
  ],
);

export const chatEndpointLeases = pgTable(
  "chat_endpoint_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    leaseKey: text("lease_key").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_endpoint_leases_active_uq").on(
      table.endpointId,
      table.leaseKey,
    ),
    index("chat_endpoint_leases_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_endpoint_leases_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatSdkState = pgTable(
  "chat_sdk_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    stateKey: text("state_key").notNull(),
    version: integer("version").notNull().default(1),
    value: jsonb("value").$type<unknown>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_sdk_state_key_uq").on(table.endpointId, table.stateKey),
    index("chat_sdk_state_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_sdk_state_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatEndpointOwners = pgTable(
  "chat_endpoint_owners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    identityLinkId: uuid("identity_link_id").notNull(),
    addedByUserId: text("added_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_endpoint_owners_link_uq").on(
      table.endpointId,
      table.identityLinkId,
    ),
    unique("chat_endpoint_owners_company_id_uq").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_endpoint_owners_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.identityLinkId],
      foreignColumns: [chatIdentityLinks.companyId, chatIdentityLinks.id],
      name: "chat_endpoint_owners_company_identity_link_fk",
    }).onDelete("cascade"),
  ],
);

export const chatOpenwaLinkedSessions = pgTable(
  "chat_openwa_linked_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    sessionId: text("session_id").notNull(),
    label: text("label").notNull(),
    phoneMasked: text("phone_masked"),
    pushName: text("push_name"),
    secretId: uuid("secret_id").notNull(),
    gatewayKeyId: text("gateway_key_id").notNull(),
    allowedChats: jsonb("allowed_chats")
      .$type<OpenwaLinkedChat[]>()
      .notNull()
      .default([]),
    status: text("status").$type<OpenwaLinkedSessionStatus>().notNull().default("active"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_openwa_linked_sessions_endpoint_session_uq").on(
      table.endpointId,
      table.sessionId,
    ),
    check(
      "chat_openwa_linked_sessions_status_check",
      sql`${table.status} in ('active', 'unavailable')`,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_openwa_linked_sessions_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatSenderRules = pgTable(
  "chat_sender_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    list: text("list").$type<ChatSenderRuleList>().notNull(),
    e164: text("e164").notNull(),
    label: text("label"),
    createdByUserId: text("created_by_user_id"),
    createdByPrincipalId: uuid("created_by_principal_id").references(
      () => chatExternalPrincipals.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("chat_sender_rules_list_check", sql`${table.list} in ('allow', 'deny')`),
    check("chat_sender_rules_e164_check", sql`${table.e164} ~ '^[+][1-9][0-9]{6,14}$'`),
    uniqueIndex("chat_sender_rules_entry_uq").on(
      table.endpointId,
      table.list,
      table.e164,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_sender_rules_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.createdByPrincipalId],
      foreignColumns: [chatExternalPrincipals.companyId, chatExternalPrincipals.id],
      name: "chat_sender_rules_company_principal_fk",
    }),
  ],
);

export const chatScheduledWakes = pgTable(
  "chat_scheduled_wakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    chatKey: text("chat_key").notNull(),
    kind: text("kind").$type<ChatScheduledWakeKind>().notNull(),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    state: text("state")
      .$type<ChatScheduledWakeState>()
      .notNull()
      .default("pending"),
    relatedId: uuid("related_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_scheduled_wakes_kind_check",
      sql`${table.kind} in ('owner_absent', 'approval_reminder')`,
    ),
    check(
      "chat_scheduled_wakes_state_check",
      sql`${table.state} in ('pending', 'fired', 'cancelled')`,
    ),
    index("chat_scheduled_wakes_pending_fire_idx")
      .on(table.fireAt)
      .where(sql`${table.state} = 'pending'`),
    uniqueIndex("chat_scheduled_wakes_pending_absent_uq")
      .on(table.endpointId, table.chatKey)
      .where(sql`${table.kind} = 'owner_absent' and ${table.state} = 'pending'`),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_scheduled_wakes_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatOwnerApprovalRequests = pgTable(
  "chat_owner_approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    originChatKey: text("origin_chat_key").notNull(),
    originConversationId: uuid("origin_conversation_id").references(
      () => chatConversations.id,
      { onDelete: "set null" },
    ),
    interactionId: uuid("interaction_id").references(
      () => issueThreadInteractions.id,
      { onDelete: "set null" },
    ),
    requestedByPrincipalId: uuid("requested_by_principal_id").references(
      () => chatExternalPrincipals.id,
      { onDelete: "set null" },
    ),
    requestedInRunId: uuid("requested_in_run_id").references(
      () => heartbeatRuns.id,
      { onDelete: "set null" },
    ),
    categories: text("categories").array().$type<OpenwaGrantCategory[]>().notNull(),
    scope: text("scope").$type<ChatOwnerGrantScope>().notNull(),
    summary: text("summary").notNull(),
    proposedAction: text("proposed_action").notNull(),
    status: text("status")
      .$type<ChatOwnerApprovalStatus>()
      .notNull()
      .default("pending"),
    reminderCount: integer("reminder_count").notNull().default(0),
    resolvedVia: text("resolved_via").$type<ChatOwnerApprovalChannel>(),
    resolvedByUserId: text("resolved_by_user_id"),
    ownerText: text("owner_text"),
    agentConditions: text("agent_conditions"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_owner_approval_requests_categories_check",
      sql`cardinality(${table.categories}) > 0 and ${table.categories} <@ array['create_task', 'external_tools', 'cross_chat_send', 'wa_admin', 'gateway_admin', 'reply_outside_allowlist', 'reply']::text[]`,
    ),
    check(
      "chat_owner_approval_requests_scope_check",
      sql`${table.scope} in ('one_action', 'requester')`,
    ),
    check(
      "chat_owner_approval_requests_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      "chat_owner_approval_requests_resolved_via_check",
      sql`${table.resolvedVia} is null or ${table.resolvedVia} in ('whatsapp', 'paperclip')`,
    ),
    check(
      "chat_owner_approval_requests_reminder_count_check",
      sql`${table.reminderCount} >= 0`,
    ),
    index("chat_owner_approval_requests_status_idx").on(
      table.endpointId,
      table.status,
    ),
    unique("chat_owner_approval_requests_company_id_uq").on(
      table.companyId,
      table.id,
    ),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_owner_approval_requests_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.originConversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
      name: "chat_owner_approval_requests_company_conversation_fk",
    }),
    foreignKey({
      columns: [table.companyId, table.requestedByPrincipalId],
      foreignColumns: [chatExternalPrincipals.companyId, chatExternalPrincipals.id],
      name: "chat_owner_approval_requests_company_principal_fk",
    }),
  ],
);

export const chatOutboundMessages = pgTable(
  "chat_outbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    chatKey: text("chat_key").notNull(),
    source: text("source").$type<ChatOutboundMessageSource>().notNull(),
    runId: uuid("run_id").references(() => heartbeatRuns.id, {
      onDelete: "set null",
    }),
    providerMessageId: text("provider_message_id"),
    state: text("state")
      .$type<ChatOutboundMessageState>()
      .notNull()
      .default("pending"),
    bodyHash: text("body_hash").notNull(),
    clientNonce: text("client_nonce").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_outbound_messages_source_check",
      sql`${table.source} in ('tool', 'publication', 'approval')`,
    ),
    check(
      "chat_outbound_messages_state_check",
      sql`${table.state} in ('pending', 'sent', 'uncertain', 'failed')`,
    ),
    uniqueIndex("chat_outbound_messages_provider_message_uq")
      .on(table.endpointId, table.providerMessageId)
      .where(sql`${table.providerMessageId} is not null`),
    index("chat_outbound_messages_chat_state_idx").on(
      table.endpointId,
      table.chatKey,
      table.state,
    ),
    index("chat_outbound_messages_sent_at_idx").on(
      table.endpointId,
      table.sentAt,
    ),
    unique("chat_outbound_messages_company_id_uq").on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_outbound_messages_company_endpoint_fk",
    }).onDelete("cascade"),
  ],
);

export const chatOwnerApprovalBubbles = pgTable(
  "chat_owner_approval_bubbles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    requestId: uuid("request_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    outboundMessageId: uuid("outbound_message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_owner_approval_bubbles_outbound_uq").on(
      table.endpointId,
      table.outboundMessageId,
    ),
    index("chat_owner_approval_bubbles_request_idx").on(table.requestId),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_owner_approval_bubbles_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.requestId],
      foreignColumns: [chatOwnerApprovalRequests.companyId, chatOwnerApprovalRequests.id],
      name: "chat_owner_approval_bubbles_company_request_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.ownerId],
      foreignColumns: [chatEndpointOwners.companyId, chatEndpointOwners.id],
      name: "chat_owner_approval_bubbles_company_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.outboundMessageId],
      foreignColumns: [chatOutboundMessages.companyId, chatOutboundMessages.id],
      name: "chat_owner_approval_bubbles_company_outbound_fk",
    }).onDelete("cascade"),
  ],
);

export const chatOwnerGrants = pgTable(
  "chat_owner_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    requestId: uuid("request_id").notNull(),
    originChatKey: text("origin_chat_key").notNull(),
    requesterPrincipalId: uuid("requester_principal_id").references(
      () => chatExternalPrincipals.id,
      { onDelete: "set null" },
    ),
    category: text("category").$type<OpenwaGrantCategory>().notNull(),
    scope: text("scope").$type<ChatOwnerGrantScope>().notNull(),
    status: text("status")
      .$type<ChatOwnerGrantStatus>()
      .notNull()
      .default("live"),
    approvedByUserId: text("approved_by_user_id"),
    approvedVia: text("approved_via").$type<ChatOwnerApprovalChannel>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByRunId: uuid("consumed_by_run_id").references(
      () => heartbeatRuns.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_owner_grants_category_check",
      sql`${table.category} in ('create_task', 'external_tools', 'cross_chat_send', 'wa_admin', 'gateway_admin', 'reply_outside_allowlist', 'reply')`,
    ),
    check(
      "chat_owner_grants_scope_check",
      sql`${table.scope} in ('one_action', 'requester')`,
    ),
    check(
      "chat_owner_grants_status_check",
      sql`${table.status} in ('live', 'consumed', 'revoked', 'expired')`,
    ),
    check(
      "chat_owner_grants_approved_via_check",
      sql`${table.approvedVia} in ('whatsapp', 'paperclip')`,
    ),
    index("chat_owner_grants_lookup_idx").on(
      table.endpointId,
      table.originChatKey,
      table.requesterPrincipalId,
      table.status,
    ),
    index("chat_owner_grants_request_idx").on(table.requestId),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_owner_grants_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.requestId],
      foreignColumns: [chatOwnerApprovalRequests.companyId, chatOwnerApprovalRequests.id],
      name: "chat_owner_grants_company_request_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.requesterPrincipalId],
      foreignColumns: [chatExternalPrincipals.companyId, chatExternalPrincipals.id],
      name: "chat_owner_grants_company_principal_fk",
    }),
  ],
);

export const chatAuditEntries = pgTable(
  "chat_audit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    conversationId: uuid("conversation_id").references(
      () => chatConversations.id,
      { onDelete: "set null" },
    ),
    chatKey: text("chat_key"),
    kind: text("kind").$type<ChatAuditEntryKind>().notNull(),
    actorKind: text("actor_kind").$type<ChatAuditActorKind>().notNull(),
    actorRef: text("actor_ref"),
    runId: uuid("run_id").references(() => heartbeatRuns.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    content: jsonb("content").$type<Record<string, unknown>>(),
    contentPurgeAt: timestamp("content_purge_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_audit_entries_kind_check",
      sql`${table.kind} in ('trigger_admitted', 'trigger_filtered', 'message_sent', 'publication_suppressed', 'tool_called', 'approval_requested', 'approval_reminded', 'approval_resolved', 'approval_cancelled', 'config_changed', 'group_added', 'group_left', 'session_health', 'linked_read')`,
    ),
    check(
      "chat_audit_entries_actor_kind_check",
      sql`${table.actorKind} in ('user', 'agent', 'chat_principal', 'system')`,
    ),
    index("chat_audit_entries_endpoint_occurred_idx").on(
      table.endpointId,
      table.occurredAt.desc(),
    ),
    index("chat_audit_entries_content_purge_idx")
      .on(table.contentPurgeAt)
      .where(sql`${table.content} is not null`),
    foreignKey({
      columns: [table.companyId, table.endpointId],
      foreignColumns: [chatEndpoints.companyId, chatEndpoints.id],
      name: "chat_audit_entries_company_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
      name: "chat_audit_entries_company_conversation_fk",
    }),
  ],
);
