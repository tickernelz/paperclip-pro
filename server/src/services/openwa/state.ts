import { createHash } from "node:crypto";
import type {
  ChatSdkStatePersistence,
  ChatSdkStateScope,
} from "../chat-sdk-state.js";

const MAX_RECORD_BYTES = 512 * 1024;
const MAX_CAS_ATTEMPTS = 32;
export const OPENWA_INGEST_CURSOR_KEY = "openwa.ingest_cursor";

export interface OpenwaIngestCursor {
  schema: 1;
  sessionId: string;
  waMessageId: string | null;
  rowId: string | null;
  timestamp: number;
}

export class OpenwaState {
  constructor(
    readonly scope: ChatSdkStateScope,
    private readonly persistence: ChatSdkStatePersistence,
  ) {}
  private key(key: string): string {
    return `openwa:${createHash("sha256").update(key).digest("hex")}`;
  }
  async read<T>(key: string): Promise<T | null> {
    const row = await this.persistence.read(this.scope, this.key(key));
    return row ? (row.value as T) : null;
  }
  async update<T>(key: string, update: (current: T | null) => T): Promise<T> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const row = await this.persistence.read(this.scope, this.key(key));
      const value = update(row ? (row.value as T) : null);
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_RECORD_BYTES)
        throw new Error("OpenWA state record is too large");
      if (
        await this.persistence.compareAndSet({
          ...this.scope,
          key: this.key(key),
          expectedVersion: row?.version ?? null,
          expiresAt: null,
          value,
        })
      )
        return value;
    }
    throw new Error("OpenWA state changed concurrently; retry");
  }
}

export function isOpenwaIngestCursor(value: unknown, sessionId: string): value is OpenwaIngestCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<OpenwaIngestCursor>;
  return (
    cursor.schema === 1 &&
    cursor.sessionId === sessionId &&
    (cursor.waMessageId === null || typeof cursor.waMessageId === "string") &&
    (cursor.rowId === null || typeof cursor.rowId === "string") &&
    (cursor.waMessageId !== null || cursor.rowId !== null) &&
    typeof cursor.timestamp === "number" &&
    Number.isFinite(cursor.timestamp)
  );
}

export async function readOpenwaCursor(state: OpenwaState, sessionId: string): Promise<OpenwaIngestCursor | null> {
  const value = await state.read<unknown>(OPENWA_INGEST_CURSOR_KEY);
  return isOpenwaIngestCursor(value, sessionId) ? value : null;
}

export async function writeOpenwaCursor(
  state: OpenwaState,
  sessionId: string,
  cursor: OpenwaIngestCursor,
): Promise<void> {
  if (!isOpenwaIngestCursor(cursor, sessionId)) throw new Error("OpenWA ingest cursor is invalid");
  await state.update<unknown>(OPENWA_INGEST_CURSOR_KEY, (current) =>
    isOpenwaIngestCursor(current, sessionId) && current.timestamp > cursor.timestamp ? current : cursor,
  );
}
