import { api } from "./client";
import type {
  SlackAppConfiguration,
  UpdateChatEndpointInput,
  PhotonProjectInspection,
  PhotonChannelConfiguration,
  OpenwaChannelConfiguration,
  OpenwaGatewayInspection,
  OpenwaEndpointHealth,
  OpenwaEndpointPolicy,
  OpenwaEndpointPolicyInput,
  OpenwaChatSettings,
  OpenwaChatSettingsInput,
  OpenwaChatActivation,
  ChatAuditEntryKind,
  ChatAuditActorKind,
  ChatInflightMode,
  ChatOwnerApprovalChannel,
  ChatOwnerApprovalStatus,
  ChatOwnerGrantScope,
  OpenwaGrantCategory,
  ChatPublicationBatchStatus,
  ChatPublicationState,
  ChatPublicationSummary,
  ChatActivityItem,
  ChatFileTransferResolutionPrecondition,
} from "@tickernelz/paperclip-pro-shared";
export type {
  ChatPublicationSummary,
  ChatActivityItem,
} from "@tickernelz/paperclip-pro-shared";

export type ChatProvider =
  "slack" | "github" | "discord" | "microsoft-teams" | "telegram" | "agentmail" | "imessage-photon" | "openwa";
export type ChatEndpointStatus =
  | "draft"
  | "verifying"
  | "active"
  | "paused"
  | "attention"
  | "revoked"
  | "archived";

export type ChatEndpointSetupAction =
  "configure" | "verify" | "pause" | "resume" | "reconnect" | "remove";

export interface ChatEndpointResource {
  metadata?: Record<string, unknown>;
  id: string;
  type: string;
  providerResourceId: string;
  label: string;
  availability: "available" | "unavailable" | "removed";
  enabled: boolean;
  detail?: string | null;
  participants?: string[];
}

export interface ChatIdentityLink {
  githubUserId?: string;
  githubLogin?: string | null;
  id: string;
  principalId: string;
  /** Latest discovery-only connect command received by this endpoint. */
  lastConnectAt?: string | null;
  externalLabel: string;
  externalDetail?: string | null;
  paperclipUserId?: string | null;
  paperclipUserLabel?: string | null;
  status: "linked" | "pending" | "revoked";
}

export interface ChatConversation {
  id: string;
  externalLabel: string;
  externalUrl?: string | null;
  issueId?: string | null;
  issueIdentifier?: string | null;
  issueTitle?: string | null;
  state:
    "active" | "waiting" | "completed" | "unavailable" | "endpoint_removed";
  updatedAt: string;
  lastPublicationStatus?: ChatPublicationState | null;
}

export interface ExternalChannelBindingSummary {
  endpointId: string;
  provider: ChatProvider;
  botLabel?: string | null;
  externalLabel: string;
  externalUrl?: string | null;
  conversationId: string;
  publicationState?: string | null;
  assignedAgentLocked: true;
}

export interface ChatIdentityLinkPreview {
  selfService?: boolean;
  canConfirm?: boolean;
  endpointId: string;
  companyId: string;
  companyName: string;
  companyPrefix: string;
  provider: ChatProvider;
  providerAccountLabel?: string | null;
  botLabel?: string | null;
  externalLabel: string;
  externalDetail?: string | null;
  expiresAt: string;
}

export interface ChatEndpoint {
  communicationInstructions?: string;
  publicationMode?: "automatic" | "explicit";
  externalExecutionPolicy?: "restricted" | "agent";
  id: string;
  companyId: string;
  provider: ChatProvider;
  status: ChatEndpointStatus;
  assignedAgentId: string;
  assignedAgentName: string;
  connectionId?: string | null;
  providerAccountId?: string | null;
  providerAccountLabel?: string | null;
  botLabel?: string | null;
  botUsername?: string | null;
  botExternalId?: string | null;
  photonAllocation?: "dedicated" | "shared";
  policy?: OpenwaEndpointPolicy;
  policyRevision?: number;
  inflightMode?: ChatInflightMode;
  allowDirectMessages?: boolean;
  allowGroupChats?: boolean;
  allowUnlinkedPeople: boolean;
  replyMode?: "subscribed" | "mention_each_reply" | null;
  healthMessage?: string | null;
  lastError?: string | null;
  lastActivityAt?: string | null;
  resources?: ChatEndpointResource[];
  identityLinks?: ChatIdentityLink[];
  conversations?: ChatConversation[];
  activity?: ChatActivityItem[];
  setup?: {
    github?: import("@tickernelz/paperclip-pro-shared").ChatEndpointSetupState["github"];
    step: string;
    testStartedAt?: string | null;
    testSkipped?: boolean;
    authorizationUrl?: string | null;
    providerUrl?: string | null;
    webhookUrl?: string | null;
    messagingEndpoint?: string | null;
    command?: string | null;
    slackApp?: SlackAppConfiguration;
    webhookVerifiedAt?: string | null;
    webhookSecretConfigured?: boolean;
    callbackSurfaces?: {
      events: ChatCallbackSurfaceState;
      interactivity: ChatCallbackSurfaceState;
      slashCommands: ChatCallbackSurfaceState;
    };
    callbacksNeedUpdate?: boolean;
  };
}

