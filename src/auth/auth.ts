/** PKCE sign-in, callback handling, refresh, and SecretStorage persistence. */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type * as vscode from "vscode";
import { responseError } from "../errors";
import {
  EXTENSION_DISPLAY_NAME,
  OAUTH_ORIGINATOR,
  OPENAI_AUTHORIZE_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_REDIRECT_URI,
  OPENAI_TOKEN_URL,
} from "../transport/protocol";

const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const SCOPE = "openid email profile offline_access";
const LEGACY_SECRET_KEY = "openaiCodex.oauthSession.v1";
const PROFILE_INDEX_KEY = "openaiCodex.oauthProfiles.v2";
const PROFILE_SECRET_PREFIX = "openaiCodex.oauthSession.v2.";
export const DEFAULT_OAUTH_PROFILE = "default";

/** Persisted OAuth credentials used for ChatGPT Codex requests. */
export interface OAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  email?: string;
}

/** Dependencies and callbacks for the interactive authorization flow. */
export interface AuthorizationFlow {
  url: string;
  state: string;
  verifier: string;
}

/** Browser launch dependency used by interactive sign-in. */
export interface BrowserSignIn {
  url: string;
  completion: Promise<OAuthSession>;
  cancel(): void;
}

type Fetcher = typeof fetch;

/**
 * Owns the extension's OAuth session and refresh lifecycle.
 *
 * Credentials are stored in VS Code SecretStorage; callers receive only the
 * access token and optional ChatGPT account identifier needed for a request.
 */
export class OpenAIOAuth {
  private readonly refreshPromises = new Map<string, Promise<OAuthSession>>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async hasSession(profile = DEFAULT_OAUTH_PROFILE): Promise<boolean> {
    return Boolean(await this.loadSession(profile));
  }

  async sessionInfo(profile = DEFAULT_OAUTH_PROFILE): Promise<Pick<OAuthSession, "email" | "accountId" | "expiresAt"> | undefined> {
    const session = await this.loadSession(profile);
    return session ? { email: session.email, accountId: session.accountId, expiresAt: session.expiresAt } : undefined;
  }

  async listProfiles(): Promise<readonly string[]> {
    const profiles = await this.readProfileIndex();
    if (await this.secrets.get(LEGACY_SECRET_KEY)) profiles.add(DEFAULT_OAUTH_PROFILE);
    return [...profiles].sort();
  }

  async signOut(profile = DEFAULT_OAUTH_PROFILE): Promise<void> {
    const normalized = normalizeProfileId(profile);
    await this.secrets.delete(profileSecretKey(normalized));
    if (normalized === DEFAULT_OAUTH_PROFILE) await this.secrets.delete(LEGACY_SECRET_KEY);
    const profiles = await this.readProfileIndex();
    profiles.delete(normalized);
    await this.writeProfileIndex(profiles);
  }

  createAuthorizationFlow(): AuthorizationFlow {
    const verifier = randomBytes(96).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    const url = new URL(OPENAI_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OPENAI_OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "login");
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("originator", OAUTH_ORIGINATOR);
    return { url: url.toString(), state, verifier };
  }

