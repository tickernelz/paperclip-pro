export const WARDMOTE_ENV_PREFIX = "WARDMOTE_";
export const LEGACY_ENV_PREFIX = "PAPERCLIP_";
export const MAX_ALIASED_ENV_VALUE_BYTES = 4096;

type MutableEnv = Record<string, string | undefined>;
type AliasState = { warned: boolean; folded: Set<string> };

const STATE_KEY = Symbol.for("wardmote.envAliases");

function aliasState(): AliasState {
  const holder = globalThis as typeof globalThis & { [STATE_KEY]?: AliasState };
  holder[STATE_KEY] ??= { warned: false, folded: new Set() };
  return holder[STATE_KEY];
}

export function wardmoteEnvKey(legacyKey: string): string {
  return legacyKey.startsWith(LEGACY_ENV_PREFIX) ? WARDMOTE_ENV_PREFIX + legacyKey.slice(LEGACY_ENV_PREFIX.length) : legacyKey;
}

export function legacyEnvKey(key: string): string {
  return key.startsWith(WARDMOTE_ENV_PREFIX) ? LEGACY_ENV_PREFIX + key.slice(WARDMOTE_ENV_PREFIX.length) : key;
}

export function isAliasableEnvValue(legacyKey: string, value: string): boolean {
  return !legacyKey.endsWith("_JSON") && Buffer.byteLength(value, "utf8") <= MAX_ALIASED_ENV_VALUE_BYTES;
}

export function applyEnvAliases(env: MutableEnv = process.env): string[] {
  const state = aliasState();
  for (const key of Object.keys(env)) {
    if (!key.startsWith(WARDMOTE_ENV_PREFIX)) continue;
    const value = env[key];
    delete env[key];
    if (value === undefined) continue;
    env[legacyEnvKey(key)] = value;
    if (env === process.env) state.folded.add(legacyEnvKey(key));
  }
  return Object.keys(env)
    .filter((key) => key.startsWith(LEGACY_ENV_PREFIX) && !state.folded.has(key))
    .filter((key) => isAliasableEnvValue(key, env[key] ?? ""))
    .sort();
}

export function bootstrapEnvAliases(
  warn: (message: string) => void = (message) => process.stderr.write(`[wardmote] warning: ${message}\n`),
): void {
  const legacyOnly = applyEnvAliases(process.env);
  const state = aliasState();
  if (state.warned || legacyOnly.length === 0) return;
  state.warned = true;
  warn(
    `PAPERCLIP_* environment names are deprecated and stop working in the next release. Rename: ${legacyOnly
      .map((key) => `${key} -> ${wardmoteEnvKey(key)}`)
      .join(", ")}.`,
  );
}

export function withWardmoteEnvAliases<T extends MutableEnv>(env: T): T {
  const target = env as MutableEnv;
  for (const key of Object.keys(target)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX)) continue;
    const value = target[key];
    const twin = wardmoteEnvKey(key);
    if (value !== undefined && isAliasableEnvValue(key, value)) target[twin] = value;
    else delete target[twin];
  }
  return env;
}
