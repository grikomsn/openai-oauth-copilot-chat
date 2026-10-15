import assert from "node:assert/strict";
import test from "node:test";
import { providerRequestError, ProviderRequestError, responseError } from "./errors";
import { ResponsesStreamParser } from "./transport/responses";

test("preserves cap errors from HTTP and after stream output without echoing private bodies", async () => {
  const error = { code: "subscription_sharing_usage_limit_exceeded", message: "private synthetic body" };
  const http = await responseError("Request failed", Response.json({ error }, { status: 429, headers: { "x-request-id": "req_synthetic" } }));
  assert.ok(http instanceof ProviderRequestError);
  assert.equal(http.code, error.code);
  assert.equal(http.requestId, "req_synthetic");
  assert.equal(http.retryable, false);
  assert.match(http.message, /app limits/);
  assert.doesNotMatch(http.message, /private synthetic/);
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.output_text.delta","delta":"synthetic"}\n\ndata: ' + JSON.stringify({ type: "response.failed", response: { error } }) + "\n\n");
  assert.equal(events[1].failure?.code, error.code);
  assert.throws(() => parser.validateCompletion(), /before response.completed/);
});

test("distinguishes temporary unavailability and removes unstructured admission bodies", async () => {
  assert.equal(providerRequestError({ error: { code: "subscription_sharing_usage_unavailable" } }).retryable, true);
  assert.equal(providerRequestError({ error: { code: "subscription_sharing_user_not_eligible" } }).retryable, false);
  const error = await responseError("Request failed", Response.json({ detail: "synthetic sensitive detail" }, { status: 403 }));
  assert.equal(error.message, "Request failed (403)");
});
