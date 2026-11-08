import { models as anthropic } from "@tickernelz/wardmote-adapter-utils/provider-models/claude";
import { models as openai } from "@tickernelz/wardmote-adapter-utils/provider-models/codex";
import { models as google } from "@tickernelz/wardmote-adapter-utils/provider-models/gemini";
import { models as xai } from "@tickernelz/wardmote-adapter-utils/provider-models/grok";
import type { AiConnectionMetadata } from "@tickernelz/wardmote-shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return { anthropic, openai, google, xai, openrouter: [] }[connection.provider];
}