export interface OpenwaOwner {
  id: string;
  identityLinkId: string;
  principalId: string;
  numberMasked: string;
  displayName: string | null;
  linkStatus: string;
  paperclipUserId: string | null;
  effective: boolean;
  createdAt: string;
}

export interface OpenwaOwnerAdded {
  owner: OpenwaOwner | null;
  created: boolean;
  confirmationUrl: string | null;
  expiresAt: string | null;
}

export interface OpenwaSenderRule {
  id: string;
  list: "allow" | "deny";
  e164: string;
  label: string | null;
  createdAt: string;
}

export interface OpenwaChat {
  id: string;
  chatId: string;
  chatKey: string;
  type: string;
  label: string;
  availability: string;
  enabled: boolean;
  settings: OpenwaChatSettings;
  ownerPresent: boolean | null;
  participantCount: number | null;
}

export interface OpenwaGatewayChat {
  chatId: string;
  isGroup: boolean;
  name: string;
  lastActivityAt: string | null;
  activation: OpenwaChatActivation;
  configured: boolean;
}

export interface OpenwaAuditEntry {
  id: string;
  kind: ChatAuditEntryKind;
  actorKind: ChatAuditActorKind;
  actorRef: string | null;
  chatKey: string | null;
  conversationId: string | null;
  runId: string | null;
  metadata: Record<string, unknown>;
  content: Record<string, unknown> | null;
  contentPurged: boolean;
  occurredAt: string;
}

export interface OpenwaAuditPage {
  items: OpenwaAuditEntry[];
  nextCursor: string | null;
  access: "content" | "metadata";
}

export interface OpenwaApproval {
  id: string;
  status: ChatOwnerApprovalStatus;
  categories: OpenwaGrantCategory[];
  scope: ChatOwnerGrantScope;
  summary: string;
  proposedAction: string;
  originChat: string;
  requester: string | null;
  originConversationId: string | null;
  interactionId: string | null;
  reminderCount: number;
  resolvedVia: ChatOwnerApprovalChannel | null;
  resolvedByUserId: string | null;
  ownerText: string | null;
  agentConditions: string | null;
  resolvedAt: string | null;
  createdAt: string;
  grants: Array<{ id: string; category: OpenwaGrantCategory; status: string; expiresAt: string }>;
  canResolve: boolean;
}

export interface OpenwaApprovalResolveInput {
  decision: "approve" | "reject";
  reason?: string;
}

export interface OpenwaApprovalResolveResult {
  requestId: string;
  status: "approved" | "rejected";
  grantIds: string[];
}

export interface OpenwaAuditFilters {
  kind?: ChatAuditEntryKind;
  chatKey?: string;
  actorKind?: ChatAuditActorKind;
  from?: string;
  to?: string;
}

export function openwaAuditSearch(filters: OpenwaAuditFilters, cursor?: string): string {
  const params = new URLSearchParams({ limit: "25" });
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.chatKey?.trim()) params.set("chatKey", filters.chatKey.trim());
  if (filters.actorKind) params.set("actorKind", filters.actorKind);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export interface ChatCallbackSurfaceState {
  status: "current" | "stale" | "unverified";
  observedAt?: string | null;
}

export interface ChatEndpointSetupSecret {
  webhookSecret: string;
}

type ListResponse<T> =
  | T[]
  | {
      items?: T[];
      endpoints?: T[];
      resources?: T[];
      principals?: T[];
      conversations?: T[];
      deliveries?: T[];
      publications?: T[];
    };

function rows<T>(response: ListResponse<T>): T[] {
  if (Array.isArray(response)) return response;
  return (
    response.items ??
    response.endpoints ??
    response.resources ??
    response.principals ??
    response.conversations ??
    response.deliveries ??
    response.publications ??
    []
  );
}

