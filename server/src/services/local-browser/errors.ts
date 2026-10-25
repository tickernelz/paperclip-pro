import type { LocalBrowserErrorCode, LocalBrowserToolError } from "@tickernelz/paperclip-pro-shared";
import { HttpError } from "../../errors.js";

const STATUS_BY_CODE: Record<LocalBrowserErrorCode, number> = {
  local_browser_not_paired: 409,
  local_browser_extension_unavailable: 409,
  local_browser_origin_denied: 403,
  local_browser_tier_denied: 403,
  local_browser_tab_missing: 404,
  local_browser_ref_stale: 409,
  local_browser_element_missing: 404,
  local_browser_timeout: 504,
  local_browser_navigation_blocked: 409,
  local_browser_protocol_error: 502,
  local_browser_result_too_large: 413,
  local_browser_unsupported: 400,
  local_browser_permission_required: 403,
};

const RETRYABLE_BY_DEFAULT = new Set<LocalBrowserErrorCode>(["local_browser_permission_required"]);

export interface LocalBrowserFailureOptions {
  retryable?: boolean;
  hint?: string;
  status?: number;
  permissions?: string[];
}

export class LocalBrowserFailure extends HttpError {
  readonly code: LocalBrowserErrorCode;
  readonly retryable: boolean;
  readonly hint: string | null;
  readonly permissions: string[] | null;

  constructor(code: LocalBrowserErrorCode, message: string, options: LocalBrowserFailureOptions = {}) {
    const retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(code);
    const permissions = options.permissions?.length ? [...options.permissions] : null;
    super(options.status ?? STATUS_BY_CODE[code], `[${code}] ${message}`, {
      code,
      retryable,
      ...(options.hint ? { hint: options.hint } : {}),
      ...(permissions ? { permissions } : {}),
    });
    this.code = code;
    this.retryable = retryable;
    this.hint = options.hint ?? null;
    this.permissions = permissions;
  }

  toToolError(): LocalBrowserToolError {
    return {
      code: this.code,
      message: this.message.startsWith(`[${this.code}] `) ? this.message.slice(this.code.length + 3) : this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      retryable: this.retryable,
      ...(this.permissions ? { permissions: this.permissions } : {}),
    };
  }
}

export function localBrowserFailure(
  code: LocalBrowserErrorCode,
  message: string,
  options: LocalBrowserFailureOptions = {},
): LocalBrowserFailure {
  return new LocalBrowserFailure(code, message, options);
}

export function isLocalBrowserFailure(error: unknown): error is LocalBrowserFailure {
  return error instanceof LocalBrowserFailure;
}
