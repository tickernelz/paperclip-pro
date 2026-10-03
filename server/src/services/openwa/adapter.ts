import {
  Message,
  parseMarkdown,
  stringifyMarkdown,
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type ChatInstance,
  type FetchOptions,
  type FormattedContent,
  type ThreadInfo,
} from "chat";
import { MAX_ATTACHMENT_BYTES } from "../../attachment-types.js";
import type { OpenwaGatewayClient } from "./gateway.js";
import {
  createOpenwaEventSocket,
  normalizeOpenwaInbound,
  openwaDedupeKey,
  type OpenwaEventSocket,
  type OpenwaInboundEvent,
} from "./receiver.js";
import type { OpenwaState } from "./state.js";

export type OpenwaMessage = OpenwaInboundEvent;

export interface OpenwaThread {
  sessionId: string;
  chatId: string;
  isGroup: boolean;
}

const SESSION_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const CHAT_PATTERN = /^[A-Za-z0-9._-]{1,128}@(c\.us|g\.us|lid)$/;
const FETCH_LIMIT = 100;

function chatShape(chatId: string): boolean | null {
  const match = CHAT_PATTERN.exec(chatId);
  if (!match) return null;
  return match[1] === "g.us";
}

export function openwaThreadId(value: OpenwaThread): string {
  if (!SESSION_PATTERN.test(value.sessionId)) throw new Error("Invalid OpenWA session identity");
  if (chatShape(value.chatId) !== value.isGroup) throw new Error("Invalid OpenWA chat identity");
  return "openwa:" + value.sessionId + ":" + value.chatId;
}

export function parseOpenwaThreadId(id: string): OpenwaThread {
  const match = /^openwa:([^:]+):(.+)$/.exec(id);
  if (!match || !SESSION_PATTERN.test(match[1])) throw new Error("Invalid OpenWA conversation identity");
  const isGroup = chatShape(match[2]);
  if (isGroup === null) throw new Error("Invalid OpenWA chat identity");
  return { sessionId: match[1], chatId: match[2], isGroup };
}

