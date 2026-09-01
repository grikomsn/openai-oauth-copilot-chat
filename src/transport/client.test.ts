import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { CodexTransport } from "./client";

test("routes each response through the profile embedded in the selected model", async () => {
  const requestedProfiles: string[] = [];
  const oauth = {
    async getAccessToken(_forceRefresh: boolean, profile: string) {
      requestedProfiles.push(profile);
      return { token: `${profile}-token`, accountId: `${profile}-account` };
    },
  };
  const requests: Array<{ authorization: string | null; accountId: string | null }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      authorization: headers.get("Authorization"),
      accountId: headers.get("ChatGPT-Account-ID"),
    });
    return new Response(null, { status: 200 });
  };
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  } as unknown as vscode.CancellationToken;
  const transport = new CodexTransport(
    oauth as never,
    "test-agent",
    () => 10,
    () => "1.0.0",
    fetcher,
  );

  await transport.sendResponse({ model: "gpt-test" }, cancellation, "personal");
  await transport.sendResponse({ model: "gpt-test" }, cancellation, "work");

  assert.deepEqual(requestedProfiles, ["personal", "work"]);
  assert.deepEqual(requests, [
    { authorization: "Bearer personal-token", accountId: "personal-account" },
    { authorization: "Bearer work-token", accountId: "work-account" },
  ]);
});

test("retries transient response fetch failures without refreshing OAuth", async () => {
  let tokenRequests = 0;
  let fetchAttempts = 0;
  const oauth = { async getAccessToken() { tokenRequests += 1; return { token: "token" }; } };
  const fetcher: typeof fetch = async () => {
    fetchAttempts += 1;
    if (fetchAttempts < 3) throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    return new Response(null, { status: 200 });
  };
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  } as unknown as vscode.CancellationToken;
  const transport = new CodexTransport(oauth as never, "test-agent", () => 10, () => "1.0.0", fetcher);

  const response = await transport.sendResponse({ model: "gpt-test" }, cancellation);

  assert.equal(response.status, 200);
  assert.equal(fetchAttempts, 3);
  assert.equal(tokenRequests, 1);
});
