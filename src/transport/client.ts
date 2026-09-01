/** Authenticated ChatGPT Codex HTTP transport with cancellation and one 401 refresh. */

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { OpenAIOAuth } from "../auth/auth";
import { DEFAULT_OAUTH_PROFILE } from "../auth/auth";
import { createPromptCacheTransportHeaders } from "../features/prompt-cache";
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
    if (response.status === 401) response = await request(await this.oauth.getAccessToken(true, profile));
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
    const timeout = setTimeout(() => controller.abort(), Math.max(10, this.requestTimeoutSeconds()) * 1000);
    const listener = cancellation.onCancellationRequested(() => controller.abort());
    if (cancellation.isCancellationRequested) controller.abort();
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.fetcher(url, { ...init, signal: controller.signal });
        } catch (error) {
          if (!retryTransient || attempt >= 2 || controller.signal.aborted || !isTransientNetworkError(error)) throw error;
          await waitForRetry(250 * 2 ** attempt, controller.signal);
        }
      }
    } finally {
      clearTimeout(timeout);
      listener.dispose();
    }
  }
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  const detail = `${error.name}: ${error.message} ${cause instanceof Error ? `${cause.name}: ${cause.message}` : ""}`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|socket hang up/i.test(detail);
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
