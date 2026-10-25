import type {
  LocalBrowserAccess,
  LocalBrowserClient,
  LocalBrowserGuards,
  LocalBrowserLimits,
  LocalBrowserTab,
  LocalBrowserTier,
  LocalBrowserViewerEvent,
} from "@tickernelz/paperclip-pro-shared";

export interface LocalBrowserBinding {
  companyId: string;
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
  issueId?: string | null;
}

export interface BridgeSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export interface PendingCall {
  id: string;
  tool: string;
  sessionId: string;
  startedAt: number;
  budgetMs: number;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

export type ViewerPayload = LocalBrowserViewerEvent;

export type ViewerListener = (payload: ViewerPayload) => void;

export interface LiveSession {
  sessionId: string;
  connectionId: string;
  companyId: string;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  socket: BridgeSocket;
  client: LocalBrowserClient;
  clientVersion: string;
  capabilities: string[];
  label: string;
  profileName: string | null;
  tabs: LocalBrowserTab[];
  tier: LocalBrowserTier;
  allowedOrigins: string[];
  limits: LocalBrowserLimits;
  access: LocalBrowserAccess | null;
  guards: LocalBrowserGuards | null;
  connectedAt: Date;
  lastSeenAt: Date;
  pending: Map<string, PendingCall>;
  viewers: Set<ViewerListener>;
}
