import type { Db } from "@tickernelz/wardmote-db";
import { instanceSettings } from "@tickernelz/wardmote-db";
import { SPEECH_TO_TEXT_PROVIDERS, type SpeechToTextProvider } from "@tickernelz/wardmote-shared";
import { eq, sql } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";
import type { StoredSecretVersionMaterial } from "../secrets/types.js";

export const INSTANCE_SETTINGS_SINGLETON_KEY = "default";

export type SpeechToTextApiKeys = Partial<Record<SpeechToTextProvider, string>>;

function storedMaterials(raw: unknown): Array<[SpeechToTextProvider, StoredSecretVersionMaterial]> {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return SPEECH_TO_TEXT_PROVIDERS.flatMap((provider) => {
    const material = record[provider];
    return material && typeof material === "object" && !Array.isArray(material)
      ? [[provider, material as StoredSecretVersionMaterial] as [SpeechToTextProvider, StoredSecretVersionMaterial]]
      : [];
  });
}

async function decrypt(provider: SpeechToTextProvider, material: StoredSecretVersionMaterial): Promise<string | null> {
  try {
    return await localEncryptedProvider.resolveVersion({ material, externalRef: null });
  } catch (error) {
    logger.warn({ provider, error: error instanceof Error ? error.name : "unknown" }, "saved speech-to-text API key could not be decrypted");
    return null;
  }
}

export async function encryptSpeechToTextApiKey(value: string): Promise<StoredSecretVersionMaterial> {
  return (await localEncryptedProvider.createSecret({ value })).material;
}

export async function readSpeechToTextApiKeys(db: Pick<Db, "select">): Promise<SpeechToTextApiKeys> {
  const [row] = await db
    .select({ keys: instanceSettings.speechToTextKeys })
    .from(instanceSettings)
    .where(eq(instanceSettings.singletonKey, INSTANCE_SETTINGS_SINGLETON_KEY));
  const entries = await Promise.all(storedMaterials(row?.keys).map(async ([provider, material]) => [provider, await decrypt(provider, material)] as const));
  return Object.fromEntries(entries.filter(([, value]) => value)) as SpeechToTextApiKeys;
}

export async function readSpeechToTextApiKey(db: Pick<Db, "select">, provider: SpeechToTextProvider): Promise<string | null> {
  const [row] = await db
    .select({ material: sql<StoredSecretVersionMaterial | null>`${instanceSettings.speechToTextKeys} -> ${provider}::text` })
    .from(instanceSettings)
    .where(eq(instanceSettings.singletonKey, INSTANCE_SETTINGS_SINGLETON_KEY));
  return row?.material ? decrypt(provider, row.material) : null;
}
