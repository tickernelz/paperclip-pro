import { models as anthropic } from "@tickernelz/paperclip-pro-adapter-claude-local";
import { models as openai } from "@tickernelz/paperclip-pro-adapter-codex-local";
import { models as google } from "@tickernelz/paperclip-pro-adapter-gemini-local";
import { models as xai } from "@tickernelz/paperclip-pro-adapter-grok-local";
import type { AiConnectionMetadata } from "@tickernelz/paperclip-pro-shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return { anthropic, openai, google, xai, openrouter: [] }[connection.provider];
}
