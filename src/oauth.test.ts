import assert from "node:assert/strict";
import test from "node:test";
import { decodeJwt, parseCallback } from "./oauth";

test("parses OAuth callback URLs", () => {
  assert.deepEqual(parseCallback("http://localhost:1455/auth/callback?code=abc&state=xyz"), {
    code: "abc", state: "xyz", error: undefined, errorDescription: undefined,
  });
});

test("decodes JWT payloads", () => {
  const payload = Buffer.from(JSON.stringify({ email: "dev@example.com" })).toString("base64url");
  assert.deepEqual(decodeJwt(`header.${payload}.signature`), { email: "dev@example.com" });
});
