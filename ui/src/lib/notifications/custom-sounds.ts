import type { NotificationKind } from "@tickernelz/paperclip-pro-shared";

export const CUSTOM_SOUND_MAX_BYTES = 512 * 1024;

const DB_NAME = "paperclip-notifications";
const STORE = "custom-sounds";

export interface StoredCustomSound {
  kind: NotificationKind;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  updatedAt: string;
}

export type CustomSoundValidation = { ok: true } | { ok: false; error: string };

export function validateCustomSoundFile(file: { type: string; size: number }): CustomSoundValidation {
  if (!file.type.startsWith("audio/")) return { ok: false, error: "Choose an audio file." };
  if (file.size <= 0) return { ok: false, error: "The audio file is empty." };
  if (file.size > CUSTOM_SOUND_MAX_BYTES) return { ok: false, error: "Custom sounds must be 512 KB or smaller." };
  return { ok: true };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  if (!dbPromise) {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "kind" });
    };
    dbPromise = requestResult(request).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return requestResult(run(db.transaction(STORE, mode).objectStore(STORE)));
}

const listeners = new Set<() => void>();

export function subscribeCustomSounds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyCustomSoundsChanged() {
  for (const listener of listeners) listener();
}

export async function saveCustomSound(kind: NotificationKind, file: File): Promise<StoredCustomSound> {
  const validation = validateCustomSoundFile(file);
  if (!validation.ok) throw new Error(validation.error);
  const record: StoredCustomSound = {
    kind,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    updatedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(record));
  notifyCustomSoundsChanged();
  return record;
}

export async function loadCustomSound(kind: NotificationKind): Promise<StoredCustomSound | null> {
  try {
    return (await withStore<StoredCustomSound | undefined>("readonly", (store) => store.get(kind))) ?? null;
  } catch {
    return null;
  }
}

export async function removeCustomSound(kind: NotificationKind): Promise<void> {
  await withStore("readwrite", (store) => store.delete(kind));
  notifyCustomSoundsChanged();
}
