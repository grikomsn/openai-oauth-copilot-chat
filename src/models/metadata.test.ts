import assert from "node:assert/strict";
import test from "node:test";
import {
  MODELS_DEV_API_URL,
  MODELS_DEV_CACHE_KEY,
  MODELS_DEV_CACHE_TTL_MS,
  ModelsDevMetadata,
  normalizeModelsDevSnapshot,
  parseCachedModelsDevSnapshot,
  type MetadataCache,
} from "./metadata";

class MemoryCache implements MetadataCache {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

const payload = { openai: { models: { "gpt-test": {
  name: "GPT Test",
  family: "gpt",
  reasoning: true,
  reasoning_options: [{ type: "effort", values: ["low", "high"] }],
  tool_call: true,
  modalities: { input: ["text", "image"] },
  limit: { context: 200_000, input: 175_000, output: 20_000 },
} } } };

test("normalizes the OpenAI models.dev provider", () => {
  const snapshot = normalizeModelsDevSnapshot(payload, 123);
  assert.equal(snapshot.models["gpt-test"]?.contextLength, 200_000);
  assert.equal(snapshot.models["gpt-test"]?.maxInputTokens, 175_000);
  assert.equal(snapshot.models["gpt-test"]?.imageInput, true);
  assert.deepEqual(snapshot.models["gpt-test"]?.reasoningOptions, ["low", "high"]);
  assert.equal(parseCachedModelsDevSnapshot(snapshot)?.models["gpt-test"]?.toolCalling, true);
  assert.equal(parseCachedModelsDevSnapshot(snapshot)?.models["gpt-test"]?.maxInputTokens, 175_000);
  assert.equal(parseCachedModelsDevSnapshot({ fetchedAt: -1, models: {} }), undefined);
});

test("persists, reuses, and refreshes a models.dev snapshot", async () => {
  const cache = new MemoryCache();
  let now = 1000;
  let calls = 0;
  const metadata = new ModelsDevMetadata(cache, async (input) => {
    calls += 1;
    assert.equal(String(input), MODELS_DEV_API_URL);
    return Response.json(payload);
  }, () => now);
  const first = await metadata.getOrRefresh();
  assert.equal(await metadata.getOrRefresh(), first);
  assert.equal(calls, 1);
  assert.deepEqual(cache.values.get(MODELS_DEV_CACHE_KEY), first);
  now += MODELS_DEV_CACHE_TTL_MS + 1;
  assert.equal(await metadata.getOrRefresh(), first);
  assert.equal(calls, 2);
});

test("falls back to stale persisted metadata when refresh fails", async () => {
  const cache = new MemoryCache();
  const stale = normalizeModelsDevSnapshot(payload, 1);
  cache.values.set(MODELS_DEV_CACHE_KEY, stale);
  const metadata = new ModelsDevMetadata(cache, async () => new Response("unavailable", { status: 503 }), () => 999999);
  assert.equal((await metadata.refresh()).models["gpt-test"]?.name, "GPT Test");
});
