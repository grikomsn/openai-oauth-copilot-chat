export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

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
