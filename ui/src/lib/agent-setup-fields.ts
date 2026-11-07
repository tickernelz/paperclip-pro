import { PROVIDER_ENV_KEYS } from "./provider-credential";

/** Only controls consumed by each adapter's config builder and runtime belong here. */
export const SETUP_CREDENTIAL_KEYS: Record<string, string> = {};

export function setupProviderKeys(_adapter: string) {
  return PROVIDER_ENV_KEYS;
}

export function setupEfforts(_adapter: string, _model = ""): string[] {
  return [];
}

export const SETUP_LOGIN_HINTS: Record<string, string> = {};
