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
