import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type * as vscode from "vscode";
import { OpenAIOAuth } from "./auth";
import { createDirectFlow, exchangeDirectCode, verifyDirectIdentity, revokeDirectSession } from "./direct";
import { CHATGPT_DIRECT_SCOPE, CHATGPT_TOKEN_URL } from "../transport/protocol";
import { createRefreshLock } from "./refresh-lock";

const tokenPayload = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, id_token: "synthetic-id", scope: CHATGPT_DIRECT_SCOPE };
const verify = async () => ({ subject: "synthetic-subject", email: "synthetic@example.test" });
function secretStore(): vscode.SecretStorage {
  const values = new Map<string, string>();
  return { keys: async () => [...values.keys()], get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } } as unknown as vscode.SecretStorage;
}

test("requests independent PKCE/state/nonce and reuses a registered client without another name hint", () => {
  const first = createDirectFlow("urn:uuid:host", "http://127.0.0.1:43210/auth/callback");
  const url = new URL(first.url);
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("agent_name_hint"), "Codex Bridge for Copilot Chat");
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "client_id", "agent_name_hint", "ext_agent_host_id", "response_type", "redirect_uri", "scope", "resource", "state", "nonce",
    "code_challenge_method", "code_challenge",
  ].sort());
  assert.equal(url.searchParams.has("originator"), false);
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(first.verifier).digest("base64url"));
  const next = createDirectFlow("urn:uuid:host", "http://127.0.0.1:43211/auth/callback", { clientId: "oaiapp_synthetic", subject: "synthetic-subject" });
  assert.notEqual(first.state, next.state);
  assert.notEqual(first.nonce, next.nonce);
  assert.equal(new URL(next.url).searchParams.has("agent_name_hint"), false);
  assert.equal(new URL(next.url).searchParams.get("client_id"), "oaiapp_synthetic");
  assert.equal(new URL(next.url).searchParams.has("originator"), false);
});

test("exchanges with the issued client and exact callback/resource, checking plan permission and identity", async () => {
  const flow = createDirectFlow("host", "http://127.0.0.1:54321/auth/callback");
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests += 1;
    assert.equal(input, CHATGPT_TOKEN_URL);
    assert.equal(new Headers(init?.headers).get("Originator"), "openai-oauth-copilot-chat");
    assert.equal(new Headers(init?.headers).get("User-Agent"), "openai-oauth-copilot-chat");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("client_id"), "oaiapp_synthetic");
    assert.equal(form.get("redirect_uri"), flow.redirectUri);
    assert.equal(form.get("resource"), "https://api.openai.com/v1");
    return Response.json(tokenPayload);
  };
  const session = await exchangeDirectCode("synthetic-code", "oaiapp_synthetic", flow, fetcher, verify, 1000);
  assert.equal(session.subject, "synthetic-subject");
  assert.equal(session.kind, "chatgpt-direct");
  assert.equal(session.expiresAt, 3601000);
  await assert.rejects(exchangeDirectCode("code", undefined, flow, fetcher, verify, 1000), /issued client/);
  const returning = { ...flow, registration: { clientId: "oaiapp_synthetic", subject: "other-subject" } };
  await assert.rejects(exchangeDirectCode("code", undefined, returning, fetcher, verify, 1000), /different account/);
  await assert.rejects(exchangeDirectCode("code", "other-client", returning, fetcher, verify, 1000), /different client/);
  await assert.rejects(exchangeDirectCode("code", "oaiapp_synthetic", flow, async () => Response.json({ ...tokenPayload, scope: "openid" }), verify, 1000), /not authorized/);
  assert.equal(requests, 2);
});

