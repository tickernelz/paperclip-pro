import { findActiveServerAdapter } from "../adapters/registry.js";
import type { AdapterConfigSchema, ServerAdapterModule } from "../adapters/types.js";

export type AdapterConfigSchemaResolution =
  | { ok: true; schema: AdapterConfigSchema }
  | { ok: false; reason: "not_registered" | "unsupported" };

type CacheEntry = {
  adapter: ServerAdapterModule;
  schema: AdapterConfigSchema | null;
  fetchedAt: number;
  inFlight: Promise<AdapterConfigSchema> | null;
};

const cache = new Map<string, CacheEntry>();

const CONFIG_SCHEMA_TTL_MS = 30_000;

export function invalidateAdapterConfigSchema(type: string): void {
  cache.delete(type);
}

function loadSchema(type: string, entry: CacheEntry): Promise<AdapterConfigSchema> {
  if (entry.inFlight) return entry.inFlight;
  const pending = Promise.resolve()
    .then(() => entry.adapter.getConfigSchema!())
    .then((schema) => {
      if (cache.get(type) === entry) {
        entry.schema = schema;
        entry.fetchedAt = Date.now();
      }
      return schema;
    })
    .finally(() => {
      if (entry.inFlight === pending) entry.inFlight = null;
    });
  entry.inFlight = pending;
  return pending;
}

export async function resolveAdapterConfigSchema(
  type: string,
): Promise<AdapterConfigSchemaResolution> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return { ok: false, reason: "not_registered" };
  if (!adapter.getConfigSchema) return { ok: false, reason: "unsupported" };
  let entry = cache.get(type);
  if (!entry || entry.adapter !== adapter) {
    entry = { adapter, schema: null, fetchedAt: 0, inFlight: null };
    cache.set(type, entry);
  }
  const fresh = entry.schema !== null && Date.now() - entry.fetchedAt < CONFIG_SCHEMA_TTL_MS;
  if (fresh) return { ok: true, schema: entry.schema! };
  const pending = loadSchema(type, entry);
  if (entry.schema !== null) {
    void pending.catch(() => {});
    return { ok: true, schema: entry.schema };
  }
  return { ok: true, schema: await pending };
}
