import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, companies, instanceSettings } from "@tickernelz/wardmote-db";
import { startEmbeddedPostgresTestDatabase } from "@tickernelz/wardmote-db/test-embedded-postgres";
import { FEATURE_PRESETS, featureKeysWithDestination } from "@tickernelz/wardmote-shared";
import { instanceSettingsService } from "../services/instance-settings.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;

const featuresOn = (experimental: Record<string, unknown>) =>
  featureKeysWithDestination("features").filter((key) => experimental[key] === true).sort();

beforeAll(async () => {
  database = await startEmbeddedPostgresTestDatabase("wardmote-new-install-db-");
  db = createDb(database.connectionString);
}, 90_000);

afterAll(async () => {
  await db?.$client.end();
  await database?.cleanup();
});

beforeEach(async () => {
  await db.delete(companies);
  await db.update(instanceSettings).set({ experimental: {} });
});

describe("instanceSettingsService.seedNewInstallFeatureDefaults", () => {
  it("starts a fresh database, whose settings row the migrations created, on the Standard preset", async () => {
    const service = instanceSettingsService(db, { runtimeEnv: {} });
    expect(await service.seedNewInstallFeatureDefaults()).toBe(true);
    expect(featuresOn(await service.getExperimental())).toEqual([...FEATURE_PRESETS.standard].sort());
    expect(await service.seedNewInstallFeatureDefaults()).toBe(false);
  });

  it("leaves an instance that already has a company exactly as stored", async () => {
    await db.insert(companies).values({ name: "Existing", issuePrefix: "EXI" });
    const service = instanceSettingsService(db, { runtimeEnv: {} });
    expect(await service.seedNewInstallFeatureDefaults()).toBe(false);
    expect(featuresOn(await service.getExperimental())).toEqual([]);
  });

  it("leaves stored choices alone even before the first company", async () => {
    await db.update(instanceSettings).set({ experimental: { enablePipelines: false } });
    const service = instanceSettingsService(db, { runtimeEnv: {} });
    expect(await service.seedNewInstallFeatureDefaults()).toBe(false);
    expect(featuresOn(await service.getExperimental())).toEqual([]);
  });

});
