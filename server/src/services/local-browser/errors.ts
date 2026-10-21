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
};

export class LocalBrowserFailure extends HttpError {
  readonly code: LocalBrowserErrorCode;
  readonly retryable: boolean;
  readonly hint: string | null;

  constructor(
    code: LocalBrowserErrorCode,
    message: string,
    options: { retryable?: boolean; hint?: string; status?: number } = {},
  ) {
    const retryable = options.retryable ?? false;
    super(options.status ?? STATUS_BY_CODE[code], `[${code}] ${message}`, {
      code,
      retryable,
      ...(options.hint ? { hint: options.hint } : {}),
    });
    this.code = code;
    this.retryable = retryable;
    this.hint = options.hint ?? null;
  }

  toToolError(): LocalBrowserToolError {
    return {
      code: this.code,
      message: this.message.startsWith(`[${this.code}] `) ? this.message.slice(this.code.length + 3) : this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      retryable: this.retryable,
    };
  }
}

export function localBrowserFailure(
  code: LocalBrowserErrorCode,
  message: string,
  options: { retryable?: boolean; hint?: string; status?: number } = {},
): LocalBrowserFailure {
  return new LocalBrowserFailure(code, message, options);
}

export function isLocalBrowserFailure(error: unknown): error is LocalBrowserFailure {
  return error instanceof LocalBrowserFailure;
}
