import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { decodeJwt, normalizeProfileId, OpenAIOAuth, parseCallback } from "./auth";
import { OAUTH_ORIGINATOR } from "../transport/protocol";

test("parses OAuth callback URLs", () => {
  assert.deepEqual(parseCallback("http://localhost:1455/auth/callback?code=abc&state=xyz"), {
    code: "abc", state: "xyz", error: undefined, errorDescription: undefined,
  });
});

test("decodes JWT payloads", () => {
  const payload = Buffer.from(JSON.stringify({ email: "dev@example.com" })).toString("base64url");
  assert.deepEqual(decodeJwt(`header.${payload}.signature`), { email: "dev@example.com" });
});

test("identifies the extension as the OAuth originator", () => {
  const oauth = new OpenAIOAuth({} as vscode.SecretStorage);
  const authorization = new URL(oauth.createAuthorizationFlow().url);
  assert.equal(authorization.searchParams.get("originator"), OAUTH_ORIGINATOR);
  assert.notEqual(authorization.searchParams.get("originator"), "codex_cli_rs");
});

test("rejects OAuth callbacks with missing or mismatched state before token exchange", async () => {
  let fetchCalls = 0;
  const fetcher = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  }) as typeof fetch;
  const oauth = new OpenAIOAuth({} as vscode.SecretStorage, fetcher);
  const flow = { url: "https://auth.openai.com", state: "expected-state", verifier: "verifier" };

  await assert.rejects(
    oauth.completeAuthorization("http://localhost:1455/auth/callback?code=abc", flow),
    /Invalid OpenAI OAuth callback state/,
  );
  await assert.rejects(
    oauth.completeAuthorization("http://localhost:1455/auth/callback?code=abc&state=wrong-state", flow),
    /Invalid OpenAI OAuth callback state/,
  );
  assert.equal(fetchCalls, 0);
});

test("stores and resolves OAuth sessions independently by profile", async () => {
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => { values.set(key, value); },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as vscode.SecretStorage;
  let token = "personal-token";
  const fetcher = (async () => new Response(JSON.stringify({
    access_token: token,
    refresh_token: `${token}-refresh`,
    expires_in: 3600,
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const oauth = new OpenAIOAuth(secrets, fetcher, () => 1_000);
  const flow = { url: "https://auth.openai.com", state: "state", verifier: "verifier" };

  await oauth.completeAuthorization("?code=one&state=state", flow, "personal");
  token = "work-token";
  await oauth.completeAuthorization("?code=two&state=state", flow, "work");

  assert.deepEqual(await oauth.listProfiles(), ["personal", "work"]);
  assert.equal((await oauth.getAccessToken(false, "personal")).token, "personal-token");
  assert.equal((await oauth.getAccessToken(false, "work")).token, "work-token");
  await oauth.signOut("personal");
  assert.equal(await oauth.hasSession("personal"), false);
  assert.equal(await oauth.hasSession("work"), true);
});

test("normalizes safe profile IDs and rejects ambiguous values", () => {
  assert.equal(normalizeProfileId(" Work.Profile "), "work.profile");
  assert.throws(() => normalizeProfileId("work profile"), /Profile IDs/);
});

test("serializes concurrent profile-index updates", async () => {
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      if (key.includes("oauthProfiles")) await new Promise((resolve) => setTimeout(resolve, 5));
      values.set(key, value);
    },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as vscode.SecretStorage;
  const oauth = new OpenAIOAuth(secrets, (async (_input, init) => {
    const code = new URLSearchParams(String(init?.body)).get("code");
    return Response.json({ access_token: `${code}-access`, refresh_token: `${code}-refresh`, expires_in: 3600 });
  }) as typeof fetch, () => 1_000);
  const flow = { url: "https://auth.openai.com", state: "state", verifier: "verifier" };

  await Promise.all([
    oauth.completeAuthorization("?code=personal&state=state", flow, "personal"),
    oauth.completeAuthorization("?code=work&state=state", flow, "work"),
  ]);
  assert.deepEqual(await oauth.listProfiles(), ["personal", "work"]);
});

test("does not persist a refresh that finishes after sign-out", async () => {
  const values = new Map<string, string>([["openaiCodex.oauthSession.v2.work", JSON.stringify({
    accessToken: "old-access", refreshToken: "old-refresh", expiresAt: 0,
  })]]);
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => { values.set(key, value); },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as vscode.SecretStorage;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const oauth = new OpenAIOAuth(secrets, (async () => {
    await wait;
    return Response.json({ access_token: "refreshed", refresh_token: "rotated", expires_in: 3600 });
  }) as typeof fetch, () => 1_000);

  const refreshing = oauth.getAccessToken(false, "work");
  await oauth.signOut("work");
  release();
  await assert.rejects(refreshing, /changed while its session was refreshing/);
  assert.equal(await oauth.hasSession("work"), false);
});

test("does not persist an authorization exchange that finishes after sign-out", async () => {
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => { values.set(key, value); },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as vscode.SecretStorage;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const oauth = new OpenAIOAuth(secrets, (async () => {
    await wait;
    return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  }) as typeof fetch, () => 1_000);
  const flow = { url: "https://auth.openai.com", state: "state", verifier: "verifier" };
  const signingIn = oauth.completeAuthorization("?code=one&state=state", flow, "work");
  await oauth.signOut("work");
  release();
  await assert.rejects(signingIn, /was superseded/);
  assert.equal(await oauth.hasSession("work"), false);
});

test("does not start a late manual callback after sign-out", async () => {
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => { values.set(key, value); },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as vscode.SecretStorage;
  let fetchCalls = 0;
  const oauth = new OpenAIOAuth(secrets, (async () => {
    fetchCalls += 1;
    return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  }) as typeof fetch, () => 1_000);
  const attempt = oauth.startManualSignIn("work");
  await oauth.signOut("work");

  await assert.rejects(
    attempt.complete(`?code=one&state=${attempt.flow.state}`),
    /was superseded/,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(await oauth.hasSession("work"), false);
});
