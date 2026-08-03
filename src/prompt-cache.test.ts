import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromptCacheRequestFields,
  createPromptCacheKey,
  createPromptCacheSessionId,
  createPromptCacheTransportHeaders,
  type PromptCacheContext,
} from "./prompt-cache";

const instructions = "Act as a coding assistant.";
const userMessage = (text: string): Record<string, unknown> => ({
  type: "message",
  role: "user",
  content: [{ type: "input_text", text }],
});
const assistantMessage = (text: string): Record<string, unknown> => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
const context = (
  input: readonly Record<string, unknown>[],
  tools: readonly Record<string, unknown>[] = [],
  model = "gpt-5.6-sol",
): PromptCacheContext => ({ model, instructions, tools, input });

test("keeps the cache key stable across normal chat turns", () => {
  const firstTurn = createPromptCacheKey(context([userMessage("Explain this code")]));
  const nextTurn = createPromptCacheKey(context([
    userMessage("Explain this code"),
    assistantMessage("Here is the explanation."),
    userMessage("Now simplify it"),
  ]));

  assert.equal(nextTurn, firstTurn);
});

test("keeps the cache key stable across agent tool loops", () => {
  const tools = [{
    type: "function",
    name: "read_file",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  }];
  const firstStep = createPromptCacheKey(context([userMessage("Fix the failing test")], tools));
  const toolStep = createPromptCacheKey(context([
    userMessage("Fix the failing test"),
    { type: "function_call", call_id: "call-1", name: "read_file", arguments: "{\"path\":\"src/app.ts\"}" },
    { type: "function_call_output", call_id: "call-1", output: "file contents" },
  ], tools));

  assert.equal(toolStep, firstStep);
});

test("keeps the cache key stable when the same request is retried", () => {
  const request = context([userMessage("Retry this request")]);
  assert.equal(
    buildPromptCacheRequestFields(request).prompt_cache_key,
    buildPromptCacheRequestFields(request).prompt_cache_key,
  );
});

test("partitions unrelated conversations and request prefixes", () => {
  const base = createPromptCacheKey(context([userMessage("Explain this code")]));
  assert.notEqual(createPromptCacheKey(context([userMessage("Write a new test")])), base);
  assert.notEqual(createPromptCacheKey({ ...context([userMessage("Explain this code")]), model: "gpt-5.5" }), base);
  assert.notEqual(createPromptCacheKey(context([userMessage("Explain this code")], [{ type: "function", name: "search" }])), base);
});

test("does not expose prompt text in the cache key", () => {
  const prompt = "private prompt contents";
  const key = createPromptCacheKey(context([userMessage(prompt)]));

  assert.match(key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /private|prompt|contents/);
});

test("builds transport-ready cache fields without changing model input", () => {
  const input = [userMessage("Explain this code")];
  const request = context(input);
  const fields = buildPromptCacheRequestFields(request);

  assert.equal(fields.input, input);
  assert.equal(fields.prompt_cache_key, createPromptCacheKey(request));
});

test("derives a stable privacy-safe session UUID from the cache key", () => {
  const cacheKey = createPromptCacheKey(context([userMessage("Explain this code")]));
  const sessionId = createPromptCacheSessionId(cacheKey);

  assert.equal(createPromptCacheSessionId(cacheKey), sessionId);
  assert.match(sessionId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(
    createPromptCacheSessionId(createPromptCacheKey(context([userMessage("Write a new test")]))),
    sessionId,
  );
});

test("uses the stable cache identity for Codex session and thread headers", () => {
  const cacheKey = createPromptCacheKey(context([userMessage("Explain this code")]));
  const sessionId = createPromptCacheSessionId(cacheKey);

  assert.deepEqual(createPromptCacheTransportHeaders(cacheKey), {
    "session-id": sessionId,
    "thread-id": sessionId,
  });
});
