/** Authenticated ChatGPT Codex HTTP transport with cancellation and one 401 refresh. */

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { OpenAIOAuth } from "../auth/auth";
import { DEFAULT_OAUTH_PROFILE } from "../auth/auth";
import { createPromptCacheTransportHeaders } from "../provider/prompt-cache";
import {
  CHATGPT_CODEX_RESET_CREDIT_CONSUME_URL,
  CHATGPT_CODEX_RESET_CREDITS_URL,
  CHATGPT_CODEX_RESPONSES_URL,
  CHATGPT_CODEX_USAGE_URL,
  OAUTH_ORIGINATOR,
  chatgptCodexModelsUrl,
} from "./protocol";

export type OAuthCredentials = { token: string; accountId?: string };

export class CodexTransport {
  constructor(
    private readonly oauth: OpenAIOAuth,
    private readonly userAgent: string,
    private readonly requestTimeoutSeconds: () => number,
    private readonly codexModelsClientVersion: () => string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  sendModels(cancellation: vscode.CancellationToken, profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    const clientVersion = this.codexModelsClientVersion();
    return this.withAuthRetry(profile, (credentials) => this.fetchWithCancellation(chatgptCodexModelsUrl(clientVersion), {
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        Originator: OAUTH_ORIGINATOR,
        Version: clientVersion,
      },
    }, cancellation));
  }

  sendUsage(profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => this.fetcher(CHATGPT_CODEX_USAGE_URL, {
      headers: this.authHeaders(credentials, "application/json"),
    }));
  }

  sendResetCredits(profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => this.fetcher(CHATGPT_CODEX_RESET_CREDITS_URL, {
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        Originator: OAUTH_ORIGINATOR,
        "OpenAI-Beta": "codex-1",
      },
    }));
  }

  sendResetCreditConsume(body: (accountId: string | undefined) => string, profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => this.fetcher(CHATGPT_CODEX_RESET_CREDIT_CONSUME_URL, {
      method: "POST",
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        "Content-Type": "application/json",
        Originator: OAUTH_ORIGINATOR,
        "OpenAI-Beta": "codex-1",
      },
      body: body(credentials.accountId),
    }));
  }

  sendResponse(body: Record<string, unknown>, cancellation: vscode.CancellationToken, profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => {
      const promptCacheKey = typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : undefined;
      const transportHeaders = promptCacheKey
        ? createPromptCacheTransportHeaders(promptCacheKey)
        : { "session-id": randomUUID(), "thread-id": randomUUID() };
      return this.fetchWithCancellation(CHATGPT_CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          ...this.authHeaders(credentials, "text/event-stream"),
          "Content-Type": "application/json",
          Originator: OAUTH_ORIGINATOR,
          ...transportHeaders,
        },
        body: JSON.stringify(body),
      }, cancellation, true);
    });
  }

  private async withAuthRetry(
    profile: string,
    request: (credentials: OAuthCredentials) => Promise<Response>,
  ): Promise<Response> {
    let response = await request(await this.oauth.getAccessToken(false, profile));
    if (response.status === 401) {
      await response.body?.cancel();
      response = await request(await this.oauth.getAccessToken(true, profile));
    }
    return response;
  }

  private authHeaders(credentials: OAuthCredentials, accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${credentials.token}`,
      Accept: accept,
      "User-Agent": this.userAgent,
      ...(credentials.accountId ? { "ChatGPT-Account-ID": credentials.accountId } : {}),
    };
  }

  private async fetchWithCancellation(
    url: string,
    init: RequestInit,
    cancellation: vscode.CancellationToken,
    retryTransient = false,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Codex request timed out")), Math.max(10, this.requestTimeoutSeconds()) * 1000);
    const listener = cancellation.onCancellationRequested(() => controller.abort());
    if (cancellation.isCancellationRequested) controller.abort();
    let handedOff = false;
    const cleanup = (): void => { clearTimeout(timeout); listener.dispose(); };
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await this.fetcher(url, { ...init, signal: controller.signal });
          if (controller.signal.aborted) {
            await response.body?.cancel();
            controller.signal.throwIfAborted();
          }
          if (!response.body) return response;
          const wrapped = wrapResponseBody(response, controller.signal, cleanup);
          handedOff = true;
          return wrapped;
        } catch (error) {
          if (!retryTransient || attempt >= 2 || controller.signal.aborted || !isTransientNetworkError(error)) throw error;
          await waitForRetry(250 * 2 ** attempt, controller.signal);
        }
      }
    } finally {
      if (!handedOff) cleanup();
    }
  }
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  const detail = `${error.name}: ${error.message} ${cause instanceof Error ? `${cause.name}: ${cause.message}` : ""}`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|socket hang up/i.test(detail);
}

/** Keep the cancellation subscription and total deadline alive until body disposal. */
function wrapResponseBody(response: Response, signal: AbortSignal, cleanup: () => void): Response {
  const reader = response.body!.getReader();
  let disposed = false;
  let abort: () => void;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", abort);
    cleanup();
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (disposed) return;
        controller.error(signal.reason ?? new DOMException("Aborted", "AbortError"));
        void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock());
        dispose();
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (disposed) return;
        if (result.done) {
          controller.close();
          dispose();
          reader.releaseLock();
        } else controller.enqueue(result.value);
      } catch (error) {
        if (!disposed) {
          controller.error(error);
          dispose();
          reader.releaseLock();
        }
      }
    },
    async cancel(reason) {
      dispose();
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
