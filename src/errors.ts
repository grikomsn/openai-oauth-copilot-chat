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

/**
 * Builds an error from a non-successful HTTP response without exposing its body.
 *
 * @param prefix Context describing the failed request.
 * @param response The response to inspect.
 * @returns A normalized error for display or logging.
 */
export async function responseError(prefix: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; detail?: string; message?: string };
    detail = typeof parsed.error === "string"
      ? parsed.error
      : parsed.error?.message ?? parsed.detail ?? parsed.message ?? detail;
  } catch {
    // Keep the response text.
  }
  return new Error(`${prefix} (${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
}
