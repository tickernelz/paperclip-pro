export const OFFLINE_DATA_CACHE_PREFIX = "wardmote-data-";
export const CLEAR_OFFLINE_DATA_MESSAGE = "wardmote.clear-offline-data";
const CACHED_AT_HEADER = "x-wardmote-cached-at";

function cacheStorage(): CacheStorage | null {
  return typeof caches === "undefined" ? null : caches;
}

export async function clearOfflineData(): Promise<void> {
  const storage = cacheStorage();
  const container = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
  container?.controller?.postMessage({ type: CLEAR_OFFLINE_DATA_MESSAGE });
  if (!storage) return;
  try {
    const keys = await storage.keys();
    await Promise.all(keys.filter((key) => key.startsWith(OFFLINE_DATA_CACHE_PREFIX)).map((key) => storage.delete(key)));
  } catch {
    return;
  }
}

export async function offlineSnapshotTime(): Promise<Date | null> {
  const storage = cacheStorage();
  if (!storage) return null;
  try {
    const name = (await storage.keys()).find((key) => key.startsWith(OFFLINE_DATA_CACHE_PREFIX));
    if (!name) return null;
    const cached = await (await storage.open(name)).match("/api/auth/get-session");
    const stamp = cached?.headers.get(CACHED_AT_HEADER);
    const time = stamp ? new Date(stamp) : null;
    return time && !Number.isNaN(time.getTime()) ? time : null;
  } catch {
    return null;
  }
}
