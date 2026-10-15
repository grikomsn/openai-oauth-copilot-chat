/** PKCE sign-in, callback handling, refresh, and SecretStorage persistence. */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type * as vscode from "vscode";
import { responseError } from "../errors";
import { createDirectFlow, directTokenSession, exchangeDirectCode, revokeDirectSession, verifyDirectIdentity,
  type DirectRegistration, type VerifyIdentity } from "./direct";
import type { RefreshLock } from "./refresh-lock";
import {
  EXTENSION_DISPLAY_NAME,
  OAUTH_ORIGINATOR,
  OPENAI_AUTHORIZE_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_REDIRECT_URI,
  OPENAI_TOKEN_URL,
  CHATGPT_API_RESOURCE,
  CHATGPT_TOKEN_URL,
  type ConnectionKind,
} from "../transport/protocol";

const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const SCOPE = "openid email profile offline_access";
const PROFILE_SECRET_PREFIX = "openaiCodex.oauthSession.v2.";
const DIRECT_SECRET_PREFIX = "openaiCodex.oauthSession.v3.";
const REGISTRATION_PREFIX = "openaiCodex.directRegistration.v1.";
export const DEFAULT_OAUTH_PROFILE = "default";

/** Persisted OAuth credentials used for ChatGPT Codex requests. */
export interface OAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  email?: string;
  kind?: ConnectionKind;
  clientId?: string;
  subject?: string;
  idToken?: string;
  scopes?: string[];
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

/** Manual authorization attempt bound to the profile generation at launch. */
export interface ManualSignIn {
  flow: AuthorizationFlow;
  complete(callbackInput: string): Promise<OAuthSession>;
}

type Fetcher = typeof fetch;

/**
 * Owns the extension's OAuth session and refresh lifecycle.
 *
 * Credentials are stored in VS Code SecretStorage; callers receive only the
 * access token and optional ChatGPT account identifier needed for a request.
 */
