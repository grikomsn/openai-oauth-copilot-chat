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

function tokenSource(): { token: vscode.CancellationToken; cancel(): void; disposed(): boolean } {
  let callback = () => {};
  let disposed = false;
  const token = { isCancellationRequested: false, onCancellationRequested(listener: () => void) {
    callback = listener;
    return { dispose() { disposed = true; } };
  } };
  return { token: token as vscode.CancellationToken, cancel() { token.isCancellationRequested = true; callback(); }, disposed: () => disposed };
}

test("retains cancellation after headers and disposes the blocked body", async () => {
  const source = tokenSource();
  let aborted = false;
  let cancelled = false;
  const fetcher: typeof fetch = async (_url, init) => {
    init!.signal!.addEventListener("abort", () => { aborted = true; });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  };
  const transport = new CodexTransport({ getAccessToken: async () => ({ token: "synthetic" }) } as never, "test", () => 10, () => "1", fetcher);
  const response = await transport.sendResponse({}, source.token);
  assert.equal(source.disposed(), false);
  const reading = response.text();
  source.cancel();
  await assert.rejects(reading, /abort/i);
  assert.equal(aborted, true);
  assert.equal(cancelled, true);
  assert.equal(source.disposed(), true);
});

test("cleans up on EOF and cancels the first 401 body before one forced refresh", async () => {
  const refreshes: boolean[] = [];
  let attempts = 0;
  let cancelled = false;
  const source = tokenSource();
  const fetcher: typeof fetch = async () => ++attempts === 1
    ? new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 401 })
    : new Response("done");
  const transport = new CodexTransport({ getAccessToken: async (force: boolean) => { refreshes.push(force); return { token: "synthetic" }; } } as never, "test", () => 10, () => "1", fetcher);
  const response = await transport.sendResponse({}, source.token);
  assert.equal(await response.text(), "done");
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(cancelled, true);
  assert.equal(source.disposed(), true);
});

test("the total timeout still aborts a stalled body after headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = tokenSource();
  const transport = new CodexTransport({ getAccessToken: async () => ({ token: "synthetic" }) } as never, "test", () => 10, () => "1",
    async () => new Response(new ReadableStream()));
  const response = await transport.sendResponse({}, source.token);
  const reading = response.text();
  t.mock.timers.tick(10000);
  await assert.rejects(reading, /timed out/);
  assert.equal(source.disposed(), true);
});
