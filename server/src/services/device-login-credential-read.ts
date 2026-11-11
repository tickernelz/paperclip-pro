
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Environment, EnvironmentLease } from "@tickernelz/wardmote-shared";
import type { EnvironmentRuntimeService } from "./environment-runtime.js";
import { validateLoginSessionHome } from "./login-command.js";

/**
 * The bounded size for the credential payload. A real subscription `auth.json` is
 * a few kilobytes. The read rejects a larger payload before it returns any bytes.
 * The value matches the adapter export bound.
 */
export const MAX_AUTH_JSON_BYTES = 64 * 1024;

/** The fixed credential file name inside the session home. No caller controls it. */
export const AUTH_JSON_FILE_NAME = "auth.json";

/**
 * The fixed, non-secret error the read returns on every failed path. The message
 * carries no pathname, no byte, and no other secret detail.
 */
export const DEVICE_LOGIN_AUTH_READ_ERROR =
  "device login failed: the sandbox credential read errored.";

export const DEVICE_LOGIN_AUTH_READ_SCRIPT = readFileSync(
  fileURLToPath(new URL("./scripts/adapter-auth-read.cjs", import.meta.url)),
  "utf8",
);

/** A strict base64 token: standard alphabet, correct padding, length a multiple
 *  of four. The read rejects any other stdout, so malformed helper output never
 *  decodes to partial bytes. */
const STRICT_BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes the helper stdout to the credential bytes. It accepts only strict
 * base64 with correct padding, so a truncated or corrupt line returns the fixed
 * error instead of partial bytes. It rejects a decoded payload over the bound.
 */
export function decodeAuthReadOutput(stdout: string): Buffer {
  const encoded = stdout.trim();
  if (encoded.length % 4 !== 0 || !STRICT_BASE64_RE.test(encoded)) {
    throw new Error(DEVICE_LOGIN_AUTH_READ_ERROR);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_AUTH_JSON_BYTES) {
    throw new Error(DEVICE_LOGIN_AUTH_READ_ERROR);
  }
  return bytes;
}

/** The environment-runtime surface the descriptor-bound read needs. */
export interface DescriptorBoundAuthReadDeps {
  environmentRuntime: Pick<EnvironmentRuntimeService, "execute">;
  environment: Environment;
  lease: EnvironmentLease;
  /** The verified, server-controlled session home. */
  sessionHome: string;
  /** The host timeout for the read command. */
  timeoutMs: number;
}

/**
 * Runs the descriptor-bound credential read once and returns the bytes. It
 * revalidates the session-home shape, then runs the fixed helper as a one-shot,
 * non-session command. It converts a non-zero exit, an empty or malformed stdout,
 * or an oversize payload to the one fixed, non-secret error. It reads no bytes on
 * any failed path.
 */
export async function runDescriptorBoundAuthRead(
  deps: DescriptorBoundAuthReadDeps,
): Promise<Buffer> {
  // Revalidate the home shape before the sandbox command. The server derived and
  // validated it earlier; this second check keeps the helper argument fixed.
  validateLoginSessionHome(deps.sessionHome);
  let result: { exitCode: number | null; stdout?: string };
  try {
    result = await deps.environmentRuntime.execute({
      environment: deps.environment,
      lease: deps.lease,
      command: "node",
      args: ["-e", DEVICE_LOGIN_AUTH_READ_SCRIPT, deps.sessionHome, String(MAX_AUTH_JSON_BYTES)],
      timeoutMs: deps.timeoutMs,
      // The read is one fixed, non-session operation. It must not open or reuse
      // the login session.
      bypassSession: true,
    });
  } catch {
    // A driver error may embed sandbox text. Convert it to the fixed error.
    throw new Error(DEVICE_LOGIN_AUTH_READ_ERROR);
  }
  if (result.exitCode !== 0) {
    throw new Error(DEVICE_LOGIN_AUTH_READ_ERROR);
  }
  return decodeAuthReadOutput(result.stdout ?? "");
}
