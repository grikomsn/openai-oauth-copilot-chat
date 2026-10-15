/** Shared error formatting for extension-facing and network failures. */

/**
 * Returns a useful message for any thrown value.
 *
 * @param error The value caught by the caller.
 * @returns The error message, or a string representation of the value.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const SHARING_MESSAGES: Readonly<Record<string, string>> = {
  subscription_sharing_usage_limit_exceeded: "ChatGPT usage limit reached. Check ChatGPT Settings → Usage for shared plan and app limits.",
  subscription_sharing_user_not_eligible: "ChatGPT plan usage is unavailable for this account or workspace.",
  subscription_sharing_unsupported_capability: "This feature is not supported by ChatGPT plan usage. Check the model and enabled tools.",
  subscription_sharing_route_not_supported: "This API route is not supported by ChatGPT plan usage.",
  subscription_sharing_invalid_user: "This ChatGPT connection is no longer valid. Sign in again.",
  chatpass_v2_scope_not_authorized: "This ChatGPT connection lacks plan permission. Sign in again and allow plan usage.",
  chatpass_v2_invalid_authorization_context: "This ChatGPT registration does not authorize the request. Sign in again.",
  subscription_sharing_usage_unavailable: "ChatGPT usage is temporarily unavailable. Try again later.",
  subscription_sharing_user_unavailable: "Your ChatGPT account is temporarily unavailable. Try again later.",
};

/** Safe metadata from HTTP and stream failures. Raw bodies never reach logs. */
export class ProviderRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number, readonly requestId?: string, readonly param?: string) {
    super(message);
    this.name = "ProviderRequestError";
  }
  get retryable(): boolean {
    return this.code === "subscription_sharing_usage_unavailable" || this.code === "subscription_sharing_user_unavailable"
      || (!this.code && this.status !== undefined && [502, 503, 504].includes(this.status));
  }
}

export function providerRequestError(raw: unknown, prefix = "Codex stream failed", status?: number, requestId?: string): ProviderRequestError {
  const root = record(raw);
  const error = record(root?.error) ?? record(record(root?.response)?.error) ?? (root?.type === "error" ? root : undefined);
  const code = typeof error?.code === "string" && Object.hasOwn(SHARING_MESSAGES, error.code) ? error.code : undefined;
  const param = typeof error?.param === "string" && /^[a-zA-Z_][a-zA-Z0-9_.\[\]]{0,79}$/.test(error.param) ? error.param : undefined;
  const id = requestId && /^req_[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? requestId : undefined;
  const detail = code ? SHARING_MESSAGES[code] : "";
  return new ProviderRequestError(`${prefix}${status ? ` (${status})` : ""}${detail ? `: ${detail}` : ""}`, code, status, id, param);
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}

/**
 * Builds an error from a non-successful HTTP response without exposing its body.
 *
 * @param prefix Context describing the failed request.
 * @param response The response to inspect.
 * @returns A normalized error for display or logging.
 */
export async function responseError(prefix: string, response: Response): Promise<Error> {
  const raw: unknown = await response.json().catch(() => undefined);
  return providerRequestError(raw, prefix, response.status, response.headers.get("x-request-id") ?? undefined);
}
