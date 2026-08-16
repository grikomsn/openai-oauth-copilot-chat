import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { decodeJwt, OpenAIOAuth, parseCallback } from "./auth";
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
