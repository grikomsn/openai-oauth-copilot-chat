import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsageStatusBar,
  mergeQuotaPayload,
  recordRequestUsage,
  toProviderUsagePayload,
} from "./usage";

test("normalizes Responses API usage for Copilot inference reporting", () => {
  assert.deepEqual(toProviderUsagePayload({
    input_tokens: 120,
    output_tokens: 30,
    input_tokens_details: { cached_tokens: 40, cache_write_tokens: 80 },
    output_tokens_details: { reasoning_tokens: 12 },
  }), {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150,
    prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 80 },
    completion_tokens_details: { reasoning_tokens: 12 },
  });
});

test("tracks request tokens without discarding quota windows", () => {
  const snapshot = recordRequestUsage({ primary: { usedPercent: 20 } }, {
    input_tokens: 100,
    output_tokens: 25,
  }, "gpt-5.6-sol", 1_000);
  assert.equal(snapshot.primary?.usedPercent, 20);
  assert.deepEqual(snapshot.tracked, {
    requests: 1,
    promptTokens: 100,
    completionTokens: 25,
    totalTokens: 125,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  });
});

test("parses Codex primary and secondary subscription windows", () => {
  const snapshot = mergeQuotaPayload({}, {
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 18, limit_window_seconds: 18_000, reset_at: 2_000 },
      secondary_window: { used_percent: 42, limit_window_seconds: 604_800, reset_at: 3_000 },
    },
    credits: { has_credits: true, unlimited: false, balance: "12.50" },
  }, 1_500);
  assert.equal(snapshot.planType, "plus");
  assert.deepEqual(snapshot.primary, { usedPercent: 18, windowSeconds: 18_000, resetsAt: 2_000_000 });
  assert.deepEqual(snapshot.secondary, { usedPercent: 42, windowSeconds: 604_800, resetsAt: 3_000_000 });
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Codex 5h 18% · 7d 42%");
});
