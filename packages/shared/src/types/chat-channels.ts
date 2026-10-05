/** Provider-neutral contracts for Paperclip's native external chat subsystem. */
export const CHAT_PROVIDERS = [
  "slack",
  "github",
  "discord",
  "microsoft-teams",
  "telegram",
  "agentmail",
  "imessage-photon",
  "openwa",
] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];

export const CHAT_ENDPOINT_STATUSES = [
  "draft",
  "verifying",
  "active",
  "paused",
  "attention",
  "revoked",
  "archived",
] as const;
export type ChatEndpointStatus = (typeof CHAT_ENDPOINT_STATUSES)[number];

export const CHAT_DEPLOYMENT_MODES = ["direct", "relay"] as const;
export type ChatDeploymentMode = (typeof CHAT_DEPLOYMENT_MODES)[number];

export const CHAT_CONCURRENCY_POLICIES = [
  "burst",
  "queue",
  "debounce",
  "drop",
  "concurrent",
] as const;
export type ChatConcurrencyPolicy = (typeof CHAT_CONCURRENCY_POLICIES)[number];

export const CHAT_EVENT_KINDS = [
  "mention",
  "message",
  "direct_message",
  "message_updated",
  "message_deleted",
  "message_restored",
  "reaction_added",
  "reaction_removed",
  "action",
  "modal_submitted",
  "modal_closed",
  "slash_command",
  "file_shared",
  "installation",
  "uninstallation",
  "unknown",
] as const;
export type ChatEventKind = (typeof CHAT_EVENT_KINDS)[number];

export const CHAT_DELIVERY_STATES = [
  "received",
  "filtered",
  "processing",
  "processed",
  "retry",
  "failed",
] as const;
export type ChatDeliveryState = (typeof CHAT_DELIVERY_STATES)[number];

export const CHAT_PUBLICATION_STATES = [
  "pending",
  "awaiting_consent",
  "streaming",
  "published",
  "retry",
  "delivery_unknown",
  "failed",
  "cancelled",
] as const;
export type ChatPublicationState = (typeof CHAT_PUBLICATION_STATES)[number];

export const CHAT_FILE_TRANSFER_PHASES = [
  "consent_pending",
  "consent_sending",
  "consent_unknown",
  "awaiting_consent",
  "upload_pending",
  "uploading",
  "upload_unknown",
  "file_info_pending",
  "file_info_sending",
  "file_info_unknown",
  "delivered",
  "declined",
  "expired",
  "cancelled",
  "conflict",
] as const;
export type ChatFileTransferPhase = (typeof CHAT_FILE_TRANSFER_PHASES)[number];

/** Closed presentation only: never provider URLs, credentials or private state. */
export interface ChatFileTransferSummary {
  provider: "microsoft-teams";
  phase: ChatFileTransferPhase;
  filename: string;
  expiresAt?: string | null;
  /** Monotonic durable row revision, not a schema version. */
  version: number;
}

export type ChatFileTransferResolutionPrecondition = Pick<
  ChatFileTransferSummary,
  "phase" | "version"
>;

export const CHAT_CONVERSATION_STATES = [
  "active",
  "waiting",
  "completed",
  "unavailable",
  "endpoint_removed",
] as const;
export type ChatConversationState = (typeof CHAT_CONVERSATION_STATES)[number];

export const CHAT_PRINCIPAL_KINDS = ["user", "bot", "app", "system"] as const;
export type ChatPrincipalKind = (typeof CHAT_PRINCIPAL_KINDS)[number];

export const CHAT_IDENTITY_LINK_STATUSES = [
  "pending",
  "linked",
  "revoked",
  "expired",
] as const;
export type ChatIdentityLinkStatus =
  (typeof CHAT_IDENTITY_LINK_STATUSES)[number];

export const CHAT_RESOURCE_AVAILABILITIES = [
  "available",
  "unavailable",
  "removed",
] as const;
export type ChatResourceAvailability =
  (typeof CHAT_RESOURCE_AVAILABILITIES)[number];