  async startBrowserSignIn(profile = DEFAULT_OAUTH_PROFILE): Promise<BrowserSignIn> {
    const normalizedProfile = normalizeProfileId(profile);
    const flow = this.createAuthorizationFlow();
    let server: Server | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let rejectCompletion: (reason: Error) => void = () => undefined;

    const close = () => {
      if (timeout) clearTimeout(timeout);
      server?.close();
      server = undefined;
    };
    const completion = new Promise<OAuthSession>((resolve, reject) => {
      rejectCompletion = reject;
      server = createServer(async (request, response) => {
        const callback = new URL(request.url ?? "/", OPENAI_REDIRECT_URI);
        if (callback.pathname !== CALLBACK_PATH) {
          response.writeHead(404).end("Not found");
          return;
        }
        if (settled) {
          response.writeHead(409).end("This sign-in is already complete.");
          return;
        }
        try {
          const session = await this.completeAuthorization(callback.toString(), flow, normalizedProfile);
          settled = true;
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(callbackPage(`Signed in to ${EXTENSION_DISPLAY_NAME}`, "You can close this tab and return to Visual Studio Code."));
          close();
          resolve(session);
        } catch (error) {
          settled = true;
          const message = error instanceof Error ? error.message : String(error);
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(callbackPage("ChatGPT sign-in failed", message));
          close();
          reject(error);
        }
      });
      server.once("error", (error) => {
        settled = true;
        close();
        reject(new Error(`Unable to listen on ${OPENAI_REDIRECT_URI}: ${error.message}. Use “Codex Bridge: Sign In Manually” instead.`));
      });
      server.listen(CALLBACK_PORT, "127.0.0.1");
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        close();
        reject(new Error("OpenAI browser sign-in timed out"));
      }, 5 * 60_000);
    });
    return {
      url: flow.url,
      completion,
      cancel: () => {
        if (settled) return;
        settled = true;
        close();
        rejectCompletion(new Error("OpenAI sign-in cancelled"));
      },
    };
  }

  async completeAuthorization(
    callbackInput: string,
    flow: AuthorizationFlow,
    profile = DEFAULT_OAUTH_PROFILE,
  ): Promise<OAuthSession> {
    const callback = parseCallback(callbackInput);
    if (callback.error) throw new Error(callback.errorDescription ?? callback.error);
    if (!callback.code) throw new Error("The callback does not contain an authorization code");
    if (callback.state !== flow.state) throw new Error("Invalid OpenAI OAuth callback state");
    const response = await this.fetcher(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: OPENAI_OAUTH_CLIENT_ID,
        code: callback.code,
        redirect_uri: OPENAI_REDIRECT_URI,
        code_verifier: flow.verifier,
      }),
    });
    if (!response.ok) throw await responseError("OpenAI token exchange failed", response);
    const session = tokenResponseToSession(await response.json(), undefined, this.now());
    await this.saveSession(profile, session);
    return session;
  }

  async getAccessToken(forceRefresh = false, profile = DEFAULT_OAUTH_PROFILE): Promise<{ token: string; accountId?: string }> {
    const normalizedProfile = normalizeProfileId(profile);
    const session = await this.loadSession(normalizedProfile);
    if (!session) throw new Error(`Sign in to OpenAI Codex profile “${normalizedProfile}” first`);
    const valid = !forceRefresh && session.expiresAt > this.now() + 60_000;
    const current = valid ? session : await this.refresh(normalizedProfile, session);
    return { token: current.accessToken, accountId: current.accountId };
  }

  async importCodexCliSession(profile = DEFAULT_OAUTH_PROFILE): Promise<OAuthSession> {
    const authPath = join(homedir(), ".codex", "auth.json");
    const parsed = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    const tokens = recordField(parsed, "tokens") ?? parsed;
    const accessToken = stringField(tokens, "access_token") ?? stringField(tokens, "accessToken");
    const refreshToken = stringField(tokens, "refresh_token") ?? stringField(tokens, "refreshToken");
    if (!accessToken || !refreshToken) throw new Error(`${authPath} does not contain an OAuth session`);
    const claims = decodeJwt(accessToken);
    const session: OAuthSession = {
      accessToken,
      refreshToken,
      expiresAt: typeof claims?.exp === "number" ? claims.exp * 1000 : this.now() + 5 * 60_000,
      accountId: extractAccountId(claims),
      email: typeof claims?.email === "string" ? claims.email : undefined,
    };
    await this.saveSession(profile, session);
    return session;
  }

  private async refresh(profile: string, session: OAuthSession): Promise<OAuthSession> {
    let refreshPromise = this.refreshPromises.get(profile);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const response = await this.fetcher(OPENAI_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: OPENAI_OAUTH_CLIENT_ID,
            refresh_token: session.refreshToken,
          }),
        });
        if (!response.ok) throw await responseError("OpenAI token refresh failed", response);
        const refreshed = tokenResponseToSession(await response.json(), session.refreshToken, this.now());
        await this.saveSession(profile, refreshed);
        return refreshed;
      })().finally(() => { this.refreshPromises.delete(profile); });
      this.refreshPromises.set(profile, refreshPromise);
    }
    return refreshPromise;
  }

  private async saveSession(profile: string, session: OAuthSession): Promise<void> {
    const normalized = normalizeProfileId(profile);
    await this.secrets.store(profileSecretKey(normalized), JSON.stringify(session));
    const profiles = await this.readProfileIndex();
    profiles.add(normalized);
    await this.writeProfileIndex(profiles);
  }

  private async loadSession(profile: string): Promise<OAuthSession | undefined> {
    const normalized = normalizeProfileId(profile);
    const raw = await this.secrets.get(profileSecretKey(normalized))
      ?? (normalized === DEFAULT_OAUTH_PROFILE ? await this.secrets.get(LEGACY_SECRET_KEY) : undefined);
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as OAuthSession;
      return typeof value.accessToken === "string" && typeof value.refreshToken === "string" && typeof value.expiresAt === "number"
        ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async readProfileIndex(): Promise<Set<string>> {
    const raw = await this.secrets.get(PROFILE_INDEX_KEY);
    if (!raw) return new Set<string>();
    try {
      const value = JSON.parse(raw) as unknown;
      return new Set(Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [normalizeProfileId(item)] : []) : []);
    } catch {
      return new Set<string>();
    }
  }

  private async writeProfileIndex(profiles: ReadonlySet<string>): Promise<void> {
    await this.secrets.store(PROFILE_INDEX_KEY, JSON.stringify([...profiles].sort()));
  }
}

