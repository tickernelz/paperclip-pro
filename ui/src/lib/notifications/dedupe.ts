export const NOTIFICATION_SEEN_STORAGE_KEY = "paperclip.notifications.seen.v1";

const LOCK_NAME = "paperclip.notifications.claim";
const SEEN_TTL_MS = 10 * 60_000;
const SEEN_MAX = 200;

interface ClaimLocks {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

export interface NotificationClaimEnv {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  locks: ClaimLocks | null;
  now: () => number;
  memory: Map<string, number>;
}

const tabMemory = new Map<string, number>();

function defaultEnv(): NotificationClaimEnv {
  let storage: Storage | null = null;
  try {
    storage = typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    storage = null;
  }
  const locks = typeof navigator !== "undefined" && navigator.locks
    ? { request: <T,>(name: string, callback: () => Promise<T> | T) => navigator.locks.request(name, callback) as Promise<T> }
    : null;
  return { storage, locks, now: () => Date.now(), memory: tabMemory };
}

function readSeen(env: NotificationClaimEnv): Map<string, number> {
  const raw = env.storage?.getItem(NOTIFICATION_SEEN_STORAGE_KEY);
  if (!raw) return new Map(env.memory);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const seen = new Map(env.memory);
    for (const [key, at] of Object.entries(parsed)) {
      if (typeof at === "number") seen.set(key, at);
    }
    return seen;
  } catch {
    return new Map(env.memory);
  }
}

function claimInsideLock(key: string, env: NotificationClaimEnv): boolean {
  const now = env.now();
  const seen = readSeen(env);
  for (const [seenKey, at] of seen) {
    if (now - at > SEEN_TTL_MS) seen.delete(seenKey);
  }
  if (seen.has(key)) return false;
  seen.set(key, now);
  const kept = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX);
  env.memory.clear();
  for (const [seenKey, at] of kept) env.memory.set(seenKey, at);
  writeSeen(env, kept);
  return true;
}

function writeSeen(env: NotificationClaimEnv, entries: [string, number][]) {
  try {
    env.storage?.setItem(NOTIFICATION_SEEN_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    return;
  }
}

/** Resolves true for exactly one caller per notification key across this browser's tabs. */
export async function claimNotificationKey(key: string, env: NotificationClaimEnv = defaultEnv()): Promise<boolean> {
  if (!env.locks) return claimInsideLock(key, env);
  try {
    return await env.locks.request(LOCK_NAME, () => claimInsideLock(key, env));
  } catch {
    return claimInsideLock(key, env);
  }
}
