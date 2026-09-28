import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  registerServerAdapter,
  unregisterServerAdapter,
} from "../adapters/registry.js";
import type { AdapterConfigSchema, ServerAdapterModule } from "../adapters/types.js";
import type { AdapterConfigSchemaResolution } from "../services/adapter-config-schema.js";
import {
  invalidateAdapterConfigSchema,
  resolveAdapterConfigSchema,
} from "../services/adapter-config-schema.js";

const ADAPTER_TYPE = "config_schema_cache_fake";

type Deferred = {
  promise: Promise<AdapterConfigSchema>;
  resolve: (schema: AdapterConfigSchema) => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: (schema: AdapterConfigSchema) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AdapterConfigSchema>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function schemaLabelled(label: string): AdapterConfigSchema {
  return { fields: [{ key: "model", label, type: "text" }] } as unknown as AdapterConfigSchema;
}

function labelOf(resolution: AdapterConfigSchemaResolution): string | null {
  if (!resolution.ok) return null;
  const [field] = resolution.schema.fields as Array<{ label: string }>;
  return field?.label ?? null;
}

async function flush(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
}

let loads: Deferred[] = [];
let now = 0;

beforeEach(() => {
  loads = [];
  now = Date.UTC(2026, 0, 1);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  registerServerAdapter({
    type: ADAPTER_TYPE,
    execute: async () => {
      throw new Error("not executed in this suite");
    },
    testEnvironment: async () => ({ status: "ok" as const, checks: [] }),
    getConfigSchema: () => {
      const next = deferred();
      loads.push(next);
      return next.promise;
    },
  } as unknown as ServerAdapterModule);
  invalidateAdapterConfigSchema(ADAPTER_TYPE);
});

afterEach(() => {
  unregisterServerAdapter(ADAPTER_TYPE);
  invalidateAdapterConfigSchema(ADAPTER_TYPE);
  vi.useRealTimers();
});

function advance(ms: number): void {
  now += ms;
  vi.setSystemTime(now);
}

it("loads the schema once for concurrent cold callers", async () => {
  const reads = Array.from({ length: 12 }, () => resolveAdapterConfigSchema(ADAPTER_TYPE));
  await flush();

  expect(loads).toHaveLength(1);

  loads[0]!.resolve(schemaLabelled("first"));
  const results = await Promise.all(reads);

  expect(results.map(labelOf)).toEqual(Array.from({ length: 12 }, () => "first"));
  expect(loads).toHaveLength(1);
});

it("serves a stale schema without waiting and refreshes it once", async () => {
  const cold = resolveAdapterConfigSchema(ADAPTER_TYPE);
  await flush();
  loads[0]!.resolve(schemaLabelled("first"));
  expect(labelOf(await cold)).toBe("first");

  advance(31_000);
  const staleReads = await Promise.all(
    Array.from({ length: 5 }, () => resolveAdapterConfigSchema(ADAPTER_TYPE)),
  );

  expect(staleReads.map(labelOf)).toEqual(Array.from({ length: 5 }, () => "first"));
  expect(loads).toHaveLength(2);

  loads[1]!.resolve(schemaLabelled("second"));
  await flush();

  expect(labelOf(await resolveAdapterConfigSchema(ADAPTER_TYPE))).toBe("second");
  expect(loads).toHaveLength(2);
});

it("keeps serving the last good schema after a failed refresh", async () => {
  const cold = resolveAdapterConfigSchema(ADAPTER_TYPE);
  await flush();
  loads[0]!.resolve(schemaLabelled("first"));
  await cold;

  advance(31_000);
  expect(labelOf(await resolveAdapterConfigSchema(ADAPTER_TYPE))).toBe("first");
  loads[1]!.reject(new Error("omp models --json failed"));
  await flush();

  expect(labelOf(await resolveAdapterConfigSchema(ADAPTER_TYPE))).toBe("first");
  loads[2]!.resolve(schemaLabelled("third"));
  await flush();
  expect(labelOf(await resolveAdapterConfigSchema(ADAPTER_TYPE))).toBe("third");
});

it("surfaces a failed first load and retries on the next call", async () => {
  const cold = resolveAdapterConfigSchema(ADAPTER_TYPE);
  await flush();
  loads[0]!.reject(new Error("spawn omp ENOENT"));
  await expect(cold).rejects.toThrow("spawn omp ENOENT");

  const retry = resolveAdapterConfigSchema(ADAPTER_TYPE);
  await flush();
  expect(loads).toHaveLength(2);
  loads[1]!.resolve(schemaLabelled("recovered"));

  expect(labelOf(await retry)).toBe("recovered");
});

it("reloads the schema after invalidation", async () => {
  const cold = resolveAdapterConfigSchema(ADAPTER_TYPE);
  await flush();
  loads[0]!.resolve(schemaLabelled("first"));
  await cold;

  invalidateAdapterConfigSchema(ADAPTER_TYPE);
  const afterInvalidate = resolveAdapterConfigSchema(ADAPTER_TYPE);
  await flush();
  expect(loads).toHaveLength(2);
  loads[1]!.resolve(schemaLabelled("reloaded"));

  expect(labelOf(await afterInvalidate)).toBe("reloaded");
});