export class OpenAIOAuth {
  private readonly refreshPromises = new Map<string, { identity: string; promise: Promise<OAuthSession> }>();
  private readonly sessionMutations = new Map<string, Promise<void>>();
  private readonly profileGenerations = new Map<string, number>();
  private hostIdPromise?: Promise<string>;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly directOptions: {
      verifyIdentity?: VerifyIdentity;
      hostState?: { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> };
      refreshLock?: RefreshLock;
      userAgent?: string;
    } = {},
  ) {}

  async hasSession(profile = DEFAULT_OAUTH_PROFILE): Promise<boolean> {
    return Boolean(await this.loadSession(profile));
  }

  async sessionInfo(profile = DEFAULT_OAUTH_PROFILE): Promise<Pick<OAuthSession, "email" | "accountId" | "expiresAt" | "kind" | "clientId" | "subject"> | undefined> {
    const session = await this.loadSession(profile);
    return session ? { email: session.email, accountId: session.accountId, expiresAt: session.expiresAt,
      kind: session.kind, clientId: session.clientId, subject: session.subject } : undefined;
  }

  async connectionKind(profile = DEFAULT_OAUTH_PROFILE): Promise<ConnectionKind> {
    return (await this.loadSession(profile))?.kind ?? "legacy-codex";
  }

  async listProfiles(): Promise<readonly string[]> {
    const profiles: string[] = [];
    for (const key of await this.secrets.keys()) {
      const prefix = key.startsWith(DIRECT_SECRET_PREFIX) ? DIRECT_SECRET_PREFIX : PROFILE_SECRET_PREFIX;
      if (!key.startsWith(prefix)) continue;
      const profile = key.slice(prefix.length);
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile)) continue;
      if (await this.loadSession(profile)) profiles.push(profile);
    }
    return [...new Set(profiles)].sort();
  }

  async signOut(profile = DEFAULT_OAUTH_PROFILE): Promise<{ revocationConfirmed?: boolean }> {
    const normalized = normalizeProfileId(profile);
    this.invalidateProfile(normalized);
    let session: OAuthSession | undefined;
    await this.mutateSession(normalized, async () => {
      session = await this.loadSession(normalized);
      await this.secrets.delete(profileSecretKey(normalized));
      await this.secrets.delete(`${DIRECT_SECRET_PREFIX}${normalized}`);
    });
    return session?.kind === "chatgpt-direct"
      ? { revocationConfirmed: await revokeDirectSession(session, this.fetcher, this.directOptions.userAgent) }
      : {};
  }

  /** Registers a new user-owned ChatGPT client or reuses this profile's registration. */
  async startDirectBrowserSignIn(profile = DEFAULT_OAUTH_PROFILE): Promise<BrowserSignIn> {
    const normalized = normalizeProfileId(profile);
    const generation = this.beginSessionReplacement(normalized);
    const registration = await this.loadRegistration(normalized);
    const hostId = await this.hostId();
    let flow: ReturnType<typeof createDirectFlow>;
    let settled = false;
    let exchanging = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveCompletion!: (session: OAuthSession) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<OAuthSession>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    // Setup may fail before the caller can attach its completion handler.
    void completion.catch(() => undefined);
    const close = (): void => { clearTimeout(timeout); server.close(); server.closeAllConnections(); };
    const server = createServer(async (request, response) => {
      const callback = new URL(request.url ?? "/", "http://127.0.0.1");
      if (callback.pathname !== "/auth/callback") { response.writeHead(404).end("Not found"); return; }
      if (settled || exchanging) { response.writeHead(409).end("Sign-in already received"); return; }
      if (callback.searchParams.get("state") !== flow.state) { response.writeHead(400).end("Invalid OAuth state"); return; }
      exchanging = true;
      try {
        if (callback.searchParams.has("error")) throw new Error("ChatGPT sign-in was declined. No connection was changed.");
        const code = callback.searchParams.get("code");
        if (!code) throw new Error("ChatGPT callback is missing an authorization code.");
        const session = await exchangeDirectCode(code, callback.searchParams.get("client_id") ?? undefined, flow,
          this.fetcher, this.directOptions.verifyIdentity ?? verifyDirectIdentity, this.now(), this.directOptions.userAgent);
        await this.saveSession(normalized, session, generation);
        settled = true;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(callbackPage(`Signed in to ${EXTENSION_DISPLAY_NAME}`, "Return to Visual Studio Code."));
        resolveCompletion(session);
      } catch {
        settled = true;
        // Avoid reflecting token endpoints, callback values, or verification internals into logs or HTML.
        const error = new Error("ChatGPT sign-in could not be completed. Check plan permission and the selected account, then try again.");
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage("ChatGPT sign-in failed", error.message));
        rejectCompletion(error);
      } finally { server.close(); clearTimeout(timeout); }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to bind the ChatGPT callback listener.");
      flow = createDirectFlow(hostId, `http://127.0.0.1:${address.port}/auth/callback`, registration);
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.profileGeneration(normalized) === generation) this.invalidateProfile(normalized);
        close();
        rejectCompletion(new Error("ChatGPT sign-in timed out."));
      }, 5 * 60_000);
      return { url: flow.url, completion, cancel: () => {
        if (settled) return;
        settled = true;
        if (this.profileGeneration(normalized) === generation) this.invalidateProfile(normalized);
        close();
        rejectCompletion(new Error("ChatGPT sign-in cancelled."));
      } };
    } catch (error) { close(); throw error; }
  }

  private hostId(): Promise<string> {
    return this.hostIdPromise ??= (async () => {
      const key = "openaiCodex.agentHostId.v1";
      const state = this.directOptions.hostState;
      const stored = state ? state.get<unknown>(key) : await this.secrets.get(key);
      if (typeof stored === "string" && /^urn:uuid:[0-9a-f-]{36}$/i.test(stored)) return stored;
      const id = `urn:uuid:${randomUUID()}`;
      if (state) await state.update(key, id); else await this.secrets.store(key, id);
      return id;
    })();
  }

  private async loadRegistration(profile: string): Promise<DirectRegistration | undefined> {
    const raw = await this.secrets.get(`${REGISTRATION_PREFIX}${profile}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<DirectRegistration> | null;
    if (!value || typeof value.clientId !== "string" || !value.clientId || value.clientId === "dynamic_agent_client"
      || typeof value.subject !== "string" || !value.subject) throw new Error("Invalid saved ChatGPT registration.");
    return value as DirectRegistration;
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

  startManualSignIn(profile = DEFAULT_OAUTH_PROFILE): ManualSignIn {
    const normalized = normalizeProfileId(profile);
    const generation = this.beginSessionReplacement(normalized);
    const flow = this.createAuthorizationFlow();
    return {
      flow,
      complete: (callbackInput) => this.completeAuthorization(callbackInput, flow, normalized, generation),
    };
  }

  async startBrowserSignIn(profile = DEFAULT_OAUTH_PROFILE): Promise<BrowserSignIn> {
    const normalizedProfile = normalizeProfileId(profile);
    const generation = this.beginSessionReplacement(normalizedProfile);
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
          const session = await this.completeAuthorization(callback.toString(), flow, normalizedProfile, generation);
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
    expectedGeneration?: number,
  ): Promise<OAuthSession> {
    const normalized = normalizeProfileId(profile);
    const generation = expectedGeneration ?? this.beginSessionReplacement(normalized);
    const callback = parseCallback(callbackInput);
    if (callback.error) throw new Error(callback.errorDescription ?? callback.error);
    if (!callback.code) throw new Error("The callback does not contain an authorization code");
    if (callback.state !== flow.state) throw new Error("Invalid OpenAI OAuth callback state");
    if (this.profileGeneration(normalized) !== generation) {
      throw new Error(`OpenAI Codex sign-in for profile “${normalized}” was superseded`);
    }
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
    await this.saveSession(normalized, session, generation);
    return session;
  }

  async getAccessToken(forceRefresh = false, profile = DEFAULT_OAUTH_PROFILE): Promise<{ token: string; accountId?: string; kind?: ConnectionKind; connectionId?: string }> {
    const normalizedProfile = normalizeProfileId(profile);
    const session = await this.loadSession(normalizedProfile);
    if (!session) throw new Error(`Sign in to OpenAI Codex profile “${normalizedProfile}” first`);
    const valid = !forceRefresh && session.expiresAt > this.now() + 60_000;
    const current = valid ? session : await this.refresh(normalizedProfile, session);
    return { token: current.accessToken, accountId: current.accountId, ...(current.kind ? { kind: current.kind } : {}),
      connectionId: current.clientId ?? current.accountId ?? current.email };
  }

  async importCodexCliSession(profile = DEFAULT_OAUTH_PROFILE): Promise<OAuthSession> {
    const normalized = normalizeProfileId(profile);
    const generation = this.beginSessionReplacement(normalized);
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
    await this.saveSession(normalized, session, generation);
    return session;
  }

  private async refresh(profile: string, session: OAuthSession): Promise<OAuthSession> {
    let identity = sessionIdentity(session);
    const generation = this.profileGeneration(profile);
    const existing = this.refreshPromises.get(profile);
    if (existing?.identity === identity) return existing.promise;
    let refreshPromise: Promise<OAuthSession>;
    const operation = async (): Promise<OAuthSession> => {
      const direct = session.kind === "chatgpt-direct";
      if (direct) {
        const latest = await this.loadSession(profile);
        if (!latest || this.profileGeneration(profile) !== generation) throw new Error("ChatGPT connection changed before token refresh.");
        if (latest.kind !== session.kind || latest.clientId !== session.clientId) throw new Error("ChatGPT registration changed before token refresh. Select the model again.");
        if (sessionIdentity(latest) !== identity) {
          if (latest.expiresAt > this.now() + 60_000) return latest;
          session = latest;
          identity = sessionIdentity(latest);
        }
      }
      const response = await this.fetcher(direct ? CHATGPT_TOKEN_URL : OPENAI_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Originator: OAUTH_ORIGINATOR, "User-Agent": this.directOptions.userAgent ?? OAUTH_ORIGINATOR },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: direct ? session.clientId! : OPENAI_OAUTH_CLIENT_ID,
          refresh_token: session.refreshToken,
          ...(direct ? { resource: CHATGPT_API_RESOURCE } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        if (direct) {
          const rawFailure: unknown = await response.clone().json().catch(() => undefined);
          const failure = rawFailure && typeof rawFailure === "object" && !Array.isArray(rawFailure) ? rawFailure as Record<string, unknown> : {};
          const code = typeof failure.error === "string" ? failure.error : recordField(failure, "error")?.code ?? failure.code;
          if (typeof code === "string" && ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(code)) {
            await this.mutateSession(profile, async () => {
              const current = await this.loadSession(profile);
              if (current && sessionIdentity(current) === identity && this.profileGeneration(profile) === generation) {
                await this.secrets.delete(`${DIRECT_SECRET_PREFIX}${profile}`);
              }
            });
            throw new Error("ChatGPT session expired or was revoked. Continue with ChatGPT again to reconnect this profile.");
          }
        }
        throw await responseError("OpenAI token refresh failed", response);
      }
      const payload: unknown = await response.json();
      const refreshed = direct ? directTokenSession(payload, session.clientId!, this.now(), session)
        : tokenResponseToSession(payload, session.refreshToken, this.now());
      let persisted = false;
      await this.mutateSession(profile, async () => {
        const current = await this.loadSession(profile);
        if (this.profileGeneration(profile) === generation && current && sessionIdentity(current) === identity) {
          await this.storeSession(profile, refreshed);
          persisted = this.profileGeneration(profile) === generation;
        }
      });
      if (!persisted) throw new Error(`OpenAI Codex profile “${profile}” changed while its session was refreshing`);
      return refreshed;
    };
    refreshPromise = (session.kind === "chatgpt-direct" && this.directOptions.refreshLock
      ? this.directOptions.refreshLock(profile, operation) : operation()).finally(() => {
        if (this.refreshPromises.get(profile)?.promise === refreshPromise) this.refreshPromises.delete(profile);
      });
    this.refreshPromises.set(profile, { identity, promise: refreshPromise });
    return refreshPromise;
  }

  private async saveSession(profile: string, session: OAuthSession, expectedGeneration: number): Promise<void> {
    const normalized = normalizeProfileId(profile);
    await this.mutateSession(normalized, async () => {
      if (this.profileGeneration(normalized) !== expectedGeneration) {
        throw new Error(`OpenAI Codex sign-in for profile “${normalized}” was superseded`);
      }
      await this.storeSession(normalized, session);
      if (this.profileGeneration(normalized) !== expectedGeneration) {
        const current = await this.loadSession(normalized);
        if (current && sessionIdentity(current) === sessionIdentity(session)) {
          await this.secrets.delete(session.kind === "chatgpt-direct" ? `${DIRECT_SECRET_PREFIX}${normalized}` : profileSecretKey(normalized));
        }
        throw new Error(`OpenAI Codex sign-in for profile “${normalized}” was superseded`);
      }
    });
  }

  private async storeSession(profile: string, session: OAuthSession): Promise<void> {
    const normalized = normalizeProfileId(profile);
    if (session.kind === "chatgpt-direct") {
      await this.secrets.store(`${REGISTRATION_PREFIX}${normalized}`, JSON.stringify({ clientId: session.clientId, subject: session.subject, email: session.email }));
      await this.secrets.store(`${DIRECT_SECRET_PREFIX}${normalized}`, JSON.stringify(session));
      await this.secrets.delete(profileSecretKey(normalized));
    } else {
      await this.secrets.store(profileSecretKey(normalized), JSON.stringify(session));
      await this.secrets.delete(`${DIRECT_SECRET_PREFIX}${normalized}`);
    }
  }

  private async loadSession(profile: string): Promise<OAuthSession | undefined> {
    const normalized = normalizeProfileId(profile);
    const directRaw = await this.secrets.get(`${DIRECT_SECRET_PREFIX}${normalized}`);
    const raw = directRaw ?? await this.secrets.get(profileSecretKey(normalized));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as OAuthSession;
      return value && typeof value.accessToken === "string" && value.accessToken.length > 0
        && typeof value.refreshToken === "string" && value.refreshToken.length > 0 && Number.isFinite(value.expiresAt)
        && (directRaw ? (value.kind === "chatgpt-direct" && typeof value.clientId === "string" && Boolean(value.clientId)
          && value.clientId !== "dynamic_agent_client" && typeof value.subject === "string" && Boolean(value.subject.trim())
          && Array.isArray(value.scopes) && value.scopes.includes("chatgpt.tokens.use.direct")) : value.kind !== "chatgpt-direct")
        ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async mutateSession(profile: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.sessionMutations.get(profile) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.sessionMutations.set(profile, current);
    try {
      await current;
    } finally {
      if (this.sessionMutations.get(profile) === current) this.sessionMutations.delete(profile);
    }
  }

  private profileGeneration(profile: string): number {
    return this.profileGenerations.get(profile) ?? 0;
  }

  private beginSessionReplacement(profile: string): number {
    const generation = this.profileGeneration(profile) + 1;
    this.profileGenerations.set(profile, generation);
    return generation;
  }

  private invalidateProfile(profile: string): void {
    this.profileGenerations.set(profile, this.profileGeneration(profile) + 1);
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

function sessionIdentity(session: OAuthSession): string {
  return `${session.accessToken}\u0000${session.refreshToken}\u0000${session.expiresAt}`;
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