export function normalizeProfileId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_OAUTH_PROFILE;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
    throw new Error("Profile IDs must use 1-64 lowercase letters, numbers, dots, underscores, or hyphens");
  }
  return normalized;
}

function profileSecretKey(profile: string): string {
  return `${PROFILE_SECRET_PREFIX}${profile}`;
}

export function parseCallback(input: string): { code?: string; state?: string; error?: string; errorDescription?: string } {
  const value = input.trim();
  let params: URLSearchParams;
  try {
    params = new URL(value).searchParams;
  } catch {
    params = new URLSearchParams(value.includes("?") ? value.slice(value.indexOf("?") + 1) : value);
  }
  return {
    code: params.get("code") ?? (value && !value.includes("=") ? value : undefined),
    state: params.get("state") ?? undefined,
    error: params.get("error") ?? undefined,
    errorDescription: params.get("error_description") ?? undefined,
  };
}

export function decodeJwt(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function tokenResponseToSession(value: unknown, previousRefresh: string | undefined, now: number): OAuthSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OpenAI token response");
  const payload = value as Record<string, unknown>;
  const accessToken = stringField(payload, "access_token");
  const refreshToken = stringField(payload, "refresh_token") ?? previousRefresh;
  if (!accessToken || !refreshToken) throw new Error("OpenAI token response is missing required tokens");
  const idClaims = decodeJwt(stringField(payload, "id_token") ?? "");
  const accessClaims = decodeJwt(accessToken);
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    accountId: extractAccountId(idClaims) ?? extractAccountId(accessClaims),
    email: typeof idClaims?.email === "string" ? idClaims.email : typeof accessClaims?.email === "string" ? accessClaims.email : undefined,
  };
}

function extractAccountId(claims: Record<string, unknown> | undefined): string | undefined {
  if (!claims) return undefined;
  if (typeof claims.chatgpt_account_id === "string") return claims.chatgpt_account_id;
  const auth = recordField(claims, "https://api.openai.com/auth");
  if (typeof auth?.chatgpt_account_id === "string") return auth.chatgpt_account_id;
  const organizations = claims.organizations;
  if (Array.isArray(organizations)) return organizations.map((item) => item && typeof item === "object" ? stringField(item as Record<string, unknown>, "id") : undefined).find(Boolean);
  return undefined;
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key] ? value[key] as string : undefined;
}

function callbackPage(title: string, message: string): string {
  const escape = (value: string) => value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[character] ?? character);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:42rem;margin:12vh auto;padding:2rem;line-height:1.5}h1{font-size:1.6rem}</style><h1>${escape(title)}</h1><p>${escape(message)}</p>`;
}