export const chatEndpointsApi = {
  list: async (companyId: string) =>
    rows(
      await api.get<ListResponse<ChatEndpoint>>(
        `/companies/${companyId}/chat-endpoints`,
      ),
    ),
  get: (endpointId: string) =>
    api.get<ChatEndpoint>(`/chat-endpoints/${endpointId}`),
  create: (
    companyId: string,
    input: { provider: ChatProvider; assignedAgentId: string },
  ) => api.post<ChatEndpoint>(`/companies/${companyId}/chat-endpoints`, input),
  update: (
    endpointId: string,
    input: UpdateChatEndpointInput,
  ) => api.patch<ChatEndpoint>(`/chat-endpoints/${endpointId}`, input),
  setup: (
    endpointId: string,
    input: {
      action: ChatEndpointSetupAction;
      credentials?: Record<string, string>;
      photon?: PhotonChannelConfiguration;
      openwa?: OpenwaChannelConfiguration;
    },
  ) => api.post<ChatEndpoint>(`/chat-endpoints/${endpointId}/setup`, input),
  inspectPhoton: (endpointId: string, input: { projectId: string; projectSecret: string }) =>
    api.post<PhotonProjectInspection>(`/chat-endpoints/${endpointId}/photon/inspect`, input),
  inspectOpenwa: (endpointId: string, input: { baseUrl: string; apiKey: string; adminApiKey?: string }) =>
    api.post<OpenwaGatewayInspection>(`/chat-endpoints/${endpointId}/openwa/inspect`, input),
  getOpenwaHealth: (endpointId: string) =>
    api.get<OpenwaEndpointHealth>(`/chat-endpoints/${endpointId}/openwa/health`, { cache: "no-store" }),
  updateOpenwaPolicy: (endpointId: string, patch: OpenwaEndpointPolicyInput) =>
    api.patch<{ policy: OpenwaEndpointPolicy; policyRevision: number }>(`/chat-endpoints/${endpointId}/openwa/policy`, patch),
  listOpenwaOwners: (endpointId: string) =>
    api.get<OpenwaOwner[]>(`/chat-endpoints/${endpointId}/openwa/owners`, { cache: "no-store" }),
  addOpenwaOwner: (endpointId: string, e164: string) =>
    api.post<OpenwaOwnerAdded>(`/chat-endpoints/${endpointId}/openwa/owners`, { e164 }),
  removeOpenwaOwner: (endpointId: string, ownerId: string) =>
    api.delete<void>(`/chat-endpoints/${endpointId}/openwa/owners/${ownerId}`),
  listOpenwaSenderRules: (endpointId: string) =>
    api.get<OpenwaSenderRule[]>(`/chat-endpoints/${endpointId}/openwa/sender-rules`, { cache: "no-store" }),
  addOpenwaSenderRule: (endpointId: string, input: { list: "allow" | "deny"; e164: string; label?: string }) =>
    api.post<OpenwaSenderRule>(`/chat-endpoints/${endpointId}/openwa/sender-rules`, input),
  removeOpenwaSenderRule: (endpointId: string, ruleId: string) =>
    api.delete<void>(`/chat-endpoints/${endpointId}/openwa/sender-rules/${ruleId}`),
  listOpenwaChats: (endpointId: string) =>
    api.get<OpenwaChat[]>(`/chat-endpoints/${endpointId}/openwa/chats`),
  updateOpenwaChat: (endpointId: string, input: { chatId: string; label?: string; settings: OpenwaChatSettingsInput }) =>
    api.put<OpenwaChat>(`/chat-endpoints/${endpointId}/openwa/chats`, input),
  listOpenwaGatewayChats: (endpointId: string) =>
    api.get<OpenwaGatewayChat[]>(`/chat-endpoints/${endpointId}/openwa/gateway-chats?limit=200`, { cache: "no-store" }),
  listOpenwaApprovals: (endpointId: string, status?: ChatOwnerApprovalStatus) =>
    api.get<OpenwaApproval[]>(`/chat-endpoints/${endpointId}/openwa/approvals${status ? "?status=" + status : ""}`, { cache: "no-store" }),
  resolveOpenwaApproval: (endpointId: string, requestId: string, input: OpenwaApprovalResolveInput) =>
    api.post<OpenwaApprovalResolveResult>(`/chat-endpoints/${endpointId}/openwa/approvals/${requestId}/resolve`, input),
  listOpenwaAudit: (endpointId: string, filters: OpenwaAuditFilters, cursor?: string) =>
    api.get<OpenwaAuditPage>(`/chat-endpoints/${endpointId}/audit?${openwaAuditSearch(filters, cursor)}`, { cache: "no-store" }),
  generateSetupSecret: (endpointId: string) =>
    api.post<ChatEndpointSetupSecret>(
      `/chat-endpoints/${endpointId}/setup-secret`,
      {},
    ),
  test: (endpointId: string) =>
    api.post<ChatEndpoint>(`/chat-endpoints/${endpointId}/test`, {}),
  finishSlackSetup: (endpointId: string) => api.post<ChatEndpoint>(`/chat-endpoints/${endpointId}/finish`, {}),
  setupTestStatus: (endpointId: string) => api.get<{ messageReceivedAt: string | null }>(`/chat-endpoints/${endpointId}/test-status`),
  requestIdentityAccess: (token: string) => api.post<{ status: "member" | "pending_approval" }>("/chat-identity-links/request-access", { token }),
  listResources: async (endpointId: string) =>
    rows(
      await api.get<ListResponse<ChatEndpointResource>>(
        `/chat-endpoints/${endpointId}/resources`,
      ),
    ),
  updateResources: (
    endpointId: string,
    resources: Array<{ id: string; enabled: boolean }>,
  ) =>
    api.put<ChatEndpointResource[]>(`/chat-endpoints/${endpointId}/resources`, {
      resources,
    }),
  listPrincipals: async (endpointId: string) =>
    rows(
      await api.get<ListResponse<ChatIdentityLink>>(
        `/chat-endpoints/${endpointId}/principals`,
      ),
    ),
  createLinkIntent: (endpointId: string, principalId: string) =>
    api.post<{ confirmationUrl: string }>(
      `/chat-endpoints/${endpointId}/principals/${principalId}/link-intent`,
      {},
    ),
  revokeLink: (endpointId: string, principalId: string) =>
    api.delete<void>(
      `/chat-endpoints/${endpointId}/principals/${principalId}/link`,
    ),
  previewIdentityLink: (token: string) =>
    api.get<ChatIdentityLinkPreview>(
      `/chat-identity-links/preview?token=${encodeURIComponent(token)}`,
    ),
  confirmIdentityLink: (token: string) =>
    api.post<{ ok: true; endpointId: string }>("/chat-identity-links/confirm", {
      token,
    }),
  listConversations: async (endpointId: string) =>
    rows(
      await api.get<ListResponse<ChatConversation>>(
        `/chat-endpoints/${endpointId}/conversations`,
      ),
    ),
  listActivity: async (endpointId: string) =>
    rows(
      await api.get<ListResponse<ChatActivityItem>>(
        `/chat-endpoints/${endpointId}/activity`,
      ),
    ),
  listActivityPage: (endpointId: string, cursor?: string) =>
    api.get<{ items: ChatActivityItem[]; nextCursor: string | null }>(
      `/chat-endpoints/${endpointId}/activity?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  getIssueBinding: (issueId: string) =>
    api.get<ExternalChannelBindingSummary | null>(
      `/issues/${issueId}/chat-binding`,
    ),
  replayDelivery: (endpointId: string, deliveryId: string) =>
    api.post<void>(
      `/chat-endpoints/${endpointId}/deliveries/${deliveryId}/replay`,
      {},
    ),
  replayPublication: (endpointId: string, publicationId: string) =>
    api.post<void>(
      `/chat-endpoints/${endpointId}/publications/${publicationId}/replay`,
      {},
    ),
  resolvePublication: (
    endpointId: string,
    publicationId: string,
    action: "mark_delivered" | "retry_anyway" | "cancel",
    fileTransfer?: ChatFileTransferResolutionPrecondition,
  ) =>
    api.post<void>(
      `/chat-endpoints/${endpointId}/publications/${publicationId}/resolve`,
      {
        action,
        ...(fileTransfer
          ? {
              fileTransfer: {
                phase: fileTransfer.phase,
                version: fileTransfer.version,
              },
            }
          : {}),
      },
    ),
  resolveAction: (
    endpointId: string,
    actionId: string,
    action: "mark_delivered" | "retry_anyway" | "cancel",
  ) =>
    api.post<void>(
      `/chat-endpoints/${endpointId}/actions/${actionId}/resolve`,
      { action },
    ),
  getPublicationBatchStatus: (
    endpointId: string,
    conversationId: string,
    publicationId: string,
  ) =>
    api.get<ChatPublicationBatchStatus>(
      `/chat-endpoints/${endpointId}/conversations/${conversationId}/publications/${publicationId}/status`,
    ),
  publishComment: (
    endpointId: string,
    conversationId: string,
    commentId: string,
  ) =>
    api.post<ChatPublicationSummary>(
      `/chat-endpoints/${endpointId}/conversations/${conversationId}/publications`,
      { commentId },
    ),
  publishBoardMessage: (
    endpointId: string,
    conversationId: string,
    body: string,
    idempotencyKey: string,
    attachmentIds: string[] = [],
  ) =>
    api.post<ChatPublicationSummary>(
      `/chat-endpoints/${endpointId}/conversations/${conversationId}/publications`,
      {
        body,
        idempotencyKey,
        ...(attachmentIds.length ? { attachmentIds } : {}),
      },
    ),
};