export interface ChatAdapterCapabilities {
  threads: boolean;
  directMessages: boolean;
  nativeStreaming: boolean;
  messageEdits: boolean;
  messageDeletes: boolean;
  reactions: boolean;
  files: boolean;
  cards: boolean;
  actions: boolean;
  modals: boolean;
  slashCommands: boolean;
  ephemeralMessages: boolean;
  proactiveDirectMessages: boolean;
}

export interface ChatEndpointBehaviorPolicy {
  /** Defaults to queue and is not exposed in the initial settings UI. */
  concurrency: ChatConcurrencyPolicy;
  allowDirectMessages: boolean;
  allowGroupChats: boolean;
  allowUnlinkedPeople: boolean;
}

export const CHAT_CALLBACK_SURFACE_STATUSES = [
  "current",
  "stale",
  "unverified",
] as const;
export type ChatCallbackSurfaceStatus =
  (typeof CHAT_CALLBACK_SURFACE_STATUSES)[number];

export interface ChatEndpointCallbackSurfaceState {
  status: ChatCallbackSurfaceStatus;
  observedAt?: string | null;
}

export interface ChatEndpointCallbackSurfaces {
  events: ChatEndpointCallbackSurfaceState;
  interactivity: ChatEndpointCallbackSurfaceState;
  slashCommands: ChatEndpointCallbackSurfaceState;
}

export interface SlackAppConfiguration {
  appName: string;
  botName: string;
  command: string;
}

export interface ChatEndpointSetupState {
  github?: {
    stage: "connect" | "install" | "repositories" | "verify" | "identity" | "behavior" | "test";
    appSlug?: string;
    installationUrl?: string;
    managementUrl?: string;
    registrationStatus?: "pending" | "completed" | "failed";
  };
  step: "choose_agent" | "provider_setup" | "test" | "complete";
  /** Server-generated boundary; only provider events at or after this time can complete setup. */
  testStartedAt?: string | null;
  /** Onboarding was finished without requiring a full conversation test. */
  testSkipped?: boolean;
  /** Set only after the provider has delivered a signed callback challenge. */
  webhookVerifiedAt?: string | null;
  authorizationUrl?: string | null;
  providerUrl?: string | null;
  command?: string | null;
  slackApp?: SlackAppConfiguration;
  webhookUrl?: string | null;
  messagingEndpoint?: string | null;
  /** Safe presence signal only; the secret value is returned once by its generation endpoint. */
  webhookSecretConfigured?: boolean;
  /** Provider callback surfaces observed at the endpoint's current public URL. */
  callbackSurfaces?: ChatEndpointCallbackSurfaces;
  /** True when at least one previously observed callback still targets an old public URL. */
  callbacksNeedUpdate?: boolean;
}

export interface ChatEndpointSetupSecret {
  webhookSecret: string;
}

export type ChannelPublicationMode = "automatic" | "explicit";
export type ExternalMessageExecutionPolicy = "restricted" | "agent";

