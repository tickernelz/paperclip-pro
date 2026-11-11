
/** RFC 9110 field-name = token. */
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 8_192;

const FORBIDDEN_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

/** Prefixes reserved for the transport or for intermediaries. */
const FORBIDDEN_HEADER_PREFIXES = ["proxy-", "sec-", "http2-"];

export type McpRemoteHeaderRejection =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "forbidden"
  | "value_too_long"
  | "value_control_characters";

export interface McpRemoteHeaderCheck {
  ok: boolean;
  reason?: McpRemoteHeaderRejection;
}

const OK: McpRemoteHeaderCheck = { ok: true };

export function checkMcpRemoteHeaderName(name: string): McpRemoteHeaderCheck {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_HEADER_NAME_LENGTH) return { ok: false, reason: "too_long" };
  if (!HTTP_TOKEN_PATTERN.test(trimmed)) return { ok: false, reason: "invalid_characters" };
  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.has(lower)) return { ok: false, reason: "forbidden" };
  if (FORBIDDEN_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return { ok: false, reason: "forbidden" };
  }
  return OK;
}

/**
 * Is `value` safe to send as a header value? Rejects CR/LF and other control
 * characters (header splitting) and absurdly long values.
 */
export function checkMcpRemoteHeaderValue(value: string): McpRemoteHeaderCheck {
  if (value.length > MAX_HEADER_VALUE_LENGTH) return { ok: false, reason: "value_too_long" };
  // Reject C0/C1 controls and DEL. A tab is legal in a field value per RFC 9110
  // but has no legitimate use in a credential, so it is rejected too.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return { ok: false, reason: "value_control_characters" };
  }
  return OK;
}

export function isSafeMcpRemoteHeaderName(name: string): boolean {
  return checkMcpRemoteHeaderName(name).ok;
}

export function isSafeMcpRemoteHeaderValue(value: string): boolean {
  return checkMcpRemoteHeaderValue(value).ok;
}

/** A UI-safe explanation for a rejected header. Never echoes the value. */
export function mcpRemoteHeaderRejectionMessage(
  headerName: string,
  reason: McpRemoteHeaderRejection,
): string {
  switch (reason) {
    case "empty":
      return "Header names cannot be blank.";
    case "too_long":
      return `Header name "${headerName.slice(0, MAX_HEADER_NAME_LENGTH)}" is too long.`;
    case "invalid_characters":
      return `"${headerName.slice(0, MAX_HEADER_NAME_LENGTH)}" is not a valid header name. Use letters, digits, and dashes.`;
    case "forbidden":
      return `Wardmote manages the "${headerName}" header and cannot send a custom value for it.`;
    case "value_too_long":
      return `The value for "${headerName}" is too long.`;
    case "value_control_characters":
      return `The value for "${headerName}" contains line breaks or control characters.`;
  }
}

/**
 * `credentialValues` keys use a `headers.<Name>` config path. Extract the header
 * name, or `null` when the path is not a header path.
 */
export function mcpRemoteHeaderNameFromConfigPath(configPath: string): string | null {
  if (!configPath.startsWith("headers.")) return null;
  const name = configPath.slice("headers.".length).trim();
  return name.length > 0 ? name : null;
}

export const MCP_REMOTE_HEADER_LIMITS = {
  maxNameLength: MAX_HEADER_NAME_LENGTH,
  maxValueLength: MAX_HEADER_VALUE_LENGTH,
} as const;
