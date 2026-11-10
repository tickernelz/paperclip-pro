import {
  aiRoutingBaseUrl,
  aiRoutingModel,
  type AiProviderRouting,
} from "@tickernelz/wardmote-shared";

/** Projects one authoritative connection into an isolated harness environment. */
export function managedProviderRouting(
  route: AiProviderRouting,
  harness: string,
  credential: string,
  model: string,
) {
  const env: Record<string, string> = {};
  const config: Record<string, unknown> = {};
  let codexConfig = "";
  const baseUrl = aiRoutingBaseUrl(route, harness);
  if (route.kind === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    env.AWS_REGION = route.region!;
    env.AWS_DEFAULT_REGION = route.region!;
    env.AWS_EC2_METADATA_DISABLED = "true";
    env.AWS_BEARER_TOKEN_BEDROCK = credential;
  } else if (harness === "codex_local") {
    env.WARDMOTE_AI_PROVIDER_KEY = credential;
    codexConfig = `model_provider = "paperclip"\n[model_providers.paperclip]\nname = "Wardmote connection"\nbase_url = ${JSON.stringify(baseUrl)}\nwire_api = "responses"\nrequires_openai_auth = false\n${route.auth === "none" ? "" : 'env_key = "WARDMOTE_AI_PROVIDER_KEY"\n'}`;
  } else if (harness === "claude_local") {
    env.ANTHROPIC_BASE_URL = baseUrl;
    env[
      route.auth === "api_key" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
    ] = credential;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    if (model) {
      env.ANTHROPIC_MODEL = model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
      env.CLAUDE_CODE_SUBAGENT_MODEL = model;
    }
  } else if (harness === "opencode_local") {
    const provider = route.kind === "openrouter" ? "openrouter" : "paperclip";
    if (route.kind === "openrouter") env.OPENROUTER_API_KEY = credential;
    else {
      env.WARDMOTE_AI_PROVIDER_KEY = credential;
      env.WARDMOTE_AI_PROVIDER_URL = baseUrl;
    }
    const id = model.startsWith(`${provider}/`)
      ? model.slice(provider.length + 1)
      : model;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      provider: {
        [provider]: {
          ...(provider === "paperclip"
            ? { npm: "@ai-sdk/openai-compatible", name: "Wardmote connection" }
            : {}),
          options: { baseURL: baseUrl, apiKey: credential },
          models: id ? { [id]: { name: id } } : {},
        },
      },
      enabled_providers: [provider],
    });
    env.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
    config.model = aiRoutingModel(route, harness, model);
  }
  return { env, config, codexConfig };
}