export class OpenwaChatAdapter implements Adapter<OpenwaThread, OpenwaMessage> {
  readonly name = "openwa";
  readonly lockScope = "channel" as const;
  readonly botUserId: string;
  readonly ownJid: string;
  typingGuard?: (threadId: string, refresh: boolean) => Promise<void>;
  typingRefreshMs = 20_000;
  typingMaxRefreshes = 90;
  private closed = false;
  private readonly typing = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    readonly userName: string,
    readonly gateway: OpenwaGatewayClient,
    readonly state: OpenwaState,
    private readonly socketOptions: { baseUrl: string; apiKey: string; phoneNumber: string },
  ) {
    const digits = socketOptions.phoneNumber.replace(/\D/g, "");
    this.ownJid = digits + "@c.us";
    this.botUserId = this.ownJid;
  }

  createEventSocket(): OpenwaEventSocket {
    return createOpenwaEventSocket({ baseUrl: this.socketOptions.baseUrl, apiKey: this.socketOptions.apiKey });
  }

  async initialize(_chat: ChatInstance): Promise<void> {}

  async disconnect(): Promise<void> {
    this.closed = true;
    for (const timer of this.typing.values()) clearTimeout(timer);
    this.typing.clear();
  }

  encodeThreadId(value: OpenwaThread): string {
    if (value.sessionId !== this.gateway.sessionId) throw new Error("Wrong OpenWA session");
    return openwaThreadId(value);
  }

  decodeThreadId(id: string): OpenwaThread {
    const value = parseOpenwaThreadId(id);
    if (value.sessionId !== this.gateway.sessionId) throw new Error("Wrong OpenWA session");
    return value;
  }

  channelIdFromThreadId(id: string): string {
    this.decodeThreadId(id);
    return id;
  }

  isDM(id: string): boolean {
    return !this.decodeThreadId(id).isGroup;
  }

  async fetchThread(id: string): Promise<ThreadInfo> {
    const thread = this.decodeThreadId(id);
    return { id, channelId: id, channelName: thread.chatId, isDM: !thread.isGroup, metadata: { chatId: thread.chatId } };
  }

  async fetchChannelInfo(id: string) {
    const info = await this.fetchThread(id);
    return { id, name: info.channelName, isDM: info.isDM, metadata: info.metadata };
  }

  parseMessage(raw: OpenwaMessage): Message<OpenwaMessage> {
    if (raw.sessionId !== this.gateway.sessionId) throw new Error("OpenWA message belongs to another session");
    const threadId = this.encodeThreadId({ sessionId: raw.sessionId, chatId: raw.chatId, isGroup: raw.chatKind === "group" });
    const attachments: Attachment[] = [];
    if (raw.media && raw.waMessageId) {
      const mimeType = raw.media.mimetype ?? "application/octet-stream";
      const chatId = raw.chatId;
      const messageId = raw.waMessageId;
      attachments.push({
        type: mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "file",
        name: raw.media.filename ?? undefined,
        mimeType,
        size: raw.media.sizeBytes ?? undefined,
        fetchMetadata: { kind: "openwa_media", chatId, messageId },
        fetchData: async () => {
          const download = await this.gateway.downloadMedia({ chatId, messageId, maxBytes: MAX_ATTACHMENT_BYTES });
          const chunks: Buffer[] = [];
          for await (const chunk of download.stream) chunks.push(Buffer.from(chunk as Uint8Array));
          return Buffer.concat(chunks);
        },
      });
    }
    return new Message({
      id: raw.waMessageId ?? "row:" + raw.rowUuid,
      threadId,
      text: raw.body,
      formatted: parseMarkdown(raw.body),
      raw,
      attachments,
      author: {
        userId: raw.senderJid,
        userName: raw.senderPhone ?? raw.senderJid,
        fullName: raw.senderPhone ?? raw.senderJid,
        isBot: false,
        isMe: raw.fromMe,
      },
      metadata: { dateSent: new Date(raw.timestamp * 1000), edited: false },
    });
  }

  normalize(raw: OpenwaMessage): Message<OpenwaMessage> {
    return this.parseMessage(raw);
  }

  async fetchMessages(id: string, options?: FetchOptions) {
    const thread = this.decodeThreadId(id);
    const page = await this.gateway.listStoredMessages({
      chatId: thread.chatId,
      after: options?.cursor ?? null,
      limit: Math.min(options?.limit ?? 50, FETCH_LIMIT),
      inlineMedia: false,
    });
    const messages: Message<OpenwaMessage>[] = [];
    for (const row of page.messages) {
      const normalized = normalizeOpenwaInbound(
        {
          event: row.direction === "outgoing" ? "message.sent" : "message.received",
          sessionId: thread.sessionId,
          source: "catch_up",
          rowUuid: row.id,
          data: {
            ...(row.metadata ?? {}),
            id: row.waMessageId ?? null,
            chatId: row.chatId,
            from: row.from,
            author: row.author ?? undefined,
            body: row.body ?? "",
            type: row.type,
            timestamp: row.timestamp ?? Math.floor(Date.parse(row.createdAt) / 1000),
            fromMe: row.direction === "outgoing",
          },
        },
        this.ownJid,
        openwaDedupeKey(thread.sessionId, row.waMessageId ?? null, row.id)!,
        false,
      );
      if (normalized) messages.push(this.parseMessage(normalized));
    }
    messages.reverse();
    const last = page.messages[page.messages.length - 1];
    return { messages, nextCursor: page.messages.length >= Math.min(options?.limit ?? 50, FETCH_LIMIT) && last ? last.id : undefined };
  }

  async getUser(userId: string) {
    return { userId, fullName: userId, userName: userId, isBot: false };
  }

  async handleWebhook(): Promise<Response> {
    return new Response("OpenWA uses an authenticated event socket", { status: 405 });
  }

  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content);
  }

  async startTyping(id: string): Promise<void> {
    await this.refreshTyping(id, 0);
  }

  isTyping(id: string): boolean {
    return this.typing.has(id);
  }

  private async refreshTyping(id: string, refreshes: number): Promise<void> {
    if (this.closed) return;
    const thread = this.decodeThreadId(id);
    const previous = this.typing.get(id);
    if (previous) clearTimeout(previous);
    this.typing.delete(id);
    try {
      await this.typingGuard?.(id, refreshes > 0);
    } catch (error) {
      if (refreshes > 0) await this.gateway.typing({ chatId: thread.chatId, state: "paused" }).catch(() => undefined);
      throw error;
    }
    await this.gateway.typing({ chatId: thread.chatId, state: "typing" });
    if (this.closed || refreshes >= this.typingMaxRefreshes || this.typing.has(id)) return;
    const timer = setTimeout(() => {
      this.typing.delete(id);
      void this.refreshTyping(id, refreshes + 1).catch(() => undefined);
    }, this.typingRefreshMs);
    timer.unref();
    this.typing.set(id, timer);
  }

  async endTyping(id: string): Promise<void> {
    const timer = this.typing.get(id);
    if (timer) clearTimeout(timer);
    this.typing.delete(id);
    if (this.closed) return;
    const thread = this.decodeThreadId(id);
    await this.gateway.typing({ chatId: thread.chatId, state: "paused" }).catch(() => undefined);
  }

  async postMessage(_id: string, _message: AdapterPostableMessage): Promise<never> {
    throw new Error("OpenWA sends require the outbound registry and an immutable Paperclip publication identity");
  }

  async editMessage(_id: string, _messageId: string, _message: AdapterPostableMessage): Promise<never> {
    throw new Error("OpenWA edits require the outbound registry and an immutable Paperclip publication identity");
  }

  async deleteMessage(): Promise<never> {
    throw new Error("OpenWA message deletion is an agent tool action, not an adapter operation");
  }

  async addReaction(): Promise<void> {}

  async removeReaction(): Promise<void> {}
}
