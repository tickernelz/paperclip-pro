import { findActiveServerAdapter } from "../adapters/registry.js";
import type { AdapterConfigSchema, ServerAdapterModule } from "../adapters/types.js";

export type AdapterConfigSchemaResolution =
  | { ok: true; schema: AdapterConfigSchema }
  | { ok: false; reason: "not_registered" | "unsupported" };

const cache = new Map<
  string,
  { adapter: ServerAdapterModule; schema: AdapterConfigSchema; fetchedAt: number }
>();

const CONFIG_SCHEMA_TTL_MS = 30_000;

export function invalidateAdapterConfigSchema(type: string): void {
  cache.delete(type);
}

export async function resolveAdapterConfigSchema(
  type: string,
): Promise<AdapterConfigSchemaResolution> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return { ok: false, reason: "not_registered" };
  if (!adapter.getConfigSchema) return { ok: false, reason: "unsupported" };
  const cached = cache.get(type);
  if (
    cached &&
    cached.adapter === adapter &&
    Date.now() - cached.fetchedAt < CONFIG_SCHEMA_TTL_MS
  ) {
    return { ok: true, schema: cached.schema };
  }
  const schema = await adapter.getConfigSchema();
  cache.set(type, { adapter, schema, fetchedAt: Date.now() });
  return { ok: true, schema };
}
