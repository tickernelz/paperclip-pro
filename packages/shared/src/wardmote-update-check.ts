import fs from "node:fs";
import path from "node:path";
import { fetchLatestWardmoteVersion, UPDATE_CHECK_INTERVAL_MS, type WardmoteUpdateChannel } from "./wardmote-updates.js";

export type UpdateCheckResult = { checkedAt: number; latest: string | null };
type UpdateCheckCache = UpdateCheckResult & { channel?: WardmoteUpdateChannel };

export function readCachedLatestWardmoteVersion(cachePath: string, channel: WardmoteUpdateChannel): UpdateCheckResult | null {
  const cached = readCache(cachePath);
  return cached && (cached.channel ?? "latest") === channel ? { checkedAt: cached.checkedAt, latest: cached.latest } : null;
}

function readCache(cachePath: string): UpdateCheckCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8")) as Partial<UpdateCheckCache>;
    if (typeof raw.checkedAt !== "number" || !Number.isFinite(raw.checkedAt)) return null;
    return { checkedAt: raw.checkedAt, latest: typeof raw.latest === "string" ? raw.latest : null, channel: raw.channel };
  } catch {
    return null;
  }
}

export async function resolveLatestWardmoteVersion(input: {
  cachePath: string;
  channel: WardmoteUpdateChannel;
  now?: number;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}): Promise<UpdateCheckResult | null> {
  const now = input.now ?? Date.now();
  const cached = readCache(input.cachePath);
  const sameChannel = cached !== null && (cached.channel ?? "latest") === input.channel;
  if (cached && sameChannel && now - cached.checkedAt < (input.intervalMs ?? UPDATE_CHECK_INTERVAL_MS)) {
    return { checkedAt: cached.checkedAt, latest: cached.latest };
  }
  try {
    const latest = await fetchLatestWardmoteVersion(input.channel, { fetchImpl: input.fetchImpl });
    try {
      fs.mkdirSync(path.dirname(input.cachePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(input.cachePath, JSON.stringify({ checkedAt: now, latest, channel: input.channel }) + "\n", { mode: 0o600 });
    } catch {}
    return { checkedAt: now, latest };
  } catch {
    return sameChannel && cached ? { checkedAt: cached.checkedAt, latest: cached.latest } : null;
  }
}