test("validates a signed ID token, rejecting forged, expired, wrong-audience and wrong-nonce identities", async (t) => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  const server = createServer((_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ keys: [{ ...jwk, kid: "test", alg: "RS256" }] })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/jwks`);
  const sign = (audience = "client", expiry = "1m", key = pair.privateKey) => new SignJWT({ nonce: "nonce" }).setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://auth.openai.com").setAudience(audience).setSubject("subject").setExpirationTime(expiry).sign(key);
  const valid = await sign();
  assert.deepEqual(await verifyDirectIdentity(valid, "client", "nonce", endpoint), { subject: "subject", email: undefined });
  await assert.rejects(verifyDirectIdentity(valid, "client", "wrong", endpoint));
  await assert.rejects(verifyDirectIdentity(await sign("other"), "client", "nonce", endpoint));
  await assert.rejects(verifyDirectIdentity(await sign("client", "-1s"), "client", "nonce", endpoint));
  const forged = await generateKeyPair("RS256");
  await assert.rejects(verifyDirectIdentity(await sign("client", "1m", forged.privateKey), "client", "nonce", endpoint));
});

test("loopback sign-in ignores foreign state, stores per-profile credentials, refreshes and retains registration on sign-out", async () => {
  const secrets = secretStore();
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(String(input));
    if (String(input).endsWith("openid-configuration")) return Response.json({ revocation_endpoint: "https://auth.openai.com/oauth/revoke" });
    if (String(input).endsWith("/revoke")) return new Response(null, { status: 200 });
    const form = new URLSearchParams(String(init?.body));
    if (form.get("grant_type") === "refresh_token") {
      assert.equal(form.get("client_id"), "oaiapp_synthetic");
      return Response.json({ ...tokenPayload, access_token: "rotated-access", refresh_token: "rotated-refresh" });
    }
    return Response.json(tokenPayload);
  };
  const oauth = new OpenAIOAuth(secrets, fetcher, Date.now, { verifyIdentity: verify });
  const attempt = await oauth.startDirectBrowserSignIn("personal");
  const url = new URL(attempt.url);
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  assert.equal(callback.hostname, "127.0.0.1");
  callback.search = new URLSearchParams({ code: "synthetic", state: "wrong", client_id: "oaiapp_synthetic" }).toString();
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(requests.length, 0);
  callback.searchParams.set("state", url.searchParams.get("state")!);
  assert.equal((await fetch(callback)).status, 200);
  await attempt.completion;
  assert.equal((await oauth.getAccessToken(true, "personal")).token, "rotated-access");
  assert.deepEqual(await oauth.listProfiles(), ["personal"]);
  assert.equal((await oauth.signOut("personal")).revocationConfirmed, true);
  assert.equal(await oauth.hasSession("personal"), false);
  const next = await new OpenAIOAuth(secrets, fetcher, Date.now, { verifyIdentity: verify }).startDirectBrowserSignIn("personal");
  const returning = new URL(next.url);
  assert.equal(returning.searchParams.get("client_id"), "oaiapp_synthetic");
  assert.equal(returning.searchParams.get("ext_agent_host_id"), url.searchParams.get("ext_agent_host_id"));
  next.cancel();
  await assert.rejects(next.completion, /cancelled/);
});

test("a cancelled direct exchange cannot replace an existing legacy connection", async () => {
  const secrets = secretStore();
  await secrets.store("openaiCodex.oauthSession.v2.work", JSON.stringify({ accessToken: "legacy", refreshToken: "legacy-refresh", expiresAt: Date.now() + 100000 }));
  let release!: () => void;
  let started!: () => void;
  const startedExchange = new Promise<void>((resolve) => { started = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const oauth = new OpenAIOAuth(secrets, async () => { started(); await wait; return Response.json(tokenPayload); }, Date.now, { verifyIdentity: verify });
  const attempt = await oauth.startDirectBrowserSignIn("work");
  const url = new URL(attempt.url);
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({ code: "code", state: url.searchParams.get("state")!, client_id: "oaiapp_synthetic" }).toString();
  const request = fetch(callback).catch(() => undefined);
  await startedExchange;
  attempt.cancel();
  release();
  await assert.rejects(attempt.completion, /cancelled/);
  await request;
  assert.equal((await oauth.getAccessToken(false, "work")).token, "legacy");
});

test("revocation never sends credentials to a discovery-provided foreign origin", async () => {
  let calls = 0;
  assert.equal(await revokeDirectSession({ accessToken: "synthetic", refreshToken: "synthetic", expiresAt: 0, clientId: "client" }, async () => {
    calls += 1; return Response.json({ revocation_endpoint: "https://untrusted.invalid/revoke" });
  }), false);
  assert.equal(calls, 1);
});

test("multiple extension hosts share one rotating refresh and terminal refresh errors retain registration only", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-refresh-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secrets = secretStore();
  const record = { kind: "chatgpt-direct", accessToken: "old", refreshToken: "old-refresh", expiresAt: 0,
    subject: "subject", clientId: "oaiapp_synthetic", scopes: [CHATGPT_DIRECT_SCOPE] };
  await secrets.store("openaiCodex.oauthSession.v3.work", JSON.stringify(record));
  await secrets.store("openaiCodex.directRegistration.v1.work", JSON.stringify({ clientId: record.clientId, subject: record.subject }));
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return Response.json(tokenPayload); };
  const first = new OpenAIOAuth(secrets, fetcher, Date.now, { refreshLock: createRefreshLock(directory) });
  const second = new OpenAIOAuth(secrets, fetcher, Date.now, { refreshLock: createRefreshLock(directory) });
  const result = await Promise.all([first.getAccessToken(false, "work"), second.getAccessToken(false, "work")]);
  assert.equal(calls, 1);
  assert.equal(result[0].token, result[1].token);
  const terminal = new OpenAIOAuth(secrets, async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
  await assert.rejects(terminal.getAccessToken(true, "work"), /expired or was revoked/);
  assert.equal(await terminal.hasSession("work"), false);
  assert.ok(await secrets.get("openaiCodex.directRegistration.v1.work"));
});
