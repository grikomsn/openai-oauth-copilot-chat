/** Authenticated ChatGPT Codex HTTP transport with cancellation and one 401 refresh. */

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { OpenAIOAuth } from "../auth/auth";
import { DEFAULT_OAUTH_PROFILE } from "../auth/auth";
import { createPromptCacheTransportHeaders } from "../provider/prompt-cache";
import { encodeRequestBody } from "./encoding";
import { fetchWithRetry, gatewayStatuses } from "../kit/retry";
import { RequestDeadline } from "../kit/stream";
import { stringifyWellFormedJson } from "../kit/unicode";
import { adaptDirectRequest } from "../provider/direct-request";
import {
  CHATGPT_CODEX_RESET_CREDIT_CONSUME_URL,
  CHATGPT_CODEX_RESET_CREDITS_URL,
  CHATGPT_CODEX_RESPONSES_URL,
  CHATGPT_CODEX_USAGE_URL,
  OAUTH_ORIGINATOR,
  chatgptCodexModelsUrl,
  CHATGPT_API_RESOURCE,
  type ConnectionKind,
} from "./protocol";

export type OAuthCredentials = { token: string; accountId?: string; kind?: ConnectionKind; connectionId?: string };

export class CodexTransport {
  constructor(
    private readonly oauth: OpenAIOAuth,
    private readonly userAgent: string,
    private readonly requestTimeoutSeconds: () => number,
    private readonly codexModelsClientVersion: () => string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly requestCompression: () => boolean = () => true,
    private readonly streamIdleTimeoutSeconds: () => number = () => 120,
  ) {}

  sendModels(cancellation: vscode.CancellationToken, profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    const clientVersion = this.codexModelsClientVersion();
    return this.withAuthRetry(profile, (credentials) => this.fetchWithCancellation(
      credentials.kind === "chatgpt-direct" ? `${CHATGPT_API_RESOURCE}/models` : chatgptCodexModelsUrl(clientVersion), {
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        Originator: OAUTH_ORIGINATOR,
        ...(credentials.kind === "chatgpt-direct" ? {} : { Version: clientVersion }),
      },
    }, cancellation));
  }

  sendUsage(profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => { this.requireLegacyUsage(credentials); return this.fetcher(CHATGPT_CODEX_USAGE_URL, {
      headers: this.authHeaders(credentials, "application/json"),
    }); });
  }

  sendResetCredits(profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => { this.requireLegacyUsage(credentials); return this.fetcher(CHATGPT_CODEX_RESET_CREDITS_URL, {
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        Originator: OAUTH_ORIGINATOR,
        "OpenAI-Beta": "codex-1",
      },
    }); });
  }

  sendResetCreditConsume(body: (accountId: string | undefined) => string, profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => { this.requireLegacyUsage(credentials); return this.fetcher(CHATGPT_CODEX_RESET_CREDIT_CONSUME_URL, {
      method: "POST",
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        "Content-Type": "application/json",
        Originator: OAUTH_ORIGINATOR,
        "OpenAI-Beta": "codex-1",
      },
      body: body(credentials.accountId),
    }); });
  }

  sendResponse(body: Record<string, unknown>, cancellation: vscode.CancellationToken, profile = DEFAULT_OAUTH_PROFILE): Promise<Response> {
    return this.withAuthRetry(profile, (credentials) => {
      const promptCacheKey = typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : undefined;
      const transportHeaders = promptCacheKey
        ? createPromptCacheTransportHeaders(promptCacheKey)
        : { "session-id": randomUUID(), "thread-id": randomUUID() };
      const request = credentials.kind === "chatgpt-direct" ? adaptDirectRequest(body) : body;
      const encoded = encodeRequestBody(stringifyWellFormedJson(request), this.requestCompression());
      return this.fetchWithCancellation(credentials.kind === "chatgpt-direct" ? `${CHATGPT_API_RESOURCE}/responses` : CHATGPT_CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          ...this.authHeaders(credentials, "text/event-stream"),
          "Content-Type": "application/json",
          Originator: OAUTH_ORIGINATOR,
          "X-Client-Request-ID": randomUUID(),
          ...transportHeaders,
          ...encoded.headers,
        },
        body: encoded.body,
      }, cancellation, true);
    });
  }

  private requireLegacyUsage(credentials: OAuthCredentials): void {
    if (credentials.kind === "chatgpt-direct") throw new Error("Manage ChatGPT plan usage and app limits in ChatGPT Settings → Usage.");
  }

  private async withAuthRetry(
    profile: string,
    request: (credentials: OAuthCredentials) => Promise<Response>,
  ): Promise<Response> {
    const initial = await this.oauth.getAccessToken(false, profile);
    let response = await request(initial);
    if (response.status === 401) {
      await response.body?.cancel();
      const refreshed = await this.oauth.getAccessToken(true, profile);
      if (initial.kind !== refreshed.kind || initial.connectionId !== refreshed.connectionId) {
        throw new Error("This profile's connection changed. Select the model again before retrying.");
      }
      response = await request(refreshed);
    }
    return response;
  }

  private authHeaders(credentials: OAuthCredentials, accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${credentials.token}`,
      Accept: accept,
      "User-Agent": this.userAgent,
      ...(credentials.accountId && credentials.kind !== "chatgpt-direct" ? { "ChatGPT-Account-ID": credentials.accountId } : {}),
    };
  }

  private async fetchWithCancellation(
    url: string,
    init: RequestInit,
    cancellation: vscode.CancellationToken,
    retryTransient = false,
  ): Promise<Response> {
    // Inference streams also get an idle deadline; short JSON requests only the total one.
    const deadline = new RequestDeadline({
      label: "Codex request",
      totalMs: Math.max(10, this.requestTimeoutSeconds()) * 1000,
      ...(retryTransient ? { idleMs: Math.max(10, this.streamIdleTimeoutSeconds()) * 1000 } : {}),
      cancellation,
    });
    let handedOff = false;
    try {
      const response = await fetchWithRetry(async () => {
        const response = await this.fetcher(url, { ...init, signal: deadline.signal });
        if (deadline.signal.aborted) {
          await response.body?.cancel();
          deadline.signal.throwIfAborted();
        }
        return response;
      }, { isTransientStatus: gatewayStatuses, maxRetries: retryTransient ? 2 : 0, signal: deadline.signal });
      if (!response.body) return response;
      const wrapped = wrapResponseBody(response, deadline);
      handedOff = true;
      return wrapped;
    } finally {
      if (!handedOff) deadline.dispose();
    }
  }
}

/** Keep the cancellation subscription and deadlines alive until body disposal; each chunk resets the idle timer. */
function wrapResponseBody(response: Response, deadline: RequestDeadline): Response {
  const signal = deadline.signal;
  const reader = response.body!.getReader();
  let disposed = false;
  let abort: () => void;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", abort);
    deadline.dispose();
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
        } else {
          deadline.touch();
          controller.enqueue(result.value);
        }
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
