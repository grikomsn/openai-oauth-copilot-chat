/** ChatGPT plan authorization, validated identity, and renewable sessions. */
import { createHash, randomBytes } from "node:crypto";
import type { AuthorizationFlow, OAuthSession } from "./auth";
import { responseError } from "../errors";
import {
  CHATGPT_API_RESOURCE, CHATGPT_AUTHORIZE_URL, CHATGPT_DIRECT_SCOPE, CHATGPT_ISSUER,
  CHATGPT_TOKEN_URL, EXTENSION_DISPLAY_NAME, OAUTH_ORIGINATOR,
} from "../transport/protocol";

export interface DirectRegistration {
  clientId: string;
  subject: string;
  email?: string;
}

export interface DirectAuthorizationFlow extends AuthorizationFlow {
  nonce: string;
  redirectUri: string;
  registration?: DirectRegistration;
}

export type VerifyIdentity = (token: string, clientId: string, nonce: string) => Promise<{ subject: string; email?: string }>;

export function createDirectFlow(hostId: string, redirectUri: string, registration?: DirectRegistration): DirectAuthorizationFlow {
  const verifier = randomBytes(64).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const url = new URL(CHATGPT_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: registration?.clientId ?? "dynamic_agent_client",
    ...(registration ? {} : { agent_name_hint: EXTENSION_DISPLAY_NAME }),
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: `openid profile email offline_access resource.invoke ${CHATGPT_DIRECT_SCOPE}`,
    resource: CHATGPT_API_RESOURCE,
    state, nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    originator: OAUTH_ORIGINATOR,
  }).toString();
  return { url: url.toString(), state, verifier, nonce, redirectUri, registration };
}

export async function verifyDirectIdentity(token: string, clientId: string, nonce: string,
  jwksUrl = new URL(`${CHATGPT_ISSUER}/.well-known/jwks.json`)): Promise<{ subject: string; email?: string }> {
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, createRemoteJWKSet(jwksUrl), {
    issuer: CHATGPT_ISSUER, audience: clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "nonce"],
  }).catch(() => { throw new Error("ChatGPT returned an invalid ID token. Sign in again."); });
  if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.nonce !== nonce) {
    throw new Error("ChatGPT returned an invalid sign-in identity or nonce.");
  }
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
}

export async function exchangeDirectCode(
  code: string, issuedClientId: string | undefined, flow: DirectAuthorizationFlow,
  fetcher: typeof fetch, verify: VerifyIdentity, now: number,
  userAgent = OAUTH_ORIGINATOR,
): Promise<OAuthSession> {
  if (flow.registration && issuedClientId && issuedClientId !== flow.registration.clientId) {
    throw new Error("ChatGPT returned a different client registration. Add a separate profile for another account.");
  }
  const clientId = flow.registration?.clientId ?? issuedClientId;
  if (!clientId || clientId === "dynamic_agent_client") throw new Error("ChatGPT did not return an issued client ID. Sign in again.");
  const response = await fetcher(CHATGPT_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Originator: OAUTH_ORIGINATOR, "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code,
      code_verifier: flow.verifier, redirect_uri: flow.redirectUri, resource: CHATGPT_API_RESOURCE }),
  });
  if (!response.ok) throw await responseError("ChatGPT token exchange failed", response);
  const payload: unknown = await response.json();
  const session = directTokenSession(payload, clientId, now);
  if (!session.idToken) throw new Error("ChatGPT did not return an ID token.");
  const identity = await verify(session.idToken, clientId, flow.nonce);
  if (flow.registration && identity.subject !== flow.registration.subject) {
    throw new Error("ChatGPT returned a different account. Add a separate profile for another account.");
  }
  return { ...session, ...identity };
}

export function directTokenSession(raw: unknown, clientId: string, now: number, previous?: OAuthSession): OAuthSession {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (typeof value.access_token !== "string" || !value.access_token || typeof value.refresh_token !== "string" || !value.refresh_token) {
    throw new Error("ChatGPT token response is missing required tokens.");
  }
  const scopes = typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
  if (!scopes.includes(CHATGPT_DIRECT_SCOPE)) throw new Error("ChatGPT plan usage was not authorized. Sign in again and allow plan usage.");
  if (typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) || value.expires_in <= 0) {
    throw new Error("ChatGPT token response has an invalid expiry.");
  }
  return {
    ...previous, kind: "chatgpt-direct", clientId, scopes,
    accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: now + value.expires_in * 1000,
    idToken: typeof value.id_token === "string" ? value.id_token : previous?.idToken,
  };
}

/** Discovery is pinned to the issuer; never send credentials to a supplied foreign endpoint. */
export async function revokeDirectSession(session: OAuthSession, fetcher: typeof fetch, userAgent = OAUTH_ORIGINATOR): Promise<boolean> {
  try {
    const discovery = await fetcher(`${CHATGPT_ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8_000) });
    if (!discovery.ok) return false;
    const config = await discovery.json() as Record<string, unknown>;
    const endpoint = typeof config.revocation_endpoint === "string" ? new URL(config.revocation_endpoint) : undefined;
    if (!endpoint || endpoint.origin !== CHATGPT_ISSUER || endpoint.username || endpoint.password) return false;
    const response = await fetcher(endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Originator: OAUTH_ORIGINATOR, "User-Agent": userAgent }, signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({ token: session.refreshToken, token_type_hint: "refresh_token", client_id: session.clientId! }),
    });
    return response.ok;
  } catch { return false; }
}
