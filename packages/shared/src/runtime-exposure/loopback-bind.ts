
/** The only bind preset an exposed managed runtime may use. */
export const RUNTIME_EXPOSURE_BIND_MODE = "loopback";
export const RUNTIME_EXPOSURE_BIND_HOST = "127.0.0.1";

/**
 * `--bind <mode>` / `--bind-host <host>`, in both the space- and `=`-separated
 * spellings. Each takes exactly one value, and a value is never another flag.
 */
const BIND_SELECTING_ARG =
  /(?:^|\s)--bind(?:-host)?(?:=|\s+)(?!--)[^\s]+/g;

/** Legacy aliases for `--bind lan`; they select a non-loopback bind. */
const LEGACY_LAN_ALIASES = /(?:^|\s)--(?:tailscale-auth|authenticated-private)(?=\s|$)/g;

/** True when the command carries an explicit bind selection of any kind. */
export function commandSelectsBindMode(command: string): boolean {
  return new RegExp(BIND_SELECTING_ARG.source).test(command)
    || new RegExp(LEGACY_LAN_ALIASES.source).test(command);
}

const WARDMOTE_DEV_RUNNER_COMMAND =
  /(?:^|[\s;&|])(?:(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+dev(?::once|:watch|:server)?(?=\s|$)|[^\s]*dev-runner(?:\.[cm]?[jt]s)?(?=\s|$))/;

export function isWardmoteDevRunnerCommand(command: string): boolean {
  return WARDMOTE_DEV_RUNNER_COMMAND.test(command);
}

export function forceLoopbackBindInCommand(command: string): string {
  if (!isWardmoteDevRunnerCommand(command)) return command;
  const stripped = command.replace(BIND_SELECTING_ARG, "").trim();
  if (stripped.length === 0) return command;
  return `${stripped} --bind ${RUNTIME_EXPOSURE_BIND_MODE}`;
}

export function rewriteUrlHostToLoopback(url: string | null): string | null {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.hostname = RUNTIME_EXPOSURE_BIND_HOST;
    return parsed.toString();
  } catch {
    // Not a URL we can reason about; leave it for the caller's own handling.
    return url;
  }
}