export interface ChatEndpoint {
  /** Additional presentation instructions captured only for newly created tasks. */
  communicationInstructions?: string;
  id: string;
  companyId: string;
  connectionId: string;
  /** Older clients omit these fields; defaults are automatic/restricted. */
  publicationMode?: ChannelPublicationMode;
  externalExecutionPolicy?: ExternalMessageExecutionPolicy;
  provider: ChatProvider;
  publicId: string;
  status: ChatEndpointStatus;
  deploymentMode: ChatDeploymentMode;
  assignedAgentId: string;
  assignedAgentName?: string | null;
  sponsorUserId?: string | null;
  providerAccountId?: string | null;
  providerAccountLabel?: string | null;
  botExternalId?: string | null;
  botUsername?: string | null;
  botLabel?: string | null;
  botAvatarUrl?: string | null;
  photonAllocation?: "dedicated" | "shared";
  policy?: OpenwaEndpointPolicy;
  policyRevision?: number;
  inflightMode?: ChatInflightMode;
  allowDirectMessages: boolean;
  allowGroupChats: boolean;
  allowUnlinkedPeople: boolean;
  replyMode: "subscribed";
  capabilities: ChatAdapterCapabilities;
  setup: ChatEndpointSetupState;
  healthMessage?: string | null;
  lastError?: string | null;
  lastActivityAt?: string | null;
  lastPublicationAt?: string | null;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatEndpointResource {
  id: string;
  companyId: string;
  endpointId: string;
  type: string;
  providerResourceId: string;
  parentProviderResourceId?: string | null;
  label: string;
  detail?: string | null;
  providerUrl?: string | null;
  availability: ChatResourceAvailability;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  participants?: string[];
}

export interface ChatExternalPrincipal {
  id: string;
  companyId: string;
  provider: ChatProvider;
  providerAccountId: string;
  externalId: string;
  kind: ChatPrincipalKind;
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  isBot: boolean;
  lastSeenAt?: string | null;
}

export interface ChatIdentityLink {
  id: string;
  companyId: string;
  endpointId: string;
  principalId: string;
  /** Latest discovery-only connect command received by this endpoint. */
  lastConnectAt?: string | null;
  externalLabel: string;
  externalDetail?: string | null;
  paperclipUserId?: string | null;
  paperclipUserLabel?: string | null;
  status: ChatIdentityLinkStatus;
  expiresAt?: string | null;
  confirmedAt?: string | null;
  revokedAt?: string | null;
}

export interface ChatConversation {
  id: string;
  companyId: string;
  endpointId: string;
  resourceId?: string | null;
  issueId: string;
  issueIdentifier?: string | null;
  issueTitle?: string | null;
  externalConversationId: string;
  externalThreadId: string;
  sessionGeneration: number;
  externalLabel: string;
  externalUrl?: string | null;
  isDirectMessage: boolean;
  state: ChatConversationState;
  lastPublicationStatus?: ChatPublicationState | null;
  lastActivityAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatDelivery {
  id: string;
  companyId: string;
  endpointId: string;
  conversationId?: string | null;
  principalId?: string | null;
  providerEventId: string;
  deduplicationKey: string;
  eventKind: ChatEventKind;
  state: ChatDeliveryState;
  attempts: number;
  summary?: string | null;
  redactedError?: string | null;
  receivedAt: string;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SafeExternalChatCardKind = "status" | "question" | "confirmation";

export type SafeExternalChatCardAction =
  | {
      type: "callback";
      actionId: string;
      label: string;
      style?: "default" | "primary" | "danger";
    }
  | {
      type: "link";
      label: string;
      url: string;
    };

export interface SafeExternalChatCard {
  schema: "paperclip.chat.card.v1";
  kind: SafeExternalChatCardKind;
  title: string;
  body?: string;
  actions?: SafeExternalChatCardAction[];
}

export interface SafeChatPublicationPayload {
  text: string;
  attachmentIds?: string[];
  interactionId?: string;
  card?: SafeExternalChatCard;
  /** Server-managed metadata for a logical publication split into durable messages. */
  transportPart?: {
    batchId: string;
    count: number;
    index: number;
    /** Server-managed provider rendering for this transport part. */
    mode?:
      "inline" | "discord_markdown_attachment" | "telegram_markdown_attachment";
    orderKey: string;
    /** Closed, server-generated Markdown fence wrappers; text remains an exact source slice. */
    prefix?: string;
    suffix?: string;
  };
  progressState?:
    | "queued"
    | "working"
    | "waiting_for_input"
    | "approval_needed"
    | "completed"
    | "failed";
}

export interface ChatPublication {
  id: string;
  companyId: string;
  endpointId: string;
  conversationId: string;
  issueId: string;
  commentId?: string | null;
  idempotencyKey: string;
  state: ChatPublicationState;
  providerMessageId?: string | null;
  providerUrl?: string | null;
  attempts: number;
  redactedError?: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export interface ChatPublicationSummary {
  id: string;
  state: ChatPublicationState;
  providerUrl?: string | null;
  attempts: number;
  redactedError?: string | null;
  nextAttemptAt?: string | null;
  publishedAt?: string | null;
  fileTransfer?: ChatFileTransferSummary;
}

export interface ChatPublicationBatchStatus {
  /** First unresolved part; a terminal nonpublished part for mixed outcomes. */
  publication: ChatPublicationSummary;
  total: number;
  published: number;
  /** Additive during rolling upgrades; missing settlement proof is not permission to dismiss. */
  parts?: ChatPublicationSummary[];
  awaitingConsent?: number;
  declined?: number;
  expired?: number;
  /** Excludes declined and expired. */
  cancelled?: number;
  /** published + declined + expired + cancelled, never failed or uncertain. */
  settled?: number;
  canDismiss?: boolean;
}

export interface ChatActivityItem {
  id: string;
  kind: "delivery" | "publication" | "action" | "health" | "repair";
  actionType?:
    | "slash_task_start"
    | "provider_effect"
    | "github_webhook_ingress"
    | "slack_session_sync"
    | "slack_session_stop";
  status: string;
  summary: string;
  detail?: string | null;
  createdAt: string;
  replayable?: boolean;
  resolutionActions?: Array<"mark_delivered" | "retry_anyway" | "cancel">;
  fileTransfer?: ChatFileTransferSummary;
}

export interface ExternalChannelBindingSummary {
  endpointId: string;
  provider: ChatProvider;
  botLabel?: string | null;
  externalLabel: string;
  externalUrl?: string | null;
  conversationId: string;
  publicationState?: ChatPublicationState | null;
  assignedAgentLocked: true;
}

export interface CreateChatEndpointInput {
  provider: ChatProvider;
  assignedAgentId: string;
  applicationId?: string;
  name?: string;
}

export interface UpdateChatEndpointInput {
  slackApp?: SlackAppConfiguration;
  communicationInstructions?: string;
  allowDirectMessages?: boolean;
  allowGroupChats?: boolean;
  allowUnlinkedPeople?: boolean;
}

export interface ConfigureChatEndpointInput {
  action: "configure" | "verify" | "pause" | "resume" | "reconnect" | "remove";
  credentials?: Record<string, string>;
  photon?: PhotonChannelConfiguration;
  openwa?: OpenwaChannelConfiguration;
}

export interface NormalizedChatEvent {
  providerEventId: string;
  kind: ChatEventKind;
  providerAccountId: string;
  principal: {
    externalId: string;
    kind: ChatPrincipalKind;
    displayName?: string;
    handle?: string;
    isBot?: boolean;
  };
  resource: {
    type: string;
    providerResourceId: string;
    parentProviderResourceId?: string;
    label: string;
    providerUrl?: string;
  };
  conversation: {
    externalConversationId: string;
    externalThreadId?: string;
    label: string;
    providerUrl?: string;
    isDirectMessage?: boolean;
  };
  message?: {
    providerMessageId: string;
    text: string;
    mentionedBot?: boolean;
    replyToProviderMessageId?: string;
    attachmentUrls?: string[];
  };
  raw: Record<string, unknown>;
}

/** Safe Photon project inspection; credentials and line tokens are never serialized. */
export interface PhotonProjectInspection {
  projectId: string;
  projectName: string;
  allocation: "dedicated" | "shared";
  eligible: boolean;
  lines: Array<{ lineId: string; phoneNumber: string; eligible: boolean; unavailableReason?: string }>;
}
export type PhotonChannelConfiguration =
  | { allocation?: "dedicated"; projectId: string; lineId: string }
  | { allocation: "shared"; projectId: string };

/** Nonsecret OpenWA setup choices; the API keys travel as write-only credentials. */
export interface OpenwaChannelConfiguration {
  baseUrl: string;
  sessionId: string;
  numberMode?: OpenwaNumberMode;
  attestations: { pacing: boolean; soleClient: boolean };
}

/** Read-only OpenWA gateway inspection; never carries keys or full phone numbers. */
export interface OpenwaGatewayInspection {
  baseUrl: string;
  gatewayVersion: string | null;
  pinnedVersion: string;
  engine: string | null;
  keyRole: "operator" | "admin" | "viewer";
  adminKey: { role: "operator" | "admin" | "viewer" } | null;
  warnings: string[];
  eligible: boolean;
  sessions: Array<{
    sessionId: string;
    name: string;
    status: string;
    maskedNumber: string | null;
    pushName: string | null;
    eligible: boolean;
    unavailableReason?: string;
  }>;
}

/** Read-only OpenWA endpoint health for Settings; never carries keys or full phone numbers. */
export interface OpenwaEndpointHealth {
  gatewayVersion: string | null;
  pinnedVersion: string;
  engine: string | null;
  session: {
    status: string | null;
    maskedNumber: string | null;
    restriction: { active: boolean; kind: string | null; expiresAt: string | null } | null;
  };
  pacing: { attested: boolean; observedAt: string | null };
  adminKeyConfigured: boolean;
  gatewayError: string | null;
  checkedAt: string;
}

export const OPENWA_LINKED_SESSION_STATUSES = ["active", "unavailable"] as const;
export type OpenwaLinkedSessionStatus = (typeof OPENWA_LINKED_SESSION_STATUSES)[number];

export interface OpenwaLinkedChat {
  chatId: string;
  label: string;
  isGroup: boolean;
}

/** A read-only OpenWA session linked to an endpoint; never carries its key or secret id. */
export interface OpenwaLinkedSessionView {
  id: string;
  sessionId: string;
  label: string;
  phoneMasked: string | null;
  pushName: string | null;
  status: OpenwaLinkedSessionStatus;
  allowedChats: OpenwaLinkedChat[];
  createdAt: string;
  updatedAt: string;
}

/** Unlink outcome; `warning` names the gateway key to revoke by hand when `revoked` is false. */
export interface OpenwaLinkedUnlinkResult {
  revoked: boolean;
  warning?: string;
}

export interface OpenwaLinkableSession {
  sessionId: string;
  name: string;
  status: string;
  phoneMasked: string | null;
  pushName: string | null;
}

export interface OpenwaLinkedGatewayChat {
  chatId: string;
  isGroup: boolean;
  name: string;
  allowed: boolean;
}

export const CHAT_INFLIGHT_MODES = ["steer", "queue"] as const;
export type ChatInflightMode = (typeof CHAT_INFLIGHT_MODES)[number];

export const OPENWA_NUMBER_MODES = ["agent_number", "owner_number"] as const;
export type OpenwaNumberMode = (typeof OPENWA_NUMBER_MODES)[number];

export const OPENWA_SENDER_POLICY_MODES = ["all", "allowlist", "denylist"] as const;
export type OpenwaSenderPolicyMode = (typeof OPENWA_SENDER_POLICY_MODES)[number];

export const OPENWA_REPLY_POLICIES = ["allowed", "ask_owner", "owner_absent_only"] as const;
export type OpenwaReplyPolicy = (typeof OPENWA_REPLY_POLICIES)[number];

export const OPENWA_CHAT_ACTIVATIONS = ["auto", "on", "off"] as const;
export type OpenwaChatActivation = (typeof OPENWA_CHAT_ACTIVATIONS)[number];

export const OPENWA_GATEWAY_ADMIN_TOOL_LEVELS = ["off", "read", "full"] as const;
export type OpenwaGatewayAdminToolLevel = (typeof OPENWA_GATEWAY_ADMIN_TOOL_LEVELS)[number];

export const OPENWA_APPROVAL_CATEGORIES = [
  "create_task",
  "external_tools",
  "cross_chat_send",
  "wa_admin",
  "gateway_admin",
] as const;
export type OpenwaApprovalCategory = (typeof OPENWA_APPROVAL_CATEGORIES)[number];

export const OPENWA_GRANT_CATEGORIES = [
  ...OPENWA_APPROVAL_CATEGORIES,
  "reply_outside_allowlist",
  "reply",
] as const;
export type OpenwaGrantCategory = (typeof OPENWA_GRANT_CATEGORIES)[number];

export const OPENWA_TRIGGER_CLASSES = ["owner", "other", "grant"] as const;
export type OpenwaTriggerClass = (typeof OPENWA_TRIGGER_CLASSES)[number];

export const OPENWA_PRINCIPAL_ROLES = ["owner", "allowed", "outside_allowlist", "denylisted"] as const;
export type OpenwaPrincipalRole = (typeof OPENWA_PRINCIPAL_ROLES)[number];

export const CHAT_ANSWER_STATES = ["pending", "answered", "silenced", "handed_off"] as const;
export type ChatAnswerState = (typeof CHAT_ANSWER_STATES)[number];

export const CHAT_SENDER_RULE_LISTS = ["allow", "deny"] as const;
export type ChatSenderRuleList = (typeof CHAT_SENDER_RULE_LISTS)[number];

export const CHAT_SCHEDULED_WAKE_KINDS = ["owner_absent", "approval_reminder"] as const;
export type ChatScheduledWakeKind = (typeof CHAT_SCHEDULED_WAKE_KINDS)[number];

export const CHAT_SCHEDULED_WAKE_STATES = ["pending", "fired", "cancelled"] as const;
export type ChatScheduledWakeState = (typeof CHAT_SCHEDULED_WAKE_STATES)[number];

export const CHAT_OWNER_APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ChatOwnerApprovalStatus = (typeof CHAT_OWNER_APPROVAL_STATUSES)[number];

export const CHAT_OWNER_APPROVAL_CHANNELS = ["whatsapp", "paperclip"] as const;
export type ChatOwnerApprovalChannel = (typeof CHAT_OWNER_APPROVAL_CHANNELS)[number];

export const CHAT_OWNER_GRANT_SCOPES = ["one_action", "requester"] as const;
export type ChatOwnerGrantScope = (typeof CHAT_OWNER_GRANT_SCOPES)[number];

export const CHAT_OWNER_GRANT_STATUSES = ["live", "consumed", "revoked", "expired"] as const;
export type ChatOwnerGrantStatus = (typeof CHAT_OWNER_GRANT_STATUSES)[number];

export const CHAT_OUTBOUND_MESSAGE_SOURCES = ["tool", "publication", "approval"] as const;
export type ChatOutboundMessageSource = (typeof CHAT_OUTBOUND_MESSAGE_SOURCES)[number];

export const CHAT_OUTBOUND_MESSAGE_STATES = ["pending", "sent", "uncertain", "failed"] as const;
export type ChatOutboundMessageState = (typeof CHAT_OUTBOUND_MESSAGE_STATES)[number];

export const CHAT_AUDIT_ENTRY_KINDS = [
  "trigger_admitted",
  "trigger_filtered",
  "message_sent",
  "publication_suppressed",
  "tool_called",
  "approval_requested",
  "approval_reminded",
  "approval_resolved",
  "approval_cancelled",
  "config_changed",
  "group_added",
  "group_left",
  "session_health",
  "linked_read",
] as const;
export type ChatAuditEntryKind = (typeof CHAT_AUDIT_ENTRY_KINDS)[number];

export const CHAT_AUDIT_ACTOR_KINDS = ["user", "agent", "chat_principal", "system"] as const;
export type ChatAuditActorKind = (typeof CHAT_AUDIT_ACTOR_KINDS)[number];

export interface OpenwaTriggerRules {
  directMessage: boolean;
  agentMentioned: boolean;
  replyToAgent: boolean;
  commandPrefix: { enabled: boolean; prefix: string };
  selfChat: boolean;
  ownerMentionedAbsent: boolean;
  keywords: string[];
  allMessages: boolean;
}

export interface OpenwaEndpointPolicy {
  numberMode: OpenwaNumberMode;
  senderPolicyMode: OpenwaSenderPolicyMode;
  replyPolicy: OpenwaReplyPolicy;
  groupMemberReplies: boolean;
  triggers: OpenwaTriggerRules;
  absenceSeconds: number;
  approvals: {
    createTask: boolean;
    externalTools: boolean;
    crossChatSend: boolean;
    waAdmin: boolean;
    gatewayAdmin: boolean;
    reminderMinutes: number;
    maxReminders: number;
    grantTtlHours: number;
  };
  rotateAfterIdleHours: number;
  progressNudgeSeconds: number;
  typingIndicator: boolean;
  ownerNumberPrefix: { enabled: boolean; text: string };
  gatewayAdminTools: OpenwaGatewayAdminToolLevel;
  customInstructions: string;
  auditContentRetentionDays: number;
  attestations: { pacing: boolean; soleClient: boolean };
}

export interface OpenwaTriggerOverrides {
  directMessage?: boolean;
  agentMentioned?: boolean;
  replyToAgent?: boolean;
  commandPrefix?: { enabled?: boolean; prefix?: string };
  selfChat?: boolean;
  ownerMentionedAbsent?: boolean;
  keywords?: string[];
  allMessages?: boolean;
}

export interface OpenwaChatSettings {
  activation: OpenwaChatActivation;
  triggers?: OpenwaTriggerOverrides;
  absenceSeconds?: number;
  replyPolicy?: OpenwaReplyPolicy;
  note?: string;
}

export interface OpenwaWakeRequestPayload {
  triggerClass: OpenwaTriggerClass;
  deliveryIds: string[];
}

export interface ChatEndpointOwner {
  id: string;
  companyId: string;
  endpointId: string;
  identityLinkId: string;
  addedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSenderRule {
  id: string;
  companyId: string;
  endpointId: string;
  list: ChatSenderRuleList;
  e164: string;
  label: string | null;
  createdByUserId: string | null;
  createdByPrincipalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatOwnerApprovalRequest {
  id: string;
  companyId: string;
  endpointId: string;
  originChatKey: string;
  originConversationId: string | null;
  interactionId: string | null;
  requestedByPrincipalId: string | null;
  requestedInRunId: string | null;
  categories: OpenwaGrantCategory[];
  scope: ChatOwnerGrantScope;
  summary: string;
  proposedAction: string;
  status: ChatOwnerApprovalStatus;
  reminderCount: number;
  resolvedVia: ChatOwnerApprovalChannel | null;
  resolvedByUserId: string | null;
  ownerText: string | null;
  agentConditions: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatOwnerGrant {
  id: string;
  companyId: string;
  endpointId: string;
  requestId: string;
  originChatKey: string;
  requesterPrincipalId: string | null;
  category: OpenwaGrantCategory;
  scope: ChatOwnerGrantScope;
  status: ChatOwnerGrantStatus;
  approvedByUserId: string | null;
  approvedVia: ChatOwnerApprovalChannel;
  expiresAt: string;
  consumedAt: string | null;
  consumedByRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatOutboundMessage {
  id: string;
  companyId: string;
  endpointId: string;
  chatKey: string;
  source: ChatOutboundMessageSource;
  runId: string | null;
  providerMessageId: string | null;
  state: ChatOutboundMessageState;
  bodyHash: string;
  clientNonce: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAuditEntry {
  id: string;
  companyId: string;
  endpointId: string;
  conversationId: string | null;
  chatKey: string | null;
  kind: ChatAuditEntryKind;
  actorKind: ChatAuditActorKind;
  actorRef: string | null;
  runId: string | null;
  metadata: Record<string, unknown>;
  content: Record<string, unknown> | null;
  contentPurgeAt: string | null;
  occurredAt: string;
}
